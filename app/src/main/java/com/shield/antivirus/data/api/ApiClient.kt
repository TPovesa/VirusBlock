package com.shield.antivirus.data.api

import com.shield.antivirus.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.CertificatePinner
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.Response
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    private const val VT_BASE_URL = "https://www.virustotal.com/api/v3/"

    data class ShieldEndpoint(
        val label: String,
        val baseUrl: String,
        val usePinnedTls: Boolean
    )

    private val shieldEndpoints = listOf(
        ShieldEndpoint(
            label = "Primary domain",
            baseUrl = "https://sosiskibot.ru/",
            usePinnedTls = true
        ),
        ShieldEndpoint(
            label = "Direct VPS fallback",
            baseUrl = "http://91.233.168.135:3001/",
            usePinnedTls = false
        )
    )

    private val certificatePinner = CertificatePinner.Builder()
        .add("sosiskibot.ru", "sha256/IzT37viwhm92tzAiJv1ZBp+Pwu59GRrghDARNVFwvmM=")
        .add("www.sosiskibot.ru", "sha256/IzT37viwhm92tzAiJv1ZBp+Pwu59GRrghDARNVFwvmM=")
        .build()

    private fun newHttpClient(usePinnedTls: Boolean): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = if (BuildConfig.DEBUG) {
                    HttpLoggingInterceptor.Level.BASIC
                } else {
                    HttpLoggingInterceptor.Level.NONE
                }
            })

        if (usePinnedTls) {
            builder.certificatePinner(certificatePinner)
        }

        return builder.build()
    }

    private fun createShieldApi(endpoint: ShieldEndpoint): ShieldApi =
        Retrofit.Builder()
            .baseUrl(endpoint.baseUrl)
            .client(newHttpClient(endpoint.usePinnedTls))
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ShieldApi::class.java)

    val virusTotalApi: VirusTotalApi = Retrofit.Builder()
        .baseUrl(VT_BASE_URL)
        .client(newHttpClient(usePinnedTls = true))
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(VirusTotalApi::class.java)

    val shieldApi: ShieldApi by lazy { createShieldApi(shieldEndpoints.first()) }

    private val shieldApis: List<ShieldApi> by lazy {
        shieldEndpoints.map(::createShieldApi)
    }

    suspend fun <T> executeShieldCall(
        shouldFailover: (Response<T>) -> Boolean = { response ->
            response.code() == 404 || response.code() >= 500
        },
        block: suspend (ShieldApi) -> Response<T>
    ): Response<T> {
        var lastResponse: Response<T>? = null
        var lastError: Exception? = null

        shieldApis.forEachIndexed { index, api ->
            try {
                val response = block(api)
                val hasMoreEndpoints = index < shieldApis.lastIndex
                if (response.isSuccessful || !shouldFailover(response) || !hasMoreEndpoints) {
                    return response
                }
                lastResponse = response
            } catch (error: Exception) {
                if (index == shieldApis.lastIndex) {
                    throw error
                }
                lastError = error
            }
        }

        lastResponse?.let { return it }
        throw lastError ?: IllegalStateException("Shield backend is unavailable on every configured endpoint.")
    }
}
