package com.shield.antivirus.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat.BigTextStyle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.shield.antivirus.MainActivity
import com.shield.antivirus.R

object NotificationHelper {
    const val CHANNEL_PROTECTION = "shield_protection"
    const val CHANNEL_SCAN = "shield_scan"

    const val NOTIF_PROTECTION_ID = 1001
    const val NOTIF_SCAN_ID = 3001
    const val NOTIF_SCAN_SUMMARY_ID = 3002

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_PROTECTION,
                    "Фоновая защита",
                    NotificationManager.IMPORTANCE_LOW
                ).apply { description = "Постоянный статус защиты" }
            )

            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_SCAN,
                    "Проверка",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = "Ход проверки" }
            )
        }
    }

    fun buildProtectionNotification(context: Context) =
        NotificationCompat.Builder(context, CHANNEL_PROTECTION)
            .setSmallIcon(R.drawable.ic_notification_shield)
            .setContentTitle("Shield Antivirus")
            .setContentText("Фоновая защита активна")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(buildMainIntent(context))
            .build()

    fun showScanNotification(
        context: Context,
        progress: Int,
        status: String,
        stage: String? = null,
        deepMode: Boolean = false
    ) {
        createChannels(context)
        NotificationManagerCompat.from(context).notify(
            NOTIF_SCAN_ID,
            buildScanNotification(
                context = context,
                progress = progress,
                status = status,
                stage = stage,
                deepMode = deepMode
            )
        )
    }

    fun buildScanNotification(
        context: Context,
        progress: Int,
        status: String,
        stage: String? = null,
        deepMode: Boolean = false
    ): android.app.Notification {
        createChannels(context)
        val normalizedProgress = progress.coerceIn(0, 100)
        val safeStatus = status.ifBlank { "Идёт проверка" }
        val safeStage = stage?.takeIf { it.isNotBlank() } ?: if (normalizedProgress <= 0) {
            "Подготавливаем проверку"
        } else {
            "Прогресс: $normalizedProgress%"
        }
        return NotificationCompat.Builder(context, CHANNEL_SCAN)
            .setSmallIcon(R.drawable.ic_notification_shield)
            .setContentTitle("Проверка")
            .setContentText(safeStatus)
            .setSubText(safeStage)
            .setStyle(
                BigTextStyle().bigText(
                    listOfNotNull(
                        safeStatus,
                        safeStage
                    ).joinToString(separator = "\n")
                )
            )
            .setProgress(100, normalizedProgress, normalizedProgress <= 0)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(buildMainIntent(context))
            .build()
    }

    fun showScanSummaryNotification(
        context: Context,
        threatsFound: Int,
        deepMode: Boolean = false
    ) {
        createChannels(context)
        val summary = if (threatsFound > 0) {
            "Угрозы найдены: $threatsFound"
        } else {
            "Угроз не найдено"
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_SCAN)
            .setSmallIcon(R.drawable.ic_notification_shield)
            .setContentTitle(if (deepMode) "Глубокая проверка завершена" else "Проверка завершена")
            .setContentText(summary)
            .setStyle(BigTextStyle().bigText(summary))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(buildMainIntent(context))
            .build()
        NotificationManagerCompat.from(context).notify(NOTIF_SCAN_SUMMARY_ID, notification)
    }

    fun cancelScanNotification(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIF_SCAN_ID)
    }

    private fun buildMainIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
