package com.shield.antivirus.data.repository

import android.content.Context
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.MediaStore
import com.google.gson.Gson
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.local.AppDatabase
import com.shield.antivirus.data.model.AppInfo
import com.shield.antivirus.data.model.ApiError
import com.shield.antivirus.data.model.DeepScanFinding
import com.shield.antivirus.data.model.DeepScanFullReportRequest
import com.shield.antivirus.data.model.DeepScanFullReportResponse
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
import com.shield.antivirus.util.AppLogger
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
import retrofit2.Response
import java.io.File
import java.io.FileOutputStream
import java.util.Calendar
import java.util.zip.ZipFile

data class ScanProgress(
    val currentApp: String = "",
    val scannedCount: Int = 0,
    val totalCount: Int = 0,
    val threats: List<ThreatInfo> = emptyList(),
    val isComplete: Boolean = false,
    val savedId: Long = 0L
)

class ScanAlreadyRunningException(message: String) : IllegalStateException(message)
class FullReportRateLimitException(message: String) : IllegalStateException(message)

class ScanRepository(private val context: Context) {
    private val dao = AppDatabase.getInstance(context).scanResultDao()
    private val prefs = UserPreferences(context)
    private val gson = Gson()
    private val localThreatDetector = LocalThreatDetector(context)
    private val sessionManager = ShieldSessionManager(context)
    private val unknownSourceFindingTypes = setOf("install_source", "recent_sideload")
    private val weakContextFindingTypes = setOf("metadata_gap", "signature_gap", "certificate_gap")

    fun getAllResults() = dao.getAllResults().map { list ->
        list.map { it.toDomain() }
    }

    suspend fun getResultById(id: Long) = withContext(Dispatchers.IO) {
        dao.getById(id)?.toDomain()
    }

    suspend fun hasLocalResults(): Boolean = withContext(Dispatchers.IO) {
        dao.getRecentResults().isNotEmpty()
    }

    suspend fun deleteAll() = withContext(Dispatchers.IO) { dao.deleteAll() }

    suspend fun getRecentResults() = withContext(Dispatchers.IO) {
        dao.getRecentResults().map { it.toDomain() }
    }

    suspend fun downloadFullServerReport(result: ScanResult): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val token = sessionManager.getValidAccessToken()
                ?: throw IllegalStateException("Требуется вход в аккаунт")
            val reportIds = result.threats
                .mapNotNull { it.serverScanId?.trim() }
                .filter { it.isNotBlank() && it.matches(Regex("^[a-zA-Z0-9-]{20,64}$")) }
                .distinct()
            if (reportIds.isEmpty()) {
                throw IllegalStateException("Для этого результата нет валидных серверных deep-scan ID")
            }

            val response = requestFullReportWithRetry(token = token, reportIds = reportIds)
            if (!response.isSuccessful) {
                throw mapFullReportHttpException(response.code())
            }
            val body = response.body() ?: throw IllegalStateException("Пустой ответ сервера")
            if (!body.success) {
                throw IllegalStateException(
                    body.error?.takeIf { it.isNotBlank() }
                        ?: "Сервер не смог сформировать полный отчёт"
                )
            }
            val reports = body.reports.orEmpty().filter { !it.markdown.isNullOrBlank() }
            if (reports.isEmpty()) {
                throw IllegalStateException("Сервер не вернул полный отчёт по deep-scan")
            }

            val generatedAt = System.currentTimeMillis()
            val header = buildString {
                appendLine("# Shield Full Report")
                appendLine()
                appendLine("- generated_at: $generatedAt")
                appendLine("- local_scan_id: ${result.id}")
                appendLine("- scan_type: ${result.scanType}")
                appendLine("- deep_reports_count: ${reports.size}")
                appendLine()
            }
            val payload = buildString {
                append(header)
                reports.forEachIndexed { index, report ->
                    appendLine("---")
                    appendLine()
                    appendLine("## App ${index + 1}")
                    appendLine("- scan_id: ${report.scanId}")
                    appendLine("- app: ${report.appName ?: "n/a"}")
                    appendLine("- package: ${report.packageName ?: "n/a"}")
                    appendLine("- mode: ${report.scanMode ?: "n/a"}")
                    appendLine()
                    appendLine(report.markdown.orEmpty())
                    appendLine()
                }
            }

            val fileName = "shield-full-report-${result.id}-${generatedAt}.md"
            saveReportToDownloads(fileName, payload)
        }
    }

    private suspend fun requestFullReportWithRetry(
        token: String,
        reportIds: List<String>
    ): Response<DeepScanFullReportResponse> {
        val maxAttempts = 3
        for (attempt in 1..maxAttempts) {
            try {
                val response = ApiClient.executeShieldCall { api ->
                    api.getDeepScanFullReport(
                        token = "Bearer $token",
                        request = DeepScanFullReportRequest(ids = reportIds)
                    )
                }
                if (!shouldRetryFullReport(response.code()) || attempt == maxAttempts) {
                    return response
                }
                val delayMs = fullReportRetryDelayMs(attempt)
                AppLogger.log(
                    tag = "scan_repository",
                    message = "Retrying full report request",
                    level = "WARN",
                    metadata = mapOf(
                        "attempt" to attempt.toString(),
                        "status_code" to response.code().toString(),
                        "delay_ms" to delayMs.toString()
                    )
                )
                delay(delayMs)
            } catch (error: Exception) {
                if (attempt == maxAttempts) throw error
                val delayMs = fullReportRetryDelayMs(attempt)
                AppLogger.logError(
                    tag = "scan_repository",
                    message = "Full report request failed, retry scheduled",
                    error = error,
                    metadata = mapOf(
                        "attempt" to attempt.toString(),
                        "delay_ms" to delayMs.toString()
                    )
                )
                delay(delayMs)
            }
        }
        throw IllegalStateException("Не удалось получить полный отчёт")
    }

    private fun shouldRetryFullReport(statusCode: Int): Boolean {
        return statusCode == 429 || statusCode == 408 || statusCode == 425 || statusCode in 500..504
    }

    private fun fullReportRetryDelayMs(attempt: Int): Long = when (attempt) {
        1 -> 900L
        2 -> 1800L
        else -> 3200L
    }

    private fun mapFullReportHttpException(statusCode: Int): IllegalStateException = when (statusCode) {
        429 -> FullReportRateLimitException(
            "Слишком много запросов к полному отчёту. Подождите 1-2 минуты и попробуйте снова."
        )
        401, 403 -> IllegalStateException("Сессия истекла. Войдите в аккаунт и повторите попытку.")
        404 -> IllegalStateException("Полный отчёт пока недоступен. Попробуйте позже.")
        else -> IllegalStateException("Сервер вернул ошибку ($statusCode) при получении полного отчёта")
    }

    suspend fun getDailyLaunchCount(scanType: String): Int = withContext(Dispatchers.IO) {
        val target = scanType.uppercase()
        val dayStart = startOfCurrentDay()
        dao.getAllResults()
            .first()
            .count { it.scanType.uppercase() == target && it.completedAt >= dayStart }
    }

    fun startScan(
        scanType: String,
        selectedPackages: List<String> = emptyList(),
        apkUriString: String? = null,
        resultScanTypeOverride: String? = null,
        manageNotifications: Boolean = true
    ): Flow<ScanProgress> = flow {
        val normalizedType = scanType.uppercase()
        val persistedScanType = resultScanTypeOverride
            ?.uppercase()
            ?.takeIf { it.isNotBlank() }
            ?: normalizedType
        var lockAcquired = false
        try {
            AppLogger.log(
                tag = "scan_repository",
                message = "Scan start requested",
                metadata = mapOf(
                    "scan_type" to normalizedType,
                    "result_scan_type" to persistedScanType,
                    "selected_count" to selectedPackages.size.toString(),
                    "apk_uri_provided" to (!apkUriString.isNullOrBlank()).toString()
                )
            )
            lockAcquired = withContext(Dispatchers.IO) {
                prefs.tryAcquireActiveScan(normalizedType, "Подготовка проверки")
            }
            if (!lockAcquired) {
                AppLogger.log(
                    tag = "scan_repository",
                    message = "Scan lock denied",
                    level = "WARN",
                    metadata = mapOf("scan_type" to normalizedType)
                )
                throw ScanAlreadyRunningException("Уже идёт проверка. Нажмите «Посмотреть текущую проверку» на главном экране.")
            }

            if (normalizedType == "APK") {
                val token = withContext(Dispatchers.IO) { sessionManager.getValidAccessToken() }
                if (token.isNullOrBlank()) {
                    emit(
                        ScanProgress(
                            currentApp = "Для проверки APK требуется вход в аккаунт.",
                            totalCount = 1
                        )
                    )
                    return@flow
                }

                val apkUri = apkUriString?.takeIf { it.isNotBlank() }
                if (apkUri.isNullOrBlank()) {
                    emit(
                        ScanProgress(
                            currentApp = "Выберите APK-файл перед запуском проверки.",
                            totalCount = 1
                        )
                    )
                    return@flow
                }

                emit(
                    ScanProgress(
                        currentApp = "Проверка APK-файла",
                        totalCount = 1
                    )
                )
                withContext(Dispatchers.IO) {
                    prefs.updateActiveScan(normalizedType, "Проверка APK-файла", 0, 1)
                }

                val preparedApk = withContext(Dispatchers.IO) { prepareApkForScan(apkUri) }
                if (preparedApk == null) {
                    AppLogger.log(
                        tag = "scan_repository",
                        message = "APK preparation failed",
                        level = "WARN"
                    )
                    emit(
                        ScanProgress(
                            currentApp = "Не удалось открыть выбранный APK-файл.",
                            totalCount = 1
                        )
                    )
                    return@flow
                }

                val (apkFile, displayName) = preparedApk
                try {
                    if (!isValidApk(apkFile)) {
                        AppLogger.log(
                            tag = "scan_repository",
                            message = "Invalid APK selected",
                            level = "WARN",
                            metadata = mapOf("display_name" to displayName)
                        )
                        emit(
                            ScanProgress(
                                currentApp = "Выбранный файл не является корректным APK.",
                                totalCount = 1
                            )
                        )
                        return@flow
                    }

                    if (manageNotifications) {
                        NotificationHelper.showScanNotification(
                            context = context,
                            progress = 12,
                            status = notificationStatusForScan(normalizedType),
                            stage = "Подготавливаем файл",
                            deepMode = normalizedType != "QUICK"
                        )
                    }
                    withContext(Dispatchers.IO) {
                        prefs.updateActiveScan(normalizedType, displayName, 0, 1)
                    }

                    val syntheticPackage = displayName
                        .removeSuffix(".apk")
                        .lowercase()
                        .replace(Regex("[^a-z0-9_]"), "_")
                        .trim('_')
                        .ifBlank { "sample" }
                        .take(32)
                    val syntheticApp = AppInfo(
                        packageName = "uploaded.apk.$syntheticPackage",
                        appName = displayName,
                        versionName = "?",
                        versionCode = 0L,
                        apkPath = apkFile.absolutePath,
                        installTime = System.currentTimeMillis(),
                        isSystemApp = false
                    )
                    val threats = checkWithServerDeepScan(
                        app = syntheticApp,
                        accessToken = token,
                        scanType = normalizedType
                    )

                    withContext(Dispatchers.IO) {
                        prefs.updateActiveScan(normalizedType, "Сохранение результата", 1, 1)
                    }
                    if (manageNotifications) {
                        NotificationHelper.cancelScanNotification(context)
                        NotificationHelper.showScanSummaryNotification(
                            context = context,
                            threatsFound = threats.size,
                            deepMode = normalizedType != "QUICK"
                        )
                    }
                    prefs.updateLastScanTime()

                    val entity = ScanResultEntity(
                        scanType = persistedScanType,
                        startedAt = System.currentTimeMillis(),
                        completedAt = System.currentTimeMillis(),
                        totalScanned = 1,
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
                            scannedCount = 1,
                            totalCount = 1,
                            threats = threats,
                            isComplete = true,
                            savedId = savedId
                        )
                    )
                    return@flow
                } finally {
                    runCatching { apkFile.delete() }
                }
            }

            val allApps = withContext(Dispatchers.IO) {
                when (normalizedType) {
                    "QUICK" -> {
                        if (selectedPackages.isEmpty()) {
                            PackageUtils.getHybridQuickApps(context)
                        } else {
                            PackageUtils.getAllInstalledApps(context, includeSystem = true)
                                .filter { it.packageName in selectedPackages }
                        }
                    }
                    "FULL" -> PackageUtils.getAllInstalledApps(context, includeSystem = true)
                    "SELECTIVE" -> {
                        val installedApps = PackageUtils.getAllInstalledApps(context, includeSystem = true)
                        if (selectedPackages.isEmpty()) installedApps else installedApps.filter { it.packageName in selectedPackages }
                    }
                    else -> PackageUtils.getAllInstalledApps(context, includeSystem = true)
                }
            }

            val isServerOnlyScan = normalizedType != "QUICK"
            val accessToken = withContext(Dispatchers.IO) { sessionManager.getValidAccessToken() }
            if (isServerOnlyScan && accessToken.isNullOrBlank()) {
                emit(
                    ScanProgress(
                        currentApp = "Для этого режима нужен вход в аккаунт и активная сессия.",
                        scannedCount = 0,
                        totalCount = 1
                    )
                )
                return@flow
            }
            val total = allApps.size
            var serverChecksUsed = 0
            var serverChecksFailed = 0
            var serverChecksSucceeded = 0

            AppLogger.log(
                tag = "scan_repository",
                message = "Scan app pool resolved",
                metadata = mapOf(
                    "scan_type" to normalizedType,
                    "apps_total" to total.toString(),
                    "server_only" to isServerOnlyScan.toString()
                )
            )
            val threats = mutableListOf<ThreatInfo>()
            val startTime = System.currentTimeMillis()
            allApps.forEachIndexed { index, app ->
                emit(
                    ScanProgress(
                        currentApp = app.appName,
                        scannedCount = index,
                        totalCount = total,
                        threats = threats.toList()
                    )
                )
                withContext(Dispatchers.IO) {
                    prefs.updateActiveScan(normalizedType, app.appName, index, total.coerceAtLeast(1))
                }

                if (manageNotifications) {
                    NotificationHelper.showScanNotification(
                        context = context,
                        progress = (((index + 1).toFloat() / total.coerceAtLeast(1)) * 100).toInt(),
                        status = notificationStatusForScan(normalizedType),
                        stage = notificationStageForProgress(index + 1, total),
                        deepMode = isServerOnlyScan
                    )
                }

                val threatBatch = if (isServerOnlyScan) {
                    serverChecksUsed++
                    runCatching {
                        withContext(Dispatchers.IO) {
                            checkWithServerDeepScan(app, accessToken.orEmpty(), normalizedType)
                        }
                    }.onFailure { error ->
                        serverChecksFailed++
                        AppLogger.logError(
                            tag = "scan_repository",
                            message = "Server-only scan failed for app",
                            error = error,
                            metadata = mapOf(
                                "scan_type" to normalizedType,
                                "package" to app.packageName
                            )
                        )
                    }.getOrElse { error ->
                        throw IllegalStateException(
                            error.message ?: "Серверная проверка недоступна. Проверьте интернет и повторите попытку."
                        )
                    }.also {
                        serverChecksSucceeded++
                    }
                } else {
                    runCatching {
                        withContext(Dispatchers.IO) { localThreatDetector.scan(app, quickMode = true) }
                    }.onFailure { error ->
                        AppLogger.logError(
                            tag = "scan_repository",
                            message = "Local detector failed",
                            error = error,
                            metadata = mapOf("package" to app.packageName)
                        )
                    }.getOrNull()?.let(::listOf).orEmpty()
                }

                if (threatBatch.isNotEmpty()) {
                    threats.addAll(threatBatch)
                }
            }

            withContext(Dispatchers.IO) {
                prefs.updateActiveScan(normalizedType, "Сохранение результата", total, total.coerceAtLeast(1))
            }
            if (manageNotifications) {
                NotificationHelper.cancelScanNotification(context)
                NotificationHelper.showScanSummaryNotification(
                    context = context,
                    threatsFound = threats.size,
                    deepMode = isServerOnlyScan
                )
            }
            prefs.updateLastScanTime()

            val entity = ScanResultEntity(
                scanType = persistedScanType,
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
            AppLogger.log(
                tag = "scan_repository",
                message = "Scan completed",
                metadata = mapOf(
                    "scan_type" to normalizedType,
                    "total_scanned" to total.toString(),
                    "threats_found" to threats.size.toString(),
                    "server_checks_used" to serverChecksUsed.toString(),
                    "server_checks_failed" to serverChecksFailed.toString(),
                    "server_checks_succeeded" to serverChecksSucceeded.toString()
                )
            )
        } finally {
            if (manageNotifications) {
                NotificationHelper.cancelScanNotification(context)
            }
            if (lockAcquired) {
                withContext(Dispatchers.IO) {
                    prefs.clearActiveScan(normalizedType)
                }
            }
        }
    }.flowOn(Dispatchers.Default)

    private suspend fun checkWithServerDeepScan(app: AppInfo, accessToken: String, scanType: String): List<ThreatInfo> {
        val apkFile = File(app.apkPath)
        val sha256 = if (apkFile.exists()) HashUtils.sha256(apkFile) else null
        val canUploadApk = apkFile.exists() && apkFile.canRead()
        val canAutoUploadApkSecondStage = (scanType == "FULL" || scanType == "SELECTIVE") &&
            canUploadApk
        var apkUploaded = false

        val startResponse = ApiClient.executeShieldCall { api ->
            api.startDeepScan(
                token = "Bearer $accessToken",
                request = DeepScanStartRequest(
                    appName = app.appName,
                    packageName = app.packageName,
                    scanMode = scanType,
                    sha256 = sha256,
                    isSystemApp = app.isSystemApp,
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

        val initialJob = startResponse.body()?.scan
        val scanId = initialJob?.id
        if (!startResponse.isSuccessful || scanId.isNullOrBlank()) {
            val serverError = startResponse.body()?.error?.takeIf { it.isNotBlank() }
                ?: extractServerError(startResponse)
            AppLogger.log(
                tag = "scan_repository",
                message = "Deep scan start rejected",
                level = "WARN",
                metadata = mapOf(
                    "package" to app.packageName,
                    "status_code" to startResponse.code().toString(),
                    "server_error" to (serverError ?: "")
                )
            )
            throw IllegalStateException(
                serverError ?: "Сервер не принял проверку для ${app.appName}."
            )
        }

        if (initialJob.nextAction.equals("upload_apk", ignoreCase = true)) {
            if (!canUploadApk) {
                AppLogger.log(
                    tag = "scan_repository",
                    message = "APK upload required but file is not readable",
                    level = "WARN",
                    metadata = mapOf(
                        "scan_id" to scanId,
                        "package" to app.packageName
                    )
                )
                throw IllegalStateException("Не удалось подготовить APK для серверной проверки ${app.appName}.")
            }
            val uploaded = uploadDeepScanApk(
                scanId = scanId,
                app = app,
                apkFile = apkFile,
                accessToken = accessToken,
                reason = "required_by_server"
            )
            if (uploaded != null) {
                throw IllegalStateException(uploaded)
            }
            apkUploaded = true
        }

        val firstCompleted = pollDeepScanUntilCompleted(scanId, accessToken)
            ?: throw IllegalStateException("Сервер не завершил проверку ${app.appName}.")

        var finalJob = firstCompleted
        if (!apkUploaded && canAutoUploadApkSecondStage && shouldAutoUploadAfterFirstCompletion(firstCompleted)) {
            val secondStageUploaded = uploadDeepScanApk(
                scanId = scanId,
                app = app,
                apkFile = apkFile,
                accessToken = accessToken,
                reason = "client_second_stage"
            )
            if (secondStageUploaded == null) {
                apkUploaded = true
                val enrichedJob = pollDeepScanUntilCompleted(scanId, accessToken)
                if (enrichedJob != null) {
                    finalJob = enrichedJob
                }
            }
        }

        return mapDeepScanToThreats(app, finalJob)
    }

    private suspend fun uploadDeepScanApk(
        scanId: String,
        app: AppInfo,
        apkFile: File,
        accessToken: String,
        reason: String
    ): String? {
        if (!apkFile.exists() || !apkFile.canRead()) {
            return "Не удалось прочитать APK ${app.appName} для серверной проверки."
        }
        val uploadResponse = ApiClient.executeShieldCall { api ->
            api.uploadDeepScanApk(
                token = "Bearer $accessToken",
                id = scanId,
                fileName = "${app.packageName}.apk",
                apkBody = apkFile.asRequestBody("application/vnd.android.package-archive".toMediaType())
            )
        }
        if (!uploadResponse.isSuccessful) {
            val serverError = uploadResponse.body()?.error?.takeIf { it.isNotBlank() }
                ?: extractServerError(uploadResponse)
            AppLogger.log(
                tag = "scan_repository",
                message = "APK upload rejected",
                level = "WARN",
                metadata = mapOf(
                    "scan_id" to scanId,
                    "package" to app.packageName,
                    "status_code" to uploadResponse.code().toString(),
                    "reason" to reason,
                    "server_error" to (serverError ?: "")
                )
            )
            return serverError ?: "Сервер не принял APK ${app.appName} для проверки."
        }
        return null
    }

    private suspend fun pollDeepScanUntilCompleted(scanId: String, accessToken: String): DeepScanJob? {
        var attempt = 0
        while (true) {
            delay(
                when {
                    attempt < 3 -> 450L
                    attempt < 12 -> 900L
                    attempt < 40 -> 1600L
                    else -> 2500L
                }
            )
            val pollResponse = ApiClient.executeShieldCall { api ->
                api.getDeepScan("Bearer $accessToken", scanId)
            }
            if (!pollResponse.isSuccessful) {
                val serverError = pollResponse.body()?.error?.takeIf { it.isNotBlank() }
                    ?: extractServerError(pollResponse)
                AppLogger.log(
                    tag = "scan_repository",
                    message = "Deep scan polling rejected",
                    level = "WARN",
                    metadata = mapOf(
                        "scan_id" to scanId,
                        "status_code" to pollResponse.code().toString(),
                        "server_error" to (serverError ?: "")
                    )
                )
                throw IllegalStateException(serverError ?: "Сервер не отдал статус проверки.")
            }

            val currentBody = pollResponse.body()
            val currentJob = currentBody?.scan
                ?: throw IllegalStateException("Сервер вернул пустой статус проверки.")
            when (currentJob.status.uppercase()) {
                "AWAITING_UPLOAD", "QUEUED", "RUNNING" -> Unit
                "FAILED" -> throw IllegalStateException(
                    currentJob.error?.takeIf { it.isNotBlank() }
                        ?: currentBody.error?.takeIf { it.isNotBlank() }
                        ?: "Сервер завершил проверку с ошибкой."
                )
                "COMPLETED" -> return currentJob
                else -> throw IllegalStateException("Сервер вернул неизвестный статус проверки.")
            }
            attempt += 1
        }
    }

    private fun extractServerError(response: Response<*>): String? {
        val raw = runCatching { response.errorBody()?.string() }
            .getOrNull()
            .orEmpty()
            .trim()
        if (raw.isBlank()) return null

        val parsed = runCatching { gson.fromJson(raw, ApiError::class.java) }.getOrNull()
        if (!parsed?.error.isNullOrBlank()) {
            return parsed.error
        }

        val messageMatch = Regex("\"message\"\\s*:\\s*\"([^\"]+)\"").find(raw)
        return messageMatch?.groupValues?.getOrNull(1)
    }

    private fun shouldAutoUploadAfterFirstCompletion(job: DeepScanJob): Boolean {
        val verdict = job.verdict?.lowercase().orEmpty()
        val score = job.riskScore ?: 0
        if (verdict == "malicious" || verdict == "suspicious") return true
        if (score >= 40) return true

        val findings = job.findings.orEmpty()
        val hasMediumOrHigherFinding = findings.any { severityRank(it.severity) >= 2 }
        val hasStrongSignalType = findings.any { finding ->
            when (finding.type.lowercase()) {
                "permission", "permission_combo", "virustotal", "network_flag", "build_flag", "size_profile" -> true
                else -> false
            }
        }
        return hasMediumOrHigherFinding && hasStrongSignalType
    }

    private fun prepareApkForScan(uriString: String): Pair<File, String>? {
        val uri = runCatching { Uri.parse(uriString) }.getOrNull() ?: return null
        val displayName = resolveDisplayName(uri)
        val tempFile = File.createTempFile("scan_", ".apk", context.cacheDir)
        return try {
            val copied = context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(tempFile).use { output -> input.copyTo(output) }
                true
            } ?: false
            if (!copied || tempFile.length() <= 0L) {
                tempFile.delete()
                null
            } else {
                tempFile to displayName
            }
        } catch (_: Exception) {
            tempFile.delete()
            null
        }
    }

    private fun resolveDisplayName(uri: Uri): String {
        val fallback = uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "uploaded.apk"
        return runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        cursor.getString(0)?.takeIf { it.isNotBlank() } ?: fallback
                    } else {
                        fallback
                    }
                } ?: fallback
        }.getOrDefault(fallback)
    }

    private fun isValidApk(file: File): Boolean {
        if (!file.exists() || file.length() < 4L) return false
        val head = runCatching { file.inputStream().use { input -> ByteArray(4).also { input.read(it) } } }
            .getOrNull() ?: return false
        val isZipHeader = head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte()
        if (!isZipHeader) return false

        return runCatching {
            ZipFile(file).use { zip ->
                val hasManifest = zip.getEntry("AndroidManifest.xml") != null
                var hasDex = false
                val entries = zip.entries()
                while (entries.hasMoreElements()) {
                    val name = entries.nextElement().name.lowercase()
                    if (name == "classes.dex" || (name.startsWith("classes") && name.endsWith(".dex"))) {
                        hasDex = true
                        break
                    }
                }
                hasManifest && hasDex
            }
        }.getOrDefault(false)
    }

    private fun startOfCurrentDay(): Long = Calendar.getInstance().run {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
        timeInMillis
    }

    private fun mapDeepScanToThreats(app: AppInfo, job: DeepScanJob): List<ThreatInfo> {
        val verdict = job.verdict?.lowercase().orEmpty()
        val findings = job.findings.orEmpty()
        val score = job.riskScore ?: 0
        val filteredFindings = filterDeepFindingsForDisplay(findings, score)
        if (shouldSuppressUnknownSourceOnlyThreat(findings, filteredFindings, score)) return emptyList()
        if (filteredFindings.isEmpty() && score < 20 && (verdict.isBlank() || verdict == "clean" || verdict == "low_risk")) {
            return emptyList()
        }
        val primaryFinding = filteredFindings.maxByOrNull { severityRank(it.severity) }
        val summaryLines = filteredFindings
            .mapNotNull { it.detail.takeIf(String::isNotBlank) }
            .distinct()
            .take(3)
        val fallbackTitle = primaryFinding?.title
            ?: job.summary?.recommendations.orEmpty().firstOrNull()
            ?: "Подозрительное приложение"
        return listOf(
            ThreatInfo(
                packageName = app.packageName,
                appName = app.appName,
                threatName = fallbackTitle,
                severity = primaryFinding?.severity?.toThreatSeverity() ?: verdict.toThreatSeverity(score),
                detectionEngine = "",
                summary = summaryLines.joinToString(separator = "\n").ifBlank {
                    job.summary?.recommendations.orEmpty().firstOrNull().orEmpty()
                },
                serverScanId = job.id
            )
        )
    }

    private fun saveReportToDownloads(fileName: String, content: String): String {
        val mimeType = "text/markdown"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/ShieldSecurity")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Не удалось создать файл отчёта")
            context.contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { writer ->
                writer.write(content)
            } ?: throw IllegalStateException("Не удалось открыть поток записи отчёта")

            val doneValues = ContentValues().apply {
                put(MediaStore.Downloads.IS_PENDING, 0)
            }
            context.contentResolver.update(uri, doneValues, null, null)
            return uri.toString()
        }

        val fallbackDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: context.filesDir
        val targetDir = File(fallbackDir, "ShieldSecurity").apply { mkdirs() }
        val file = File(targetDir, fileName)
        file.writeText(content, Charsets.UTF_8)
        return file.absolutePath
    }

    private fun filterDeepFindingsForDisplay(findings: List<DeepScanFinding>, score: Int): List<DeepScanFinding> {
        if (findings.isEmpty()) return findings
        val hasUnknownSourceSignals = findings.any(::isUnknownSourceFinding)
        if (!hasUnknownSourceSignals) return findings
        val hasSeriousIndicators = findings.any(::isSeriousFinding)
        if (hasSeriousIndicators || score >= 45) return findings
        return findings.filterNot { finding ->
            val type = finding.type.lowercase()
            type in unknownSourceFindingTypes || type in weakContextFindingTypes || isUnknownSourceFinding(finding)
        }
    }

    private fun shouldSuppressUnknownSourceOnlyThreat(
        originalFindings: List<DeepScanFinding>,
        filteredFindings: List<DeepScanFinding>,
        score: Int
    ): Boolean {
        if (originalFindings.isEmpty()) return false
        if (filteredFindings.isNotEmpty()) return false
        if (score >= 45) return false
        return originalFindings.any(::isUnknownSourceFinding) && originalFindings.none(::isSeriousFinding)
    }

    private fun isSeriousFinding(finding: DeepScanFinding): Boolean {
        val type = finding.type.lowercase()
        if (type in unknownSourceFindingTypes || type in weakContextFindingTypes) {
            return false
        }
        return severityRank(finding.severity) >= 2
    }

    private fun isUnknownSourceFinding(finding: DeepScanFinding): Boolean {
        val type = finding.type.lowercase()
        if (type in unknownSourceFindingTypes) {
            return true
        }
        val title = finding.title.lowercase()
        val detail = finding.detail.lowercase()
        return title.contains("unknown install source") ||
            title.contains("install source") ||
            detail.contains("installer package is missing") ||
            detail.contains("unknown source")
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

    private fun notificationStatusForScan(scanType: String): String = when (scanType.uppercase()) {
        "FULL", "SELECTIVE", "APK" -> "Идёт проверка"
        else -> "Идёт быстрая проверка"
    }

    private fun notificationStageForProgress(scannedCount: Int, totalCount: Int): String {
        if (totalCount <= 0) return "Подготавливаем проверку"
        val percent = ((scannedCount.coerceAtLeast(0).toFloat() / totalCount.toFloat()) * 100f).toInt().coerceIn(0, 100)
        return "Прогресс: $percent%"
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
