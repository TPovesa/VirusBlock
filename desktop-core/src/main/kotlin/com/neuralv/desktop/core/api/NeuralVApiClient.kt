package com.neuralv.desktop.core.api

import com.google.gson.FieldNamingPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.neuralv.desktop.core.model.ChallengeResponse
import com.neuralv.desktop.core.model.DesktopFullReportEnvelope
import com.neuralv.desktop.core.model.DesktopScanEnvelope
import com.neuralv.desktop.core.model.DesktopScanTransport
import com.neuralv.desktop.core.model.ReleaseManifestEnvelope
import com.neuralv.desktop.core.model.SessionEnvelope
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class NeuralVApiClient(
    private val baseUrl: String
) {
    private val gson: Gson = GsonBuilder()
        .setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES)
        .create()

    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun postChallenge(path: String, payload: Any): ChallengeResponse = executeJson(
        path = path,
        method = "POST",
        payload = payload,
        parser = { gson.fromJson(it, ChallengeResponse::class.java) }
    )

    fun postSession(path: String, payload: Any, accessToken: String? = null): SessionEnvelope = executeJson(
        path = path,
        method = "POST",
        payload = payload,
        accessToken = accessToken,
        parser = { gson.fromJson(it, SessionEnvelope::class.java) }
    )

    fun getSession(path: String, accessToken: String): SessionEnvelope = executeJson(
        path = path,
        method = "GET",
        accessToken = accessToken,
        parser = { gson.fromJson(it, SessionEnvelope::class.java) }
    )

    fun startDesktopScan(payload: Any, accessToken: String): DesktopScanEnvelope = executeJson(
        path = "/api/scans/desktop/start",
        method = "POST",
        payload = payload,
        accessToken = accessToken,
        parser = { gson.fromJson(it, DesktopScanEnvelope::class.java) }
    )

    fun getDesktopScan(id: String, accessToken: String): DesktopScanEnvelope = executeJson(
        path = "/api/scans/desktop/$id",
        method = "GET",
        accessToken = accessToken,
        parser = { gson.fromJson(it, DesktopScanEnvelope::class.java) }
    )

    fun cancelDesktopScan(accessToken: String): DesktopScanEnvelope = executeJson(
        path = "/api/scans/desktop/cancel-active",
        method = "POST",
        accessToken = accessToken,
        parser = { gson.fromJson(it, DesktopScanEnvelope::class.java) }
    )

    fun getDesktopFullReport(scanIds: List<String>, accessToken: String): DesktopFullReportEnvelope = executeJson(
        path = "/api/scans/desktop/full-report",
        method = "POST",
        payload = mapOf("scan_ids" to scanIds),
        accessToken = accessToken,
        parser = { gson.fromJson(it, DesktopFullReportEnvelope::class.java) }
    )

    fun uploadArtifact(scanId: String, file: File, accessToken: String): DesktopScanEnvelope {
        val request = Request.Builder()
            .url(resolve("/api/scans/desktop/$scanId/artifact"))
            .header("Authorization", "Bearer $accessToken")
            .header("X-File-Name", file.name)
            .post(file.asRequestBody("application/octet-stream".toMediaType()))
            .build()

        return execute(request) { json -> gson.fromJson(json, DesktopScanEnvelope::class.java) }
    }

    fun getReleaseManifest(): ReleaseManifestEnvelope = executeJson(
        path = "/api/releases/manifest",
        method = "GET",
        parser = { gson.fromJson(it, ReleaseManifestEnvelope::class.java) }
    )

    fun getJson(path: String, accessToken: String? = null): JsonObject = executeJson(
        path = path,
        method = "GET",
        accessToken = accessToken,
        parser = { gson.fromJson(it, JsonObject::class.java) }
    )

    private fun <T> executeJson(
        path: String,
        method: String,
        payload: Any? = null,
        accessToken: String? = null,
        parser: (String) -> T
    ): T {
        val requestBuilder = Request.Builder().url(resolve(path))
        if (!accessToken.isNullOrBlank()) {
            requestBuilder.header("Authorization", "Bearer $accessToken")
        }
        val request = when (method) {
            "GET" -> requestBuilder.get().build()
            else -> requestBuilder
                .post(gson.toJson(payload ?: emptyMap<String, Any>()).toRequestBody(jsonMediaType))
                .build()
        }
        return execute(request, parser)
    }

    private fun <T> execute(request: Request, parser: (String) -> T): T {
        httpClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val apiMessage = runCatching {
                    gson.fromJson(body, JsonObject::class.java)
                        ?.get("error")
                        ?.asString
                }.getOrNull()
                throw NeuralVApiException(response.code, apiMessage ?: "HTTP ${response.code}")
            }
            return parser(body)
        }
    }

    private fun resolve(path: String): String = baseUrl.trimEnd('/') + path
}
