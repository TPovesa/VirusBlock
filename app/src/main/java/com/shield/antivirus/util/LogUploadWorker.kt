package com.shield.antivirus.util

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.shield.antivirus.data.security.ShieldSessionManager

class LogUploadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            AppLogger.initialize(applicationContext)
            val accessToken = ShieldSessionManager(applicationContext).getValidAccessToken()
                ?: return Result.success()
            val uploaded = AppLogger.uploadPending(accessToken)
            if (uploaded) Result.success() else Result.retry()
        } catch (error: Exception) {
            AppLogger.logError(
                tag = "log_upload_worker",
                message = "Log upload failed",
                error = error
            )
            Result.retry()
        }
    }
}
