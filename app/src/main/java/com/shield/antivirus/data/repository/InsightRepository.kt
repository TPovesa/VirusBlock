package com.shield.antivirus.data.repository

import android.content.Context
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.model.ExplainResultPayload
import com.shield.antivirus.data.model.ExplainScanRequest
import com.shield.antivirus.data.model.ExplainSummaryPayload
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.data.security.ShieldSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class InsightRepository(context: Context) {
    private val sessionManager = ShieldSessionManager(context.applicationContext)

    suspend fun explainResult(
        result: ScanResult,
        isGuest: Boolean
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val token = sessionManager.getValidAccessToken()
            val response = ApiClient.executeShieldCall { api ->
                api.explainScan(
                    token = token?.let { "Bearer $it" },
                    request = ExplainScanRequest(
                        summary = ExplainSummaryPayload(
                            verdict = when {
                                result.threatsFound > 0 -> "warning"
                                else -> "clean"
                            },
                            riskScore = when {
                                result.threatsFound > 6 -> 88
                                result.threatsFound > 0 -> 61
                                else -> 14
                            },
                            mode = if (isGuest) "guest-result" else "scan-result",
                            isGuest = isGuest,
                            protectionActive = !isGuest,
                            totalScans = 1,
                            totalThreats = result.threatsFound,
                            lastScanTime = result.completedAt
                        ),
                        result = ExplainResultPayload(
                            findings = result.threats,
                            scanType = result.scanType,
                            totalScanned = result.totalScanned,
                            threatsFound = result.threatsFound,
                            latestCompletedAt = result.completedAt,
                            notes = buildDetailedNotes(
                                title = if (isGuest) "Гостевая проверка завершена" else "Проверка завершена",
                                result = result
                            )
                        )
                    )
                )
            }
            if (!response.isSuccessful) {
                throw IllegalStateException("Не удалось получить объяснение")
            }
            val body = response.body()
            val explanation = body?.explanation?.trim().orEmpty()
            if (body?.success == true && explanation.isNotBlank()) {
                explanation
            } else {
                throw IllegalStateException(body?.error ?: "Пустой ответ сервера")
            }
        }
    }

    suspend fun explainOverview(
        verdict: String,
        riskScore: Int,
        mode: String,
        protectionActive: Boolean,
        totalScans: Int,
        totalThreats: Int,
        lastScanTime: Long,
        notes: String,
        recentResults: List<ScanResult>,
        isGuest: Boolean
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val latest = recentResults.firstOrNull()
            val token = sessionManager.getValidAccessToken()
            val response = ApiClient.executeShieldCall { api ->
                api.explainScan(
                    token = token?.let { "Bearer $it" },
                    request = ExplainScanRequest(
                        summary = ExplainSummaryPayload(
                            verdict = verdict,
                            riskScore = riskScore,
                            mode = mode,
                            isGuest = isGuest,
                            protectionActive = protectionActive,
                            totalScans = totalScans,
                            totalThreats = totalThreats,
                            lastScanTime = lastScanTime
                        ),
                        result = ExplainResultPayload(
                            findings = latest?.threats.orEmpty(),
                            scanType = latest?.scanType,
                            totalScanned = latest?.totalScanned,
                            threatsFound = latest?.threatsFound,
                            latestCompletedAt = latest?.completedAt,
                            notes = if (latest == null) {
                                notes
                            } else {
                                buildDetailedNotes(title = notes, result = latest)
                            }
                        )
                    )
                )
            }
            if (!response.isSuccessful) {
                throw IllegalStateException("Не удалось получить объяснение")
            }
            val body = response.body()
            val explanation = body?.explanation?.trim().orEmpty()
            if (body?.success == true && explanation.isNotBlank()) {
                explanation
            } else {
                throw IllegalStateException(body?.error ?: "Пустой ответ сервера")
            }
        }
    }

    private fun buildDetailedNotes(title: String, result: ScanResult): String {
        val findings = result.threats
        val severityStats = findings.groupingBy { it.severity }.eachCount()
        val sourceStats = findings.groupingBy { it.detectionEngine.ifBlank { "unknown" } }.eachCount()
            .toList()
            .sortedByDescending { it.second }
            .take(12)

        val topFindings = findings
            .sortedWith(
                compareByDescending<com.shield.antivirus.data.model.ThreatInfo> { severityRank(it.severity) }
                    .thenByDescending { it.detectionCount }
            )
            .take(20)

        val topFindingsBlock = if (topFindings.isEmpty()) {
            "Топ сигналов: отсутствуют."
        } else {
            topFindings.joinToString(
                separator = "\n",
                prefix = "Топ сигналов:\n"
            ) { threat ->
                "- ${threat.appName} (${threat.packageName}) | ${threat.threatName} | " +
                    "severity=${threat.severity} | detect=${threat.detectionCount}/${threat.totalEngines} | " +
                    "engine=${threat.detectionEngine}" +
                    (if (threat.summary.isNullOrBlank()) "" else " | summary=${threat.summary}")
            }
        }

        val sourcesBlock = if (sourceStats.isEmpty()) {
            "Источники: нет."
        } else {
            sourceStats.joinToString(
                separator = "\n",
                prefix = "Источники:\n"
            ) { (source, count) -> "- $source: $count" }
        }

        return buildString {
            appendLine(title)
            appendLine("scan_type=${result.scanType}")
            appendLine("total_scanned=${result.totalScanned}")
            appendLine("threats_found=${result.threatsFound}")
            appendLine(
                "severity_distribution=" +
                    "low=${severityStats[ThreatSeverity.LOW] ?: 0}," +
                    "medium=${severityStats[ThreatSeverity.MEDIUM] ?: 0}," +
                    "high=${severityStats[ThreatSeverity.HIGH] ?: 0}," +
                    "critical=${severityStats[ThreatSeverity.CRITICAL] ?: 0}"
            )
            appendLine(sourcesBlock)
            append(topFindingsBlock)
        }.trim()
    }

    private fun severityRank(severity: ThreatSeverity): Int = when (severity) {
        ThreatSeverity.CRITICAL -> 4
        ThreatSeverity.HIGH -> 3
        ThreatSeverity.MEDIUM -> 2
        ThreatSeverity.LOW -> 1
    }
}
