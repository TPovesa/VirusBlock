package com.shield.antivirus.data.repository

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.google.gson.Gson
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.local.AppDatabase
import com.shield.antivirus.data.model.AppInfo
import com.shield.antivirus.data.model.DeepScanFinding
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

class ScanRepository(private val context: Context) {
    private val dao = AppDatabase.getInstance(context).scanResultDao()
    private val prefs = UserPreferences(context)
    private val gson = Gson()
    private val localThreatDetector = LocalThreatDetector(context)
    private val sessionManager = ShieldSessionManager(context)
    private val trustedInstallers = setOf(
        "com.android.vending",
        "com.google.android.packageinstaller",
        "com.android.packageinstaller",
        "com.sec.android.app.samsungapps",
        "com.huawei.appmarket",
        "com.xiaomi.market",
        "com.amazon.venezia",
        "com.oppo.market",
        "com.heytap.market"
    )
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
        manageNotifications: Boolean = true
    ): Flow<ScanProgress> = flow {
        val normalizedType = scanType.uppercase()
        var lockAcquired = false
        try {
            AppLogger.log(
                tag = "scan_repository",
                message = "Scan start requested",
                metadata = mapOf(
                    "scan_type" to normalizedType,
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
                        NotificationHelper.showScanNotification(context, 12, displayName)
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
                    val threats = runCatching {
                        checkWithServerDeepScan(
                            app = syntheticApp,
                            accessToken = token,
                            scanType = normalizedType
                        )
                    }.getOrElse { emptyList() }

                    if (threats.isNotEmpty()) {
                        val mainThreat = threats.maxByOrNull { threatRank(it.severity) } ?: threats.first()
                        NotificationHelper.showThreatNotification(
                            context,
                            displayName,
                            mainThreat.threatName,
                            0
                        )
                    }

                    withContext(Dispatchers.IO) {
                        prefs.updateActiveScan(normalizedType, "Сохранение результата", 1, 1)
                    }
                    if (manageNotifications) {
                        NotificationHelper.cancelScanNotification(context)
                    }
                    prefs.updateLastScanTime()

                    val entity = ScanResultEntity(
                        scanType = normalizedType,
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
                    "QUICK" -> PackageUtils.getHybridQuickApps(context)
                    "FULL" -> PackageUtils.getAllInstalledApps(context, includeSystem = true)
                    "SELECTIVE" -> {
                        val installedApps = PackageUtils.getAllInstalledApps(context, includeSystem = true)
                        if (selectedPackages.isEmpty()) installedApps else installedApps.filter { it.packageName in selectedPackages }
                    }
                    else -> PackageUtils.getAllInstalledApps(context, includeSystem = true)
                }
            }

            val accessToken = withContext(Dispatchers.IO) { sessionManager.getValidAccessToken() }
            val useServerDeepScan = normalizedType != "QUICK" && !accessToken.isNullOrBlank()
            if (normalizedType != "QUICK" && accessToken.isNullOrBlank()) {
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
            val maxServerChecks = when (normalizedType) {
                "FULL" -> {
                    val target = (total * 0.55f).toInt().coerceAtLeast(18)
                    target.coerceAtMost(64).coerceAtMost(total)
                }
                "SELECTIVE" -> {
                    val target = if (selectedPackages.isNotEmpty()) total else (total * 0.85f).toInt().coerceAtLeast(24)
                    target.coerceAtMost(96).coerceAtMost(total)
                }
                else -> 0
            }
            val localThreatOverflowCap = when (normalizedType) {
                "FULL" -> 12
                "SELECTIVE" -> 24
                else -> 0
            }
            val hardServerChecksCap = maxServerChecks + localThreatOverflowCap
            var serverChecksUsed = 0
            var serverChecksFailed = 0
            var serverChecksSucceeded = 0
            var forcedLocalThreatChecks = 0

            AppLogger.log(
                tag = "scan_repository",
                message = "Scan app pool resolved",
                metadata = mapOf(
                    "scan_type" to normalizedType,
                    "apps_total" to total.toString(),
                    "server_enabled" to useServerDeepScan.toString(),
                    "server_max_checks" to maxServerChecks.toString(),
                    "server_hard_cap" to hardServerChecksCap.toString(),
                    "server_local_overflow_cap" to localThreatOverflowCap.toString()
                )
            )
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
                withContext(Dispatchers.IO) {
                    prefs.updateActiveScan(normalizedType, app.appName, index, total.coerceAtLeast(1))
                }

                if (manageNotifications) {
                    NotificationHelper.showScanNotification(
                        context,
                        (((index + 1).toFloat() / total.coerceAtLeast(1)) * 100).toInt(),
                        app.appName
                    )
                }

                val localThreat = runCatching {
                    withContext(Dispatchers.IO) { localThreatDetector.scan(app, quickMode = normalizedType == "QUICK") }
                }.onFailure { error ->
                    AppLogger.logError(
                        tag = "scan_repository",
                        message = "Local detector failed",
                        error = error,
                        metadata = mapOf("package" to app.packageName)
                    )
                }.getOrNull()

                val shouldEscalateNormally = shouldEscalateForServer(app, localThreat, normalizedType, index)
                val shouldForceBecauseLocalThreat = useServerDeepScan &&
                    localThreat != null &&
                    serverChecksUsed >= maxServerChecks &&
                    serverChecksUsed < hardServerChecksCap
                val shouldUseServerForApp = useServerDeepScan &&
                    serverChecksUsed < hardServerChecksCap &&
                    (shouldEscalateNormally || shouldForceBecauseLocalThreat)

                val threatBatch = if (shouldUseServerForApp) {
                    if (shouldForceBecauseLocalThreat) {
                        forcedLocalThreatChecks++
                    }
                    serverChecksUsed++
                    var requestFailed = false
                    val serverThreats = runCatching {
                        withContext(Dispatchers.IO) {
                            checkWithServerDeepScan(app, accessToken.orEmpty(), normalizedType)
                        }
                    }.onFailure { error ->
                        requestFailed = true
                        AppLogger.logError(
                            tag = "scan_repository",
                            message = "Server deep scan failed for app",
                            error = error,
                            metadata = mapOf(
                                "scan_type" to normalizedType,
                                "package" to app.packageName
                            )
                        )
                    }.getOrElse { emptyList() }
                    if (requestFailed) {
                        serverChecksFailed++
                    } else {
                        serverChecksSucceeded++
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

            withContext(Dispatchers.IO) {
                prefs.updateActiveScan(normalizedType, "Сохранение результата", total, total.coerceAtLeast(1))
            }
            if (manageNotifications) {
                NotificationHelper.cancelScanNotification(context)
            }
            prefs.updateLastScanTime()

            val entity = ScanResultEntity(
                scanType = normalizedType,
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

            val completionMessage = if (
                useServerDeepScan &&
                serverChecksUsed > 0 &&
                serverChecksSucceeded == 0 &&
                serverChecksFailed >= serverChecksUsed
            ) {
                "Серверный анализ недоступен, применены локальные проверки."
            } else {
                ""
            }
            emit(
                ScanProgress(
                    currentApp = completionMessage,
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
                    "server_checks_succeeded" to serverChecksSucceeded.toString(),
                    "server_forced_local_threat_checks" to forcedLocalThreatChecks.toString()
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
        return try {
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
                AppLogger.log(
                    tag = "scan_repository",
                    message = "Deep scan start rejected",
                    level = "WARN",
                    metadata = mapOf(
                        "package" to app.packageName,
                        "status_code" to startResponse.code().toString()
                    )
                )
                return emptyList()
            }

            if (initialJob?.nextAction.equals("upload_apk", ignoreCase = true)) {
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
                    return emptyList()
                }
                val uploaded = uploadDeepScanApk(
                    scanId = scanId,
                    app = app,
                    apkFile = apkFile,
                    accessToken = accessToken,
                    reason = "required_by_server"
                )
                if (!uploaded) {
                    return emptyList()
                }
                apkUploaded = true
            }

            val firstCompleted = pollDeepScanUntilCompleted(scanId, accessToken) ?: return emptyList()

            var finalJob = firstCompleted
            if (!apkUploaded && canAutoUploadApkSecondStage && shouldAutoUploadAfterFirstCompletion(firstCompleted)) {
                val secondStageUploaded = uploadDeepScanApk(
                    scanId = scanId,
                    app = app,
                    apkFile = apkFile,
                    accessToken = accessToken,
                    reason = "client_second_stage"
                )
                if (secondStageUploaded) {
                    apkUploaded = true
                    val enrichedJob = pollDeepScanUntilCompleted(scanId, accessToken)
                    if (enrichedJob != null) {
                        finalJob = enrichedJob
                    } else {
                        AppLogger.log(
                            tag = "scan_repository",
                            message = "Second-stage deep scan polling failed, using first completed result",
                            level = "WARN",
                            metadata = mapOf(
                                "scan_id" to scanId,
                                "package" to app.packageName
                            )
                        )
                    }
                } else {
                    AppLogger.log(
                        tag = "scan_repository",
                        message = "Second-stage APK upload failed, using first completed result",
                        level = "WARN",
                        metadata = mapOf(
                            "scan_id" to scanId,
                            "package" to app.packageName
                        )
                    )
                }
            }

            mapDeepScanToThreats(app, finalJob)
        } catch (error: Exception) {
            AppLogger.logError(
                tag = "scan_repository",
                message = "Deep scan exception",
                error = error,
                metadata = mapOf(
                    "package" to app.packageName,
                    "scan_type" to scanType
                )
            )
            emptyList()
        }
    }

    private suspend fun uploadDeepScanApk(
        scanId: String,
        app: AppInfo,
        apkFile: File,
        accessToken: String,
        reason: String
    ): Boolean {
        if (!apkFile.exists() || !apkFile.canRead()) {
            return false
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
            AppLogger.log(
                tag = "scan_repository",
                message = "APK upload rejected",
                level = "WARN",
                metadata = mapOf(
                    "scan_id" to scanId,
                    "package" to app.packageName,
                    "status_code" to uploadResponse.code().toString(),
                    "reason" to reason
                )
            )
            return false
        }
        return true
    }

    private suspend fun pollDeepScanUntilCompleted(scanId: String, accessToken: String): DeepScanJob? {
        repeat(16) { attempt ->
            delay(if (attempt < 3) 450L else 900L)
            val pollResponse = ApiClient.executeShieldCall { api ->
                api.getDeepScan("Bearer $accessToken", scanId)
            }
            if (!pollResponse.isSuccessful) {
                AppLogger.log(
                    tag = "scan_repository",
                    message = "Deep scan polling rejected",
                    level = "WARN",
                    metadata = mapOf(
                        "scan_id" to scanId,
                        "status_code" to pollResponse.code().toString()
                    )
                )
                return null
            }

            val currentJob = pollResponse.body()?.scan ?: return null
            when (currentJob.status.uppercase()) {
                "AWAITING_UPLOAD", "QUEUED", "RUNNING" -> Unit
                "FAILED" -> return null
                "COMPLETED" -> return currentJob
                else -> return null
            }
        }
        return null
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

    private fun shouldEscalateForServer(
        app: AppInfo,
        localThreat: ThreatInfo?,
        scanType: String,
        index: Int
    ): Boolean {
        if (scanType == "SELECTIVE") return true
        if (localThreat != null) return true
        if (index < 5) return true
        if (!app.isSystemApp) return true

        val permissions = app.requestedPermissions.toSet()
        val hasAccessibility = permissions.contains("android.permission.BIND_ACCESSIBILITY_SERVICE")
        val hasOverlay = permissions.contains("android.permission.SYSTEM_ALERT_WINDOW")
        val hasInstaller = permissions.contains("android.permission.REQUEST_INSTALL_PACKAGES")
        val hasQueryAll = permissions.contains("android.permission.QUERY_ALL_PACKAGES")
        val hasSms = permissions.contains("android.permission.READ_SMS") ||
            permissions.contains("android.permission.RECEIVE_SMS") ||
            permissions.contains("android.permission.SEND_SMS")

        if (hasAccessibility && hasOverlay) return true
        if (hasInstaller && hasQueryAll) return true
        if (hasSms) return true
        if (permissions.size >= 15) return true
        if ((app.targetSdk ?: Int.MAX_VALUE) <= 28) return true
        if ((app.sizeBytes in 1L until (180L * 1024L)) && (hasAccessibility || hasOverlay || hasSms)) return true
        if (app.isDebuggable || app.usesCleartextTraffic) return true
        if (app.installerPackage.isNullOrBlank()) return true
        val installer = app.installerPackage.lowercase()
        if (installer !in trustedInstallers) return true
        return false
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

        val sourceThreats = filteredFindings
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
                    totalEngines = filteredFindings.size.coerceAtLeast(items.size),
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
