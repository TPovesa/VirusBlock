package com.shield.antivirus.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.shield.antivirus.data.datastore.UserPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class AppInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val packageName = intent.data?.schemeSpecificPart ?: return
        val action = intent.action ?: return

        if (action == Intent.ACTION_PACKAGE_ADDED || action == Intent.ACTION_PACKAGE_REPLACED) {
            CoroutineScope(Dispatchers.IO).launch {
                val prefs = UserPreferences(context)
                val scanOnInstall = prefs.scanOnInstall.first()
                if (scanOnInstall) {
                    // Trigger a quick scan notification for the new app
                    val pm = context.packageManager
                    val appName = try {
                        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
                    } catch (e: Exception) { packageName }
                    // Notification is handled by AntivirusService / ScanRepository
                }
            }
        }
    }
}
