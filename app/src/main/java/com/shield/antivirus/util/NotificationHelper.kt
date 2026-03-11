package com.shield.antivirus.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.shield.antivirus.MainActivity
import com.shield.antivirus.R

object NotificationHelper {
    const val CHANNEL_PROTECTION = "shield_protection"
    const val CHANNEL_THREATS    = "shield_threats"
    const val CHANNEL_SCAN       = "shield_scan"

    const val NOTIF_PROTECTION_ID = 1001
    const val NOTIF_THREAT_BASE   = 2000
    const val NOTIF_SCAN_ID       = 3001

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_PROTECTION,
                "Real-time Protection",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Persistent shield status" })

            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_THREATS,
                "Threat Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply { description = "Detected malware alerts" })

            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_SCAN,
                "Scan Progress",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "Scan progress updates" })
        }
    }

    fun buildProtectionNotification(context: Context) =
        NotificationCompat.Builder(context, CHANNEL_PROTECTION)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("Shield Antivirus")
            .setContentText("Real-time protection is active")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(buildMainIntent(context))
            .build()

    fun showThreatNotification(context: Context, appName: String, threatName: String, id: Int) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(context, CHANNEL_THREATS)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("⚠ Threat Detected!")
            .setContentText("$appName — $threatName")
            .setStyle(NotificationCompat.BigTextStyle()
                .bigText("Application \"$appName\" was flagged as: $threatName. Open Shield Antivirus to take action."))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(buildMainIntent(context))
            .build()
        nm.notify(NOTIF_THREAT_BASE + id, notif)
    }

    fun showScanNotification(context: Context, progress: Int, current: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(context, CHANNEL_SCAN)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Scanning...")
            .setContentText(current)
            .setProgress(100, progress, progress == 0)
            .setOngoing(true)
            .build()
        nm.notify(NOTIF_SCAN_ID, notif)
    }

    fun cancelScanNotification(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_SCAN_ID)
    }

    private fun buildMainIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
        return PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
