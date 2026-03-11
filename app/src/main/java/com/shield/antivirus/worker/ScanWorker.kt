package com.shield.antivirus.worker

import android.content.Context
import androidx.work.*
import com.shield.antivirus.data.repository.ScanRepository
import kotlinx.coroutines.flow.collect
import java.util.concurrent.TimeUnit

class ScanWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            val repo = ScanRepository(applicationContext)
            repo.startScan("QUICK").collect()
            Result.success()
        } catch (e: Exception) {
            Result.failure()
        }
    }

    companion object {
        fun schedulePeriodicScan(context: Context) {
            val request = PeriodicWorkRequestBuilder<ScanWorker>(24, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "periodic_scan",
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }
}
