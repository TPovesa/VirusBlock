package com.shield.antivirus.data.api

import com.shield.antivirus.data.model.*
import retrofit2.Response
import retrofit2.http.*

interface ShieldApi {

    // --- Auth ---
    @POST("api/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<AuthResponse>

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<AuthResponse>

    @POST("api/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): Response<AuthResponse>

    @POST("api/auth/logout")
    suspend fun logout(
        @Header("Authorization") token: String,
        @Body request: LogoutRequest
    ): Response<Map<String, Boolean>>

    @GET("api/auth/me")
    suspend fun getMe(@Header("Authorization") token: String): Response<AuthResponse>

    // --- Scans ---
    @POST("api/scans")
    suspend fun saveScan(
        @Header("Authorization") token: String,
        @Body request: SaveScanRequest
    ): Response<SaveScanResponse>

    @GET("api/scans")
    suspend fun getScans(
        @Header("Authorization") token: String,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): Response<ScansListResponse>

    @DELETE("api/scans")
    suspend fun clearScans(@Header("Authorization") token: String): Response<Map<String, Boolean>>

    // --- Purchases ---
    @POST("api/purchases")
    suspend fun savePurchase(
        @Header("Authorization") token: String,
        @Body request: SavePurchaseRequest
    ): Response<SaveScanResponse>

    @GET("api/purchases/active")
    suspend fun getActivePurchases(@Header("Authorization") token: String): Response<PurchasesResponse>
}
