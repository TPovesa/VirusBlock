package com.shield.antivirus.data.scanner

import android.content.Context
import com.google.gson.Gson
import com.shield.antivirus.R
import com.shield.antivirus.data.model.AppInfo
import com.shield.antivirus.data.model.ThreatInfo
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.util.HashUtils
import java.io.File

data class LocalThreatIntel(
    val trustedInstallers: List<String> = emptyList(),
    val suspiciousKeywords: List<String> = emptyList(),
    val riskyPermissions: List<String> = emptyList(),
    val highRiskPermissionCombos: List<List<String>> = emptyList(),
    val blockedPackagePrefixes: List<String> = emptyList(),
    val blockedHashes: List<String> = emptyList()
)

class LocalThreatDetector(context: Context) {
    private val appContext = context.applicationContext
    private val intel: LocalThreatIntel by lazy {
        appContext.resources.openRawResource(R.raw.local_threat_intel).bufferedReader().use { reader ->
            Gson().fromJson(reader, LocalThreatIntel::class.java)
        }
    }

    fun scan(app: AppInfo): ThreatInfo? {
        val normalizedPackage = app.packageName.lowercase()
        val normalizedName = app.appName.lowercase()
        val permissions = app.requestedPermissions.toSet()
        val installer = app.installerPackage?.lowercase().orEmpty()
        val apkHash = app.sha256.ifBlank {
            HashUtils.sha256(File(app.apkPath)).orEmpty()
        }

        if (apkHash.isNotBlank() && intel.blockedHashes.any { it.equals(apkHash, ignoreCase = true) }) {
            return ThreatInfo(
                packageName = app.packageName,
                appName = app.appName,
                threatName = "Локальная сигнатура",
                severity = ThreatSeverity.CRITICAL,
                detectionEngine = "Shield локальные правила",
                detectionCount = 1,
                totalEngines = 1
            )
        }

        if (intel.blockedPackagePrefixes.any { normalizedPackage.startsWith(it.lowercase()) }) {
            return ThreatInfo(
                packageName = app.packageName,
                appName = app.appName,
                threatName = "Запрещённое семейство пакетов",
                severity = ThreatSeverity.HIGH,
                detectionEngine = "Shield локальные правила",
                detectionCount = 1,
                totalEngines = 1
            )
        }

        if (app.isSystemApp) return null

        val keywordHits = intel.suspiciousKeywords.filter { keyword ->
            normalizedPackage.contains(keyword) || normalizedName.contains(keyword)
        }
        val riskyPermissions = permissions.intersect(intel.riskyPermissions.toSet())
        val matchedCombos = intel.highRiskPermissionCombos.filter { combo ->
            combo.all { permissions.contains(it) }
        }
        val untrustedInstaller = installer.isBlank() || installer !in intel.trustedInstallers.map { it.lowercase() }

        val score = (keywordHits.size * 2) + riskyPermissions.size + (matchedCombos.size * 3) + if (untrustedInstaller) 1 else 0
        if (score < 4) return null

        val severity = when {
            score >= 9 -> ThreatSeverity.HIGH
            score >= 6 -> ThreatSeverity.MEDIUM
            else -> ThreatSeverity.LOW
        }

        val threatName = when {
            matchedCombos.isNotEmpty() -> "Эвристика: опасные разрешения"
            keywordHits.isNotEmpty() -> "Эвристика: подозрительные признаки"
            else -> "Эвристика: рискованная установка"
        }

        return ThreatInfo(
            packageName = app.packageName,
            appName = app.appName,
            threatName = threatName,
            severity = severity,
            detectionEngine = "Shield локальные правила",
            detectionCount = keywordHits.size + matchedCombos.size,
            totalEngines = riskyPermissions.size.coerceAtLeast(1)
        )
    }
}
