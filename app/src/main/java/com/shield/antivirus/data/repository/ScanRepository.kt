package com.shield.antivirus.data.repository

import android.content.Context
import com.google.gson.Gson
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.local.AppDatabase
import com.shield.antivirus.data.model.*
import com.shield.antivirus.data.scanner.LocalThreatDetector
import com.shield.antivirus.data.security.ShieldSessionManager
import com.shield.antivirus.util.HashUtils
import com.shield.antivirus.util.NotificationHelper
import com.shield.antivirus.util.PackageUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.withContext
import java.io.File

data class ScanProgress(
    val currentApp: String = "",
    val scannedCount: Int = 0,
    val totalCount: Int = 0,
    val threats: List<ThreatInfo> = emptyList(),
    val isComplete: Boolean = false,
    val savedId: Long = 0L
)

class ScanRepository(private val context: Context) {
    private val dao  = AppDatabase.getInstance(context).scanResultDao()
    private val prefs = UserPreferences(context)
    private val gson  = Gson()
    private val localThreatDetector = LocalThreatDetector(context)
    private val sessionManager = ShieldSessionManager(context)
    private val shieldApi = ApiClient.shieldApi

    fun getAllResults() = dao.getAllResults().map { list ->
        list.map { it.toDomain() }
    }

    suspend fun getResultById(id: Long) = withContext(Dispatchers.IO) {
        dao.getById(id)?.toDomain()
    }

    suspend fun deleteAll() = withContext(Dispatchers.IO) { dao.deleteAll() }

    suspend fun getRecentResults() = withContext(Dispatchers.IO) {
        dao.getRecentResults().map { it.toDomain() }
    }

    fun startScan(scanType: String, selectedPackages: List<String> = emptyList()): Flow<ScanProgress> = flow {
        val allApps = withContext(Dispatchers.IO) {
            when (scanType) {
                "QUICK" -> PackageUtils.getUserApps(context).take(30)
                "FULL"  -> PackageUtils.getAllInstalledApps(context, includeSystem = true)
                "SELECTIVE" -> PackageUtils.getUserApps(context)
                    .filter { it.packageName in selectedPackages }
                else    -> PackageUtils.getUserApps(context)
            }
        }

        val vtApiKey = withContext(Dispatchers.IO) {
            prefs.vtApiKey.first()
        }

        val total = allApps.size
        val threats = mutableListOf<ThreatInfo>()
        val startTime = System.currentTimeMillis()
        var notifId = 0

        allApps.forEachIndexed { index, app ->
            emit(ScanProgress(
                currentApp = app.appName,
                scannedCount = index,
                totalCount = total,
                threats = threats.toList()
            ))

            NotificationHelper.showScanNotification(
                context,
                (((index + 1).toFloat() / total.coerceAtLeast(1)) * 100).toInt(),
                app.appName
            )

            val localThreat = withContext(Dispatchers.IO) {
                localThreatDetector.scan(app)
            }

            val shouldAskVirusTotal = vtApiKey.isNotBlank() && (
                localThreat == null ||
                    localThreat.severity == ThreatSeverity.LOW ||
                    localThreat.severity == ThreatSeverity.MEDIUM
                )

            val finalThreat = if (shouldAskVirusTotal) {
                val cloudThreat = withContext(Dispatchers.IO) {
                    checkWithVirusTotal(app, vtApiKey)
                }
                when {
                    cloudThreat != null && localThreat != null -> cloudThreat.copy(
                        threatName = "${localThreat.threatName} / ${cloudThreat.threatName}",
                        detectionEngine = "Shield Local + VirusTotal"
                    )
                    cloudThreat != null -> cloudThreat
                    else -> localThreat
                }
            } else {
                localThreat
            }

            if (finalThreat != null) {
                threats.add(finalThreat)
                NotificationHelper.showThreatNotification(
                    context, app.appName, finalThreat.threatName, notifId++
                )
            }
        }

        NotificationHelper.cancelScanNotification(context)
        prefs.updateLastScanTime()

        val entity = ScanResultEntity(
            scanType = scanType,
            startedAt = startTime,
            completedAt = System.currentTimeMillis(),
            totalScanned = total,
            threatsFound = threats.size,
            threatsJson = gson.toJson(threats),
            status = "COMPLETED"
        )
        val savedId = withContext(Dispatchers.IO) { dao.insert(entity) }
        withContext(Dispatchers.IO) {
            syncScanToCloud(entity, threats)
        }

        emit(ScanProgress(
            currentApp = "",
            scannedCount = total,
            totalCount = total,
            threats = threats.toList(),
            isComplete = true,
            savedId = savedId
        ))
    }.flowOn(Dispatchers.Default)

    private suspend fun checkWithVirusTotal(app: AppInfo, apiKey: String): ThreatInfo? {
        return try {
            val apkFile = File(app.apkPath)
            if (!apkFile.exists()) return null
            val hash = HashUtils.sha256(apkFile) ?: return null

            val response = ApiClient.virusTotalApi.getFileReport(apiKey, hash)
            if (!response.isSuccessful) return null

            val data = response.body()?.data?.attributes ?: return null
            val stats = data.lastAnalysisStats ?: return null
            val malicious = stats.malicious + stats.suspicious

            if (malicious > 0) {
                val topResult = data.lastAnalysisResults?.values
                    ?.firstOrNull { it.category == "malicious" || it.category == "suspicious" }

                ThreatInfo(
                    packageName = app.packageName,
                    appName = app.appName,
                    threatName = topResult?.result ?: "Unknown Malware",
                    severity = when {
                        stats.malicious > 20 -> ThreatSeverity.CRITICAL
                        stats.malicious > 10 -> ThreatSeverity.HIGH
                        stats.malicious > 3  -> ThreatSeverity.MEDIUM
                        else                 -> ThreatSeverity.LOW
                    },
                    detectionEngine = topResult?.engineName ?: "VirusTotal",
                    detectionCount = malicious,
                    totalEngines = stats.malicious + stats.suspicious + stats.undetected + stats.harmless
                )
            } else null
        } catch (e: Exception) { null }
    }

    private suspend fun syncScanToCloud(entity: ScanResultEntity, threats: List<ThreatInfo>) {
        val token = sessionManager.getValidAccessToken() ?: return
        runCatching {
            shieldApi.saveScan(
                token = "Bearer $token",
                request = SaveScanRequest(
                    scanType = entity.scanType,
                    startedAt = entity.startedAt,
                    completedAt = entity.completedAt,
                    totalScanned = entity.totalScanned,
                    threatsFound = entity.threatsFound,
                    threatsJson = threats,
                    status = entity.status
                )
            )
        }
    }

    private fun ScanResultEntity.toDomain(): ScanResult {
        val threatType = object : com.google.gson.reflect.TypeToken<List<ThreatInfo>>() {}.type
        val threats: List<ThreatInfo> = try {
            gson.fromJson(threatsJson, threatType) ?: emptyList()
        } catch (e: Exception) { emptyList() }

        return ScanResult(
            id = id,
            scanType = scanType,
            startedAt = startedAt,
            completedAt = completedAt,
            totalScanned = totalScanned,
            threatsFound = threatsFound,
            threats = threats,
            status = status
        )
    }
}
