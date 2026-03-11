package com.shield.antivirus.data.api

import com.shield.antivirus.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.CertificatePinner
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    private const val VT_BASE_URL     = "https://www.virustotal.com/api/v3/"
    const val SHIELD_BASE_URL = "https://sosiskibot.ru/"

    private val certificatePinner = CertificatePinner.Builder()
        .add("sosiskibot.ru", "sha256/IzT37viwhm92tzAiJv1ZBp+Pwu59GRrghDARNVFwvmM=")
        .add("www.sosiskibot.ru", "sha256/IzT37viwhm92tzAiJv1ZBp+Pwu59GRrghDARNVFwvmM=")
        .build()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .certificatePinner(certificatePinner)
        .addInterceptor(HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        })
        .build()

    val virusTotalApi: VirusTotalApi = Retrofit.Builder()
        .baseUrl(VT_BASE_URL)
        .client(httpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(VirusTotalApi::class.java)

    val shieldApi: ShieldApi = Retrofit.Builder()
        .baseUrl(SHIELD_BASE_URL)
        .client(httpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(ShieldApi::class.java)
}
