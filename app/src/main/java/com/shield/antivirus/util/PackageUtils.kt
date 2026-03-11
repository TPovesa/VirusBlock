package com.shield.antivirus.util

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import com.shield.antivirus.data.model.AppInfo
import com.shield.antivirus.data.model.ScanStatus
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

object PackageUtils {

    fun getAllInstalledApps(context: Context, includeSystem: Boolean = false): List<AppInfo> {
        val pm = context.packageManager

        @Suppress("DEPRECATION")
        val packages = pm.getInstalledPackages(
            PackageManager.GET_META_DATA or
                PackageManager.GET_PERMISSIONS or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    PackageManager.GET_SIGNING_CERTIFICATES
                } else {
                    PackageManager.GET_SIGNATURES
                }
        )

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

            val signatureBytes = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    val signingInfo = pkg.signingInfo
                    val signers = if (signingInfo?.hasMultipleSigners() == true) {
                        signingInfo.apkContentsSigners
                    } else {
                        signingInfo?.signingCertificateHistory
                    }
                    signers?.firstOrNull()?.toByteArray()
                } else {
                    @Suppress("DEPRECATION")
                    pkg.signatures?.firstOrNull()?.toByteArray()
                }
            } catch (_: Exception) {
                null
            }

            val signatureSha256 = signatureBytes?.let { bytes ->
                runCatching {
                    MessageDigest.getInstance("SHA-256")
                        .digest(bytes)
                        .joinToString("") { "%02x".format(it) }
                }.getOrNull()
            }

            val certificateSubject = signatureBytes?.let { bytes ->
                runCatching {
                    val certificateFactory = CertificateFactory.getInstance("X.509")
                    val certificate = certificateFactory.generateCertificate(ByteArrayInputStream(bytes)) as X509Certificate
                    certificate.subjectX500Principal.name
                }.getOrNull()
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
                targetSdk = appInfo.targetSdkVersion,
                minSdk = appInfo.minSdkVersion,
                lastUpdateTime = pkg.lastUpdateTime,
                sizeBytes = runCatching { File(appInfo.sourceDir).length() }.getOrDefault(0L),
                signatureSha256 = signatureSha256,
                certificateSubject = certificateSubject,
                isDebuggable = (appInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
                usesCleartextTraffic = (appInfo.flags and ApplicationInfo.FLAG_USES_CLEARTEXT_TRAFFIC) != 0,
                scanStatus = ScanStatus.PENDING
            )
        }.sortedBy { it.appName }
    }

    fun getUserApps(context: Context): List<AppInfo> = getAllInstalledApps(context, false)
}
