package com.shield.antivirus.service

import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.shield.antivirus.util.NotificationHelper

class AntivirusService : Service() {

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationHelper.buildProtectionNotification(this)
        startForeground(NotificationHelper.NOTIF_PROTECTION_ID, notification)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        // Restart service if killed
        val restartIntent = Intent(applicationContext, AntivirusService::class.java)
        startService(restartIntent)
    }
}
