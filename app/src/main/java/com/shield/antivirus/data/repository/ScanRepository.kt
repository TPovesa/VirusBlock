package com.shield.antivirus.data.repository

import android.content.Context
import com.google.gson.Gson
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.local.AppDatabase
import com.shield.antivirus.data.model.AppInfo
import com.shield.antivirus.data.model.DeepScanJob
import com.shield.antivirus.data.model.DeepScanStartRequest
import com.shield.antivirus.data.model.SaveScanRequest
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.model.ScanResultEntity
import com.shield.antivirus.data.model.ThreatInfo
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.data.scanner.LocalThreatDetector
import com.shield.antivirus.data.security.ShieldSessionManager
import com.shield.antivirus.util.HashUtils
import com.shield.antivirus.util.NotificationHelper
import com.shield.antivirus.util.PackageUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
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
    private val dao = AppDatabase.getInstance(context).scanResultDao()
    private val prefs = UserPreferences(context)
    private val gson = Gson()
    private val localThreatDetector = LocalThreatDetector(context)
    private val sessionManager = ShieldSessionManager(context)

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
                "FULL" -> PackageUtils.getAllInstalledApps(context, includeSystem = true)
                "SELECTIVE" -> {
                    val userApps = PackageUtils.getUserApps(context)
                    if (selectedPackages.isEmpty()) userApps else userApps.filter { it.packageName in selectedPackages }
                }
                else -> PackageUtils.getUserApps(context)
            }
        }

        val vtApiKey = withContext(Dispatchers.IO) {
            prefs.vtApiKey.first()
        }
        val accessToken = withContext(Dispatchers.IO) {
            sessionManager.getValidAccessToken()
        }
        val useServerDeepScan = scanType != "QUICK" && !accessToken.isNullOrBlank()

        val total = allApps.size
        val threats = mutableListOf<ThreatInfo>()
        val startTime = System.currentTimeMillis()
        var notifId = 0

        allApps.forEachIndexed { index, app ->
            emit(
                ScanProgress(
                    currentApp = app.appName,
                    scannedCount = index,
                    totalCount = total,
                    threats = threats.toList()
                )
            )

            NotificationHelper.showScanNotification(
                context,
                (((index + 1).toFloat() / total.coerceAtLeast(1)) * 100).toInt(),
                app.appName
            )

            val localThreat = withContext(Dispatchers.IO) {
                localThreatDetector.scan(app)
            }

            val finalThreat = if (useServerDeepScan) {
                val serverThreat = withContext(Dispatchers.IO) {
                    checkWithServerDeepScan(app, accessToken.orEmpty())
                }
                mergeThreats(localThreat, serverThreat)
            } else {
                val shouldAskVirusTotal = vtApiKey.isNotBlank() && (
                    localThreat == null ||
                        localThreat.severity == ThreatSeverity.LOW ||
                        localThreat.severity == ThreatSeverity.MEDIUM
                    )

                if (shouldAskVirusTotal) {
                    val cloudThreat = withContext(Dispatchers.IO) {
                        checkWithVirusTotal(app, vtApiKey)
                    }
                    when {
                        cloudThreat != null && localThreat != null -> cloudThreat.copy(
                            threatName = "${localThreat.threatName} / ${cloudThreat.threatName}",
                            detectionEngine = "Shield + VirusTotal"
                        )
                        cloudThreat != null -> cloudThreat
                        else -> localThreat
                    }
                } else {
                    localThreat
                }
            }

            if (finalThreat != null) {
                threats.add(finalThreat)
                NotificationHelper.showThreatNotification(
                    context,
                    app.appName,
                    finalThreat.threatName,
                    notifId++
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

        emit(
            ScanProgress(
                currentApp = "",
                scannedCount = total,
                totalCount = total,
                threats = threats.toList(),
                isComplete = true,
                savedId = savedId
            )
        )
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
                    threatName = topResult?.result ?: "Неизвестная угроза",
                    severity = when {
                        stats.malicious > 20 -> ThreatSeverity.CRITICAL
                        stats.malicious > 10 -> ThreatSeverity.HIGH
                        stats.malicious > 3 -> ThreatSeverity.MEDIUM
                        else -> ThreatSeverity.LOW
                    },
                    detectionEngine = topResult?.engineName ?: "VirusTotal",
                    detectionCount = malicious,
                    totalEngines = stats.malicious + stats.suspicious + stats.undetected + stats.harmless
                )
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun checkWithServerDeepScan(app: AppInfo, accessToken: String): ThreatInfo? {
        return try {
            val apkFile = File(app.apkPath)
            val sha256 = if (apkFile.exists()) HashUtils.sha256(apkFile) else null

            val startResponse = ApiClient.executeShieldCall { api ->
                api.startDeepScan(
                    token = "Bearer $accessToken",
                    request = DeepScanStartRequest(
                        appName = app.appName,
                        packageName = app.packageName,
                        sha256 = sha256,
                        installerPackage = app.installerPackage,
                        permissions = app.requestedPermissions,
                        targetSdk = app.targetSdk,
                        minSdk = app.minSdk,
                        versionCode = app.versionCode,
                        versionName = app.versionName,
                        firstInstallTime = app.installTime,
                        lastUpdateTime = app.lastUpdateTime,
                        sizeBytes = app.sizeBytes,
                        signatureSha256 = app.signatureSha256,
                        certificateSubject = app.certificateSubject,
                        isDebuggable = app.isDebuggable,
                        usesCleartextTraffic = app.usesCleartextTraffic
                    )
                )
            }

            val scanId = startResponse.body()?.scan?.id
            if (!startResponse.isSuccessful || scanId.isNullOrBlank()) return null

            repeat(18) { attempt ->
                delay(if (attempt == 0) 300L else 700L)
                val pollResponse = ApiClient.executeShieldCall { api ->
                    api.getDeepScan("Bearer $accessToken", scanId)
                }
                if (!pollResponse.isSuccessful) return null

                val job = pollResponse.body()?.scan ?: return null
                when (job.status.uppercase()) {
                    "QUEUED", "RUNNING" -> Unit
                    "FAILED" -> return null
                    "COMPLETED" -> return mapDeepScanToThreat(app, job)
                    else -> return null
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    private fun mapDeepScanToThreat(app: AppInfo, job: DeepScanJob): ThreatInfo? {
        val verdict = job.verdict?.lowercase().orEmpty()
        val findings = job.findings.orEmpty()
        val score = job.riskScore ?: 0
        if (verdict == "clean" && findings.isEmpty() && score < 20) return null

        val severity = when {
            verdict == "malicious" || score >= 85 -> ThreatSeverity.CRITICAL
            verdict == "suspicious" || score >= 55 -> ThreatSeverity.HIGH
            verdict == "low_risk" || score >= 25 -> ThreatSeverity.MEDIUM
            else -> ThreatSeverity.LOW
        }

        val title = findings.firstOrNull()?.title
            ?: job.summary?.verdict
            ?: "Серверная проверка"
        return ThreatInfo(
            packageName = app.packageName,
            appName = app.appName,
            threatName = title,
            severity = severity,
            detectionEngine = "Shield deep",
            detectionCount = findings.size.coerceAtLeast(if (score > 0) 1 else 0),
            totalEngines = (findings.size + 1).coerceAtLeast(1)
        )
    }

    private fun mergeThreats(localThreat: ThreatInfo?, serverThreat: ThreatInfo?): ThreatInfo? {
        return when {
            localThreat == null -> serverThreat
            serverThreat == null -> localThreat
            else -> {
                val severity = maxOf(localThreat.severity, serverThreat.severity, compareBy { threatRank(it) })
                serverThreat.copy(
                    threatName = "${serverThreat.threatName} / ${localThreat.threatName}",
                    severity = severity,
                    detectionEngine = "Shield deep + локально",
                    detectionCount = serverThreat.detectionCount + localThreat.detectionCount,
                    totalEngines = maxOf(serverThreat.totalEngines, localThreat.totalEngines)
                )
            }
        }
    }

    private fun threatRank(severity: ThreatSeverity): Int = when (severity) {
        ThreatSeverity.CRITICAL -> 4
        ThreatSeverity.HIGH -> 3
        ThreatSeverity.MEDIUM -> 2
        ThreatSeverity.LOW -> 1
    }

    private suspend fun syncScanToCloud(entity: ScanResultEntity, threats: List<ThreatInfo>) {
        val token = sessionManager.getValidAccessToken() ?: return
        runCatching {
            ApiClient.executeShieldCall { api ->
                api.saveScan(
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
    }

    private fun ScanResultEntity.toDomain(): ScanResult {
        val threatType = object : com.google.gson.reflect.TypeToken<List<ThreatInfo>>() {}.type
        val threats: List<ThreatInfo> = try {
            gson.fromJson(threatsJson, threatType) ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }

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
