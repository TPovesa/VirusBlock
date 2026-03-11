package com.shield.antivirus.util

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import com.shield.antivirus.data.model.AppInfo
import com.shield.antivirus.data.model.ScanStatus

object PackageUtils {

    fun getAllInstalledApps(context: Context, includeSystem: Boolean = false): List<AppInfo> {
        val pm = context.packageManager

        @Suppress("DEPRECATION")
        val packages = pm.getInstalledPackages(PackageManager.GET_META_DATA or PackageManager.GET_PERMISSIONS)

        return packages.mapNotNull { pkg ->
            val appInfo = pkg.applicationInfo ?: return@mapNotNull null
            val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            if (!includeSystem && isSystem) return@mapNotNull null

            val installerPackage = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    pm.getInstallSourceInfo(pkg.packageName).installingPackageName
                } else {
                    @Suppress("DEPRECATION")
                    pm.getInstallerPackageName(pkg.packageName)
                }
            } catch (_: Exception) {
                null
            }

            AppInfo(
                packageName = pkg.packageName,
                appName = pm.getApplicationLabel(appInfo).toString(),
                versionName = pkg.versionName ?: "?",
                versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                    pkg.longVersionCode else pkg.versionCode.toLong(),
                apkPath = appInfo.sourceDir ?: "",
                installTime = pkg.firstInstallTime,
                isSystemApp = isSystem,
                requestedPermissions = pkg.requestedPermissions?.toList().orEmpty(),
                installerPackage = installerPackage,
                scanStatus = ScanStatus.PENDING
            )
        }.sortedBy { it.appName }
    }

    fun getUserApps(context: Context): List<AppInfo> = getAllInstalledApps(context, false)
}
