package com.shield.antivirus.data.repository

import android.content.Context
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.model.ExplainResultPayload
import com.shield.antivirus.data.model.ExplainScanRequest
import com.shield.antivirus.data.model.ExplainSummaryPayload
import com.shield.antivirus.data.model.ExplainStructuredSection
import com.shield.antivirus.data.model.ExplainStructuredV1Payload
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.data.security.ShieldSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class InsightRepository(context: Context) {
    private val sessionManager = ShieldSessionManager(context.applicationContext)

    suspend fun explainResult(
        result: ScanResult,
        isGuest: Boolean
    ): Result<String> = withContext(Dispatchers.IO) {
        val token = sessionManager.getValidAccessToken()
        if (isGuest || token.isNullOrBlank()) {
            return@withContext Result.failure(IllegalStateException("Функция доступна только после входа в аккаунт"))
        }
        runCatching {
            val request = ExplainScanRequest(
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
            val response = requestExplainWithRetry(token = token, request = request)
            if (!response.isSuccessful) {
                throw mapExplainHttpException(response.code())
            }
            val explanation = resolveServerExplanation(response.body())
            if (!explanation.isNullOrBlank()) {
                explanation
            } else {
                throw IllegalStateException("Сервер ИИ не вернул объяснение")
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
        val latest = recentResults.firstOrNull()
        val token = sessionManager.getValidAccessToken()
        if (isGuest || token.isNullOrBlank()) {
            return@withContext Result.failure(IllegalStateException("Функция доступна только после входа в аккаунт"))
        }
        runCatching {
            val request = ExplainScanRequest(
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
            val response = requestExplainWithRetry(token = token, request = request)
            if (!response.isSuccessful) {
                throw mapExplainHttpException(response.code())
            }
            val explanation = resolveServerExplanation(response.body())
            if (!explanation.isNullOrBlank()) {
                explanation
            } else {
                throw IllegalStateException("Сервер ИИ не вернул объяснение")
            }
        }
    }

    private suspend fun requestExplainWithRetry(
        token: String,
        request: ExplainScanRequest
    ): retrofit2.Response<com.shield.antivirus.data.model.ExplainScanResponse> {
        val maxAttempts = 3
        for (attempt in 1..maxAttempts) {
            try {
                val response = ApiClient.executeShieldCall { api ->
                    api.explainScan(
                        token = "Bearer $token",
                        request = request
                    )
                }
                if (!shouldRetryExplain(response.code()) || attempt == maxAttempts) {
                    return response
                }
                delay(explainRetryDelayMs(attempt))
            } catch (error: Exception) {
                if (attempt == maxAttempts) throw error
                delay(explainRetryDelayMs(attempt))
            }
        }
        throw IllegalStateException("Не удалось получить ответ ИИ")
    }

    private fun shouldRetryExplain(statusCode: Int): Boolean {
        return statusCode == 429 || statusCode == 408 || statusCode == 425 || statusCode in 500..504
    }

    private fun explainRetryDelayMs(attempt: Int): Long = when (attempt) {
        1 -> 700L
        2 -> 1500L
        else -> 2600L
    }

    private fun mapExplainHttpException(statusCode: Int): IllegalStateException = when (statusCode) {
        429 -> IllegalStateException("ИИ временно перегружен. Подождите 1-2 минуты и попробуйте снова.")
        401, 403 -> IllegalStateException("Сессия истекла. Войдите в аккаунт заново.")
        502, 503, 504 -> IllegalStateException("Сервер ИИ временно недоступен. Попробуйте позже.")
        else -> IllegalStateException("Сервер ИИ вернул ошибку ($statusCode)")
    }

    private fun resolveServerExplanation(body: com.shield.antivirus.data.model.ExplainScanResponse?): String? {
        if (body == null) return null
        val structured = buildStructuredMarkdown(body.structuredV1)
        if (!structured.isNullOrBlank()) return structured
        return body.explanation?.trim()?.takeIf { it.isNotBlank() }
    }

    private fun buildStructuredMarkdown(structured: ExplainStructuredV1Payload?): String? {
        if (structured == null) return null

        val sections = structured.sections
            .orEmpty()
            .mapIndexedNotNull { index, section ->
                val title = resolveStructuredSectionTitle(section, index)
                val lines = collectSectionLines(section)
                if (title.isBlank() || lines.isEmpty()) null else title to lines
            }
            .toMutableList()

        if (sections.isEmpty()) {
            val summaryLines = buildList {
                structured.summary?.trim()?.takeIf { it.isNotBlank() }?.let { add(it) }
                if (isEmpty()) {
                    structured.verdict?.trim()?.takeIf { it.isNotBlank() }?.let {
                        add("Оценка: $it")
                    }
                }
            }
            val evidenceLines = normalizeStructuredItems(
                structured.confirmedByData,
                structured.confirmed,
                structured.evidence
            )
            val actionLines = normalizeStructuredItems(
                structured.actionsNow,
                structured.whatToDoNow,
                structured.actions,
                structured.recommendations
            )
            val checksLines = normalizeStructuredItems(
                structured.whatElseCheck,
                structured.whatElseToCheck,
                structured.checks,
                structured.extraChecks
            )

            if (summaryLines.isNotEmpty()) sections += "Итог" to summaryLines
            if (evidenceLines.isNotEmpty()) sections += "Подтверждено данными" to evidenceLines
            if (actionLines.isNotEmpty()) sections += "Что делать сейчас" to actionLines
            if (checksLines.isNotEmpty()) sections += "Что ещё проверить" to checksLines
        }

        if (sections.isEmpty()) return null

        return sections.joinToString(separator = "\n\n") { (title, lines) ->
            val preferBullets = title != "Итог"
            val body = lines
                .mapNotNull { line -> formatStructuredLine(line, preferBullets) }
                .joinToString(separator = "\n")
            "## $title\n$body"
        }.trim()
    }

    private fun resolveStructuredSectionTitle(section: ExplainStructuredSection, index: Int): String {
        val explicit = section.title?.trim().orEmpty()
        if (explicit.isNotBlank()) return explicit
        val byKey = when (section.key?.trim()?.lowercase()) {
            "summary", "result", "conclusion", "final" -> "Итог"
            "evidence", "confirmed", "facts" -> "Подтверждено данными"
            "actions", "todo", "next_steps", "mitigation" -> "Что делать сейчас"
            "checks", "follow_up", "additional_checks" -> "Что ещё проверить"
            else -> ""
        }
        return byKey.ifBlank { "Разбор ${index + 1}" }
    }

    private fun collectSectionLines(section: ExplainStructuredSection): List<String> {
        return normalizeStructuredItems(
            listOfNotNull(section.summary, section.text),
            section.lines,
            section.bullets,
            section.items
        )
    }

    private fun normalizeStructuredItems(vararg groups: List<String>?): List<String> {
        return groups.asSequence()
            .filterNotNull()
            .flatMap { it.asSequence() }
            .flatMap { item ->
                item.replace("\r\n", "\n")
                    .replace('\r', '\n')
                    .split('\n')
                    .asSequence()
            }
            .map { it.trim() }
            .map { it.removePrefix("-").removePrefix("*").trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .toList()
    }

    private fun formatStructuredLine(line: String, preferBullets: Boolean): String? {
        val value = line.trim()
        if (value.isBlank()) return null
        if (value.startsWith("- ") || value.startsWith("* ")) return value
        return if (preferBullets) "- $value" else value
    }

    private fun buildClientFallback(result: ScanResult): String {
        val top = result.threats.firstOrNull()
        if (top == null) {
            return """
                ## Итог
                Явных угроз не найдено.
                
                ## Подтверждено данными
                - Проверено пакетов: ${result.totalScanned}
                - Найдено угроз: 0
                
                ## Что делать сейчас
                - Обновите приложения и систему.
                - Отключите установку из неизвестных источников.
                
                ## Что ещё проверить
                - Повторите глубокую проверку при подозрительном поведении устройства.
            """.trimIndent()
        }

        return """
            ## Итог
            Найден риск в приложении **${top.appName}**.
            
            ## Подтверждено данными
            - Тип угрозы: ${top.threatName}
            - Уровень: ${top.severity}
            - Детект: ${top.detectionCount}/${top.totalEngines}
            
            ## Что делать сейчас
            - Проверьте источник установки приложения.
            - Ограничьте лишние разрешения.
            - Запустите повторную глубокую проверку.
            
            ## Что ещё проверить
            - Автозапуск и работу в фоне.
            - Наличие обновлений приложения.
        """.trimIndent()
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
