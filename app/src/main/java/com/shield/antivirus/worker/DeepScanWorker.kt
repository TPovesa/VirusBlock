package com.shield.antivirus.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.repository.ScanProgress
import com.shield.antivirus.data.repository.ScanRepository
import com.shield.antivirus.util.AppLogger
import com.shield.antivirus.util.NotificationHelper

class DeepScanWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val scanType = inputData.getString(KEY_SCAN_TYPE) ?: return Result.failure()
        val selectedPackages = inputData.getString(KEY_SELECTED_PACKAGES)
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotBlank() }
            .orEmpty()
        val apkUri = inputData.getString(KEY_APK_URI)?.ifBlank { null }

        val repo = ScanRepository(applicationContext)
        val prefs = UserPreferences(applicationContext)
        var lastProgress = ScanProgress(totalCount = 1)
        return try {
            AppLogger.log(
                tag = "deep_scan_worker",
                message = "Deep worker started",
                metadata = mapOf(
                    "scan_type" to scanType,
                    "selected_count" to selectedPackages.size.toString(),
                    "has_apk_uri" to (!apkUri.isNullOrBlank()).toString()
                )
            )
            NotificationHelper.createChannels(applicationContext)
            setForeground(createForegroundInfo(scanType, lastProgress))

            repo.startScan(
                scanType = scanType,
                selectedPackages = selectedPackages,
                apkUriString = apkUri,
                manageNotifications = false
            ).collect { progress ->
                lastProgress = progress
                setForeground(createForegroundInfo(scanType, progress))
                setProgress(progress.toWorkData(scanType))
            }

            prefs.clearActiveDeepScan()
            NotificationHelper.cancelScanNotification(applicationContext)
            AppLogger.log(
                tag = "deep_scan_worker",
                message = "Deep worker completed",
                metadata = mapOf(
                    "scan_type" to scanType,
                    "saved_id" to lastProgress.savedId.toString()
                )
            )
            Result.success(lastProgress.toWorkData(scanType))
        } catch (error: Exception) {
            Log.e("DeepScanWorker", "Deep scan failed", error)
            AppLogger.logError(
                tag = "deep_scan_worker",
                message = "Deep worker failed",
                error = error,
                metadata = mapOf("scan_type" to scanType)
            )
            prefs.clearActiveDeepScan()
            NotificationHelper.cancelScanNotification(applicationContext)
            Result.failure(
                lastProgress.toWorkData(
                    scanType = scanType,
                    errorMessage = error.message ?: "Глубокая проверка завершилась с ошибкой"
                )
            )
        }
    }

    private fun createForegroundInfo(scanType: String, progress: ScanProgress): ForegroundInfo {
        val notification = NotificationHelper.buildScanNotification(
            context = applicationContext,
            progress = progress.progressPercent(),
            current = progress.currentApp.ifBlank { if (progress.isComplete) "Результат сохранён" else "Серверный анализ" },
            stage = progress.stageLabel(scanType),
            deepMode = true
        )
        return ForegroundInfo(NotificationHelper.NOTIF_SCAN_ID, notification)
    }

    companion object {
        const val UNIQUE_WORK_NAME = "shield_deep_scan_active"
        const val KEY_SCAN_TYPE = "scan_type"
        const val KEY_SELECTED_PACKAGES = "selected_packages"
        const val KEY_APK_URI = "apk_uri"
        const val KEY_CURRENT_APP = "current_app"
        const val KEY_SCANNED_COUNT = "scanned_count"
        const val KEY_TOTAL_COUNT = "total_count"
        const val KEY_IS_COMPLETE = "is_complete"
        const val KEY_SAVED_ID = "saved_id"
        const val KEY_THREATS_FOUND = "threats_found"
        const val KEY_ERROR_MESSAGE = "error_message"

        fun enqueue(
            context: Context,
            scanType: String,
            selectedPackages: List<String>,
            apkUri: String? = null
        ): java.util.UUID {
            val request = OneTimeWorkRequestBuilder<DeepScanWorker>()
                .setInputData(
                    workDataOf(
                        KEY_SCAN_TYPE to scanType,
                        KEY_SELECTED_PACKAGES to selectedPackages.joinToString(","),
                        KEY_APK_URI to apkUri.orEmpty()
                    )
                )
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request
            )
            return request.id
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
        }

        fun isDeepScan(workInfo: WorkInfo?): Boolean {
            val scanType = workInfo?.progress?.getString(KEY_SCAN_TYPE)
                ?: workInfo?.outputData?.getString(KEY_SCAN_TYPE)
            return scanType == "FULL" || scanType == "SELECTIVE" || scanType == "APK"
        }
    }
}

private fun ScanProgress.toWorkData(scanType: String, errorMessage: String? = null) = workDataOf(
    DeepScanWorker.KEY_SCAN_TYPE to scanType,
    DeepScanWorker.KEY_CURRENT_APP to (errorMessage ?: currentApp),
    DeepScanWorker.KEY_SCANNED_COUNT to scannedCount,
    DeepScanWorker.KEY_TOTAL_COUNT to totalCount,
    DeepScanWorker.KEY_IS_COMPLETE to isComplete,
    DeepScanWorker.KEY_SAVED_ID to savedId,
    DeepScanWorker.KEY_THREATS_FOUND to threats.size,
    DeepScanWorker.KEY_ERROR_MESSAGE to errorMessage.orEmpty()
)

private fun ScanProgress.progressPercent(): Int =
    if (totalCount <= 0) 0 else (((scannedCount.coerceAtLeast(0)).toFloat() / totalCount.toFloat()) * 100f).toInt()

private fun ScanProgress.stageLabel(scanType: String): String = when {
    isComplete -> "Результат готов"
    scanType == "FULL" && scannedCount <= 0 -> "Подготовка APK и серверного анализа"
    scanType == "APK" && scannedCount <= 0 -> "Проверка APK и запуск серверного анализа"
    progressPercent() < 25 -> "Хэши и метаданные"
    progressPercent() < 65 -> "Эвристика, VT и статический анализ"
    else -> "Сохраняем результат"
}
