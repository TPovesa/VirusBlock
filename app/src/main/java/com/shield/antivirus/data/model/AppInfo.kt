package com.shield.antivirus.data.model

data class AppInfo(
    val packageName: String,
    val appName: String,
    val versionName: String,
    val versionCode: Long,
    val apkPath: String,
    val installTime: Long,
    val isSystemApp: Boolean,
    val requestedPermissions: List<String> = emptyList(),
    val installerPackage: String? = null,
    val targetSdk: Int? = null,
    val minSdk: Int? = null,
    val lastUpdateTime: Long = 0L,
    val sizeBytes: Long = 0L,
    val signatureSha256: String? = null,
    val certificateSubject: String? = null,
    val isDebuggable: Boolean = false,
    val usesCleartextTraffic: Boolean = false,
    var sha256: String = "",
    var scanStatus: ScanStatus = ScanStatus.PENDING
)

enum class ScanStatus {
    PENDING, SCANNING, CLEAN, SUSPICIOUS, MALICIOUS, ERROR
}
