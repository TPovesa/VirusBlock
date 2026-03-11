package com.shield.antivirus.data.repository

import android.content.Context
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.model.ExplainResultPayload
import com.shield.antivirus.data.model.ExplainScanRequest
import com.shield.antivirus.data.model.ExplainSummaryPayload
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.security.ShieldSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class InsightRepository(context: Context) {
    private val sessionManager = ShieldSessionManager(context.applicationContext)

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
                            notes = notes
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
}
