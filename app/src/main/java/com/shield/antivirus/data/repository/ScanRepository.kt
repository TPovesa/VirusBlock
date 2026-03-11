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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
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

        val accessToken = withContext(Dispatchers.IO) { sessionManager.getValidAccessToken() }
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

            val localThreat = withContext(Dispatchers.IO) { localThreatDetector.scan(app) }

            val threatBatch = if (useServerDeepScan) {
                val serverThreats = withContext(Dispatchers.IO) {
                    checkWithServerDeepScan(app, accessToken.orEmpty(), scanType)
                }
                mergeThreats(localThreat, serverThreats)
            } else {
                buildList {
                    localThreat?.let { add(it) }
                }
            }

            if (threatBatch.isNotEmpty()) {
                threats.addAll(threatBatch)
                val mainThreat = threatBatch.maxByOrNull { threatRank(it.severity) } ?: threatBatch.first()
                NotificationHelper.showThreatNotification(
                    context,
                    app.appName,
                    mainThreat.threatName,
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

    private suspend fun checkWithServerDeepScan(app: AppInfo, accessToken: String, scanType: String): List<ThreatInfo> {
        return try {
            val apkFile = File(app.apkPath)
            val sha256 = if (apkFile.exists()) HashUtils.sha256(apkFile) else null

            val startResponse = ApiClient.executeShieldCall { api ->
                api.startDeepScan(
                    token = "Bearer $accessToken",
                    request = DeepScanStartRequest(
                        appName = app.appName,
                        packageName = app.packageName,
                        scanMode = scanType,
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

            val job = startResponse.body()?.scan
            val scanId = job?.id
            if (!startResponse.isSuccessful || scanId.isNullOrBlank()) return emptyList()

            if (job?.nextAction.equals("upload_apk", ignoreCase = true) && apkFile.exists()) {
                val uploadResponse = ApiClient.executeShieldCall { api ->
                    api.uploadDeepScanApk(
                        token = "Bearer $accessToken",
                        id = scanId,
                        fileName = "${app.packageName}.apk",
                        apkBody = apkFile.asRequestBody("application/vnd.android.package-archive".toMediaType())
                    )
                }
                if (!uploadResponse.isSuccessful) {
                    return emptyList()
                }
            }

            repeat(40) { attempt ->
                delay(if (attempt == 0) 500L else 1200L)
                val pollResponse = ApiClient.executeShieldCall { api ->
                    api.getDeepScan("Bearer $accessToken", scanId)
                }
                if (!pollResponse.isSuccessful) return emptyList()

                val currentJob = pollResponse.body()?.scan ?: return emptyList()
                when (currentJob.status.uppercase()) {
                    "AWAITING_UPLOAD", "QUEUED", "RUNNING" -> Unit
                    "FAILED" -> return emptyList()
                    "COMPLETED" -> return mapDeepScanToThreats(app, currentJob)
                    else -> return emptyList()
                }
            }
            emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun mapDeepScanToThreats(app: AppInfo, job: DeepScanJob): List<ThreatInfo> {
        val verdict = job.verdict?.lowercase().orEmpty()
        val findings = job.findings.orEmpty()
        val score = job.riskScore ?: 0
        if (verdict == "clean" && findings.isEmpty() && score < 20) return emptyList()

        val sourceThreats = findings
            .groupBy { it.source?.ifBlank { null } ?: "Shield Deep" }
            .map { (source, items) ->
                val severity = items.maxByOrNull { severityRank(it.severity) }?.severity?.toThreatSeverity()
                    ?: verdict.toThreatSeverity(score)
                ThreatInfo(
                    packageName = app.packageName,
                    appName = app.appName,
                    threatName = items.firstOrNull()?.title ?: "Серверный сигнал",
                    severity = severity,
                    detectionEngine = source,
                    detectionCount = items.size,
                    totalEngines = findings.size.coerceAtLeast(items.size),
                    summary = items.joinToString(separator = "\n") { it.detail }
                )
            }
            .sortedByDescending { threatRank(it.severity) }

        if (sourceThreats.isNotEmpty()) {
            return sourceThreats
        }

        val fallbackSource = job.summary?.sources.orEmpty().firstOrNull()
        return listOf(
            ThreatInfo(
                packageName = app.packageName,
                appName = app.appName,
                threatName = fallbackSource?.summary ?: "Серверная проверка",
                severity = verdict.toThreatSeverity(score),
                detectionEngine = fallbackSource?.source ?: "Shield Deep",
                detectionCount = fallbackSource?.findingCount ?: findings.size.coerceAtLeast(if (score > 0) 1 else 0),
                totalEngines = job.summary?.sources?.size ?: 1,
                summary = job.summary?.recommendations.orEmpty().joinToString(separator = "\n")
            )
        )
    }

    private fun mergeThreats(localThreat: ThreatInfo?, serverThreats: List<ThreatInfo>): List<ThreatInfo> {
        return buildList {
            addAll(serverThreats)
            localThreat?.let { add(it) }
        }.distinctBy { listOf(it.packageName, it.threatName, it.detectionEngine).joinToString("::") }
    }

    private fun severityRank(severity: String?): Int = when (severity?.lowercase()) {
        "critical" -> 4
        "high" -> 3
        "medium" -> 2
        else -> 1
    }

    private fun String.toThreatSeverity(score: Int = 0): ThreatSeverity = when (lowercase()) {
        "malicious" -> ThreatSeverity.CRITICAL
        "suspicious" -> ThreatSeverity.HIGH
        "low_risk" -> ThreatSeverity.MEDIUM
        else -> when {
            score >= 75 -> ThreatSeverity.CRITICAL
            score >= 50 -> ThreatSeverity.HIGH
            score >= 25 -> ThreatSeverity.MEDIUM
            else -> ThreatSeverity.LOW
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
        } catch (_: Exception) {
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
