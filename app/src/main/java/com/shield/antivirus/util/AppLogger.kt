package com.shield.antivirus.util

import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.gson.Gson
import com.shield.antivirus.BuildConfig
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.ClientCrashEntry
import com.shield.antivirus.data.model.ClientLogEvent
import com.shield.antivirus.data.model.ClientLogsUploadRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

object AppLogger {
    private const val LOG_ROOT_DIR = "logs"
    private const val EVENTS_FILE = "events.jsonl"
    private const val CRASHES_FILE = "crashes.jsonl"
    private const val MAX_EVENTS_UPLOAD = 5000
    private const val MAX_CRASHES_UPLOAD = 500
    private const val UPLOAD_DEBOUNCE_MS = 90_000L
    const val UPLOAD_WORK_NAME = "shield_client_logs_upload"

    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val initialized = AtomicBoolean(false)
    private val lock = Mutex()
    private val lastEnqueueAt = AtomicLong(0L)
    private var appContext: Context? = null
    private val sessionId: String = UUID.randomUUID().toString()

    fun initialize(context: Context) {
        if (initialized.compareAndSet(false, true)) {
            appContext = context.applicationContext
            log(
                tag = "app",
                message = "Application started",
                metadata = mapOf(
                    "version_name" to BuildConfig.VERSION_NAME,
                    "version_code" to BuildConfig.VERSION_CODE.toString()
                )
            )
        }
    }

    fun installCrashHandler(context: Context) {
        initialize(context)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                runBlocking {
                    appendCrash(
                        throwable = throwable,
                        threadName = thread.name
                    )
                }
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    fun log(
        tag: String,
        message: String,
        level: String = "INFO",
        metadata: Map<String, String> = emptyMap()
    ) {
        val context = appContext ?: return
        scope.launch {
            appendEvent(
                event = ClientLogEvent(
                    id = UUID.randomUUID().toString(),
                    level = level.uppercase(Locale.US),
                    tag = tag.take(48),
                    message = sanitize(message),
                    timestamp = System.currentTimeMillis(),
                    metadata = metadata.mapValues { sanitize(it.value) }
                )
            )
            maybeScheduleUpload(context)
        }
    }

    fun logError(
        tag: String,
        message: String,
        error: Throwable? = null,
        metadata: Map<String, String> = emptyMap()
    ) {
        val merged = if (error == null) metadata else {
            metadata + mapOf(
                "error_type" to (error::class.java.simpleName ?: "Throwable"),
                "error_message" to sanitize(error.message ?: "no_message")
            )
        }
        log(tag = tag, message = message, level = "ERROR", metadata = merged)
        if (error != null) {
            val context = appContext ?: return
            scope.launch { appendCrash(error, Thread.currentThread().name) }
            maybeScheduleUpload(context)
        }
    }

    suspend fun uploadPending(accessToken: String): Boolean {
        val context = appContext ?: return true
        val files = collectPendingLogFiles(context)
        if (files.isEmpty()) return true

        var allOk = true
        files.forEach { candidate ->
            val events = readEvents(candidate.eventsFile).take(MAX_EVENTS_UPLOAD)
            val crashes = readCrashes(candidate.crashesFile).take(MAX_CRASHES_UPLOAD)
            if (events.isEmpty() && crashes.isEmpty()) return@forEach

            val request = ClientLogsUploadRequest(
                sessionId = candidate.sessionId,
                appVersion = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                device = mapOf(
                    "brand" to Build.BRAND.orEmpty(),
                    "model" to Build.MODEL.orEmpty(),
                    "sdk" to Build.VERSION.SDK_INT.toString(),
                    "release" to Build.VERSION.RELEASE.orEmpty()
                ),
                events = events,
                crashes = crashes
            )

            val uploaded = runCatching {
                ApiClient.executeShieldCall(shouldFailover = { it.code() >= 500 }) { api ->
                    api.uploadClientLogs("Bearer $accessToken", request)
                }.isSuccessful
            }.getOrDefault(false)

            if (uploaded) {
                trimUploadedEntries(candidate.eventsFile, events.size)
                trimUploadedEntries(candidate.crashesFile, crashes.size)
            } else {
                allOk = false
            }
        }
        return allOk
    }

    private suspend fun appendEvent(event: ClientLogEvent) {
        val context = appContext ?: return
        val targetFile = resolveSessionFile(context, EVENTS_FILE)
        lock.withLock {
            targetFile.appendText(gson.toJson(event) + "\n")
        }
    }

    private suspend fun appendCrash(throwable: Throwable, threadName: String) {
        val context = appContext ?: return
        val targetFile = resolveSessionFile(context, CRASHES_FILE)
        val crash = ClientCrashEntry(
            id = UUID.randomUUID().toString(),
            timestamp = System.currentTimeMillis(),
            thread = sanitize(threadName),
            type = throwable::class.java.name,
            message = sanitize(throwable.message ?: "no_message"),
            stackTrace = sanitize(throwable.stackTraceToString())
        )
        lock.withLock {
            targetFile.appendText(gson.toJson(crash) + "\n")
        }
    }

    private suspend fun resolveSessionFile(context: Context, fileName: String): File {
        val prefs = UserPreferences(context)
        val isGuest = prefs.isGuest.first()
        val userId = prefs.userId.first()
            .takeIf { it.isNotBlank() && !isGuest }
            ?: "guest"
        val dayKey = java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val dir = File(resolveLogRoot(context), "$userId/$sessionId/$dayKey")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return File(dir, fileName)
    }

    private suspend fun collectPendingLogFiles(context: Context): List<PendingLogFiles> {
        val root = resolveLogRoot(context)
        if (!root.exists()) return emptyList()
        val result = mutableListOf<PendingLogFiles>()
        root.walkTopDown()
            .maxDepth(4)
            .filter { it.isDirectory }
            .forEach { dir ->
                val events = File(dir, EVENTS_FILE)
                val crashes = File(dir, CRASHES_FILE)
                if ((events.exists() && events.length() > 0) || (crashes.exists() && crashes.length() > 0)) {
                    val parts = dir.invariantSeparatorsPath.substringAfter("$LOG_ROOT_DIR/")
                    val session = parts.split('/').getOrNull(1) ?: sessionId
                    result += PendingLogFiles(
                        sessionId = session,
                        eventsFile = events,
                        crashesFile = crashes
                    )
                }
            }
        return result
    }

    private fun readEvents(file: File): List<ClientLogEvent> {
        if (!file.exists()) return emptyList()
        return file.readLines()
            .mapNotNull { line ->
                runCatching { gson.fromJson(line, ClientLogEvent::class.java) }.getOrNull()
            }
    }

    private fun readCrashes(file: File): List<ClientCrashEntry> {
        if (!file.exists()) return emptyList()
        return file.readLines()
            .mapNotNull { line ->
                runCatching { gson.fromJson(line, ClientCrashEntry::class.java) }.getOrNull()
            }
    }

    private fun trimUploadedEntries(file: File, count: Int) {
        if (!file.exists() || count <= 0) return
        if (!lock.tryLock()) return
        try {
            val lines = file.readLines()
            val remained = if (lines.size <= count) emptyList() else lines.drop(count)
            file.writeText(remained.joinToString(separator = "\n", postfix = if (remained.isNotEmpty()) "\n" else ""))
        } finally {
            lock.unlock()
        }
    }

    private fun maybeScheduleUpload(context: Context) {
        val now = System.currentTimeMillis()
        val last = lastEnqueueAt.get()
        if (now - last < UPLOAD_DEBOUNCE_MS) return
        if (!lastEnqueueAt.compareAndSet(last, now)) return
        val request = OneTimeWorkRequestBuilder<LogUploadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UPLOAD_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    private fun sanitize(value: String): String {
        return value
            .replace(Regex("(?i)(bearer\\s+)[a-z0-9._-]+"), "$1***")
            .replace(Regex("(?i)(\"password\"\\s*:\\s*\")[^\"]+"), "$1***")
            .replace(Regex("(?i)(\"token\"\\s*:\\s*\")[^\"]+"), "$1***")
            .take(6000)
    }

    private fun resolveLogRoot(context: Context): File {
        val externalRoot = context.getExternalFilesDir(null)
        return if (externalRoot != null) {
            File(externalRoot, LOG_ROOT_DIR)
        } else {
            File(context.filesDir, LOG_ROOT_DIR)
        }
    }

    private data class PendingLogFiles(
        val sessionId: String,
        val eventsFile: File,
        val crashesFile: File
    )
}
