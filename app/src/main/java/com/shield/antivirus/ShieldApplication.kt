package com.shield.antivirus

import android.app.Application
import com.shield.antivirus.util.AppLogger

class ShieldApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AppLogger.initialize(this)
        AppLogger.installCrashHandler(this)
    }
}
