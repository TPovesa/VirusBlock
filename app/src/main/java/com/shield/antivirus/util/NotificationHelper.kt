package com.shield.antivirus.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.shield.antivirus.MainActivity
import com.shield.antivirus.R

object NotificationHelper {
    const val CHANNEL_PROTECTION = "shield_protection"
    const val CHANNEL_THREATS = "shield_threats"
    const val CHANNEL_SCAN = "shield_scan"

    const val NOTIF_PROTECTION_ID = 1001
    const val NOTIF_THREAT_BASE = 2000
    const val NOTIF_SCAN_ID = 3001

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
                    CHANNEL_THREATS,
                    "Угрозы",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { description = "Оповещения об угрозах" }
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

    fun showThreatNotification(context: Context, appName: String, threatName: String, id: Int) {
        val notification = NotificationCompat.Builder(context, CHANNEL_THREATS)
            .setSmallIcon(R.drawable.ic_notification_shield)
            .setContentTitle("Обнаружена угроза")
            .setContentText("$appName: $threatName")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "Приложение \"$appName\" помечено как угроза: $threatName. Откройте Shield Antivirus и проверьте результат."
                )
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(buildMainIntent(context))
            .build()
        NotificationManagerCompat.from(context).notify(NOTIF_THREAT_BASE + id, notification)
    }

    fun showScanNotification(context: Context, progress: Int, current: String) {
        val notification = NotificationCompat.Builder(context, CHANNEL_SCAN)
            .setSmallIcon(R.drawable.ic_notification_shield)
            .setContentTitle("Идёт проверка")
            .setContentText(current)
            .setProgress(100, progress, progress == 0)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(buildMainIntent(context))
            .build()
        NotificationManagerCompat.from(context).notify(NOTIF_SCAN_ID, notification)
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
