package com.shield.antivirus.data.api

import com.shield.antivirus.data.model.*
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

interface ShieldApi {

    // --- Auth ---
    @POST("api/auth/register/start")
    suspend fun startRegister(@Body request: RegisterRequest): Response<ChallengeResponse>

    @POST("api/auth/register")
    suspend fun registerDirect(@Body request: RegisterRequest): Response<AuthResponse>

    @POST("api/auth/register/verify")
    suspend fun verifyRegister(@Body request: VerifyCodeRequest): Response<AuthResponse>

    @POST("api/auth/register/resend")
    suspend fun resendRegisterCode(@Body request: ResendChallengeRequest): Response<ChallengeResponse>

    @POST("api/auth/login/start")
    suspend fun startLogin(@Body request: LoginRequest): Response<ChallengeResponse>

    @POST("api/auth/login")
    suspend fun loginDirect(@Body request: LoginRequest): Response<AuthResponse>

    @POST("api/auth/login/verify")
    suspend fun verifyLogin(@Body request: VerifyCodeRequest): Response<AuthResponse>

    @POST("api/auth/login/resend")
    suspend fun resendLoginCode(@Body request: ResendChallengeRequest): Response<ChallengeResponse>

    @POST("api/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): Response<AuthResponse>

    @POST("api/auth/logout")
    suspend fun logout(
        @Header("Authorization") token: String,
        @Body request: LogoutRequest
    ): Response<Map<String, Boolean>>

    @GET("api/auth/me")
    suspend fun getMe(@Header("Authorization") token: String): Response<AuthResponse>

    @POST("api/auth/password-reset/request")
    suspend fun requestPasswordReset(@Body request: PasswordResetRequest): Response<BasicResponse>

    @POST("api/auth/password-reset/confirm")
    suspend fun confirmPasswordReset(@Body request: PasswordResetConfirmRequest): Response<BasicResponse>

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

    @POST("api/scans/deep/start")
    suspend fun startDeepScan(
        @Header("Authorization") token: String,
        @Body request: DeepScanStartRequest
    ): Response<DeepScanStartResponse>

    @GET("api/scans/deep/{id}")
    suspend fun getDeepScan(
        @Header("Authorization") token: String,
        @Path("id") id: String
    ): Response<DeepScanPollResponse>

    @Headers("Content-Type: application/vnd.android.package-archive")
    @POST("api/scans/deep/{id}/apk")
    suspend fun uploadDeepScanApk(
        @Header("Authorization") token: String,
        @Path("id") id: String,
        @Header("X-File-Name") fileName: String,
        @Body apkBody: RequestBody
    ): Response<DeepScanPollResponse>

    // --- AI ---
    @POST("api/ai/explain-scan")
    suspend fun explainScan(
        @Header("Authorization") token: String? = null,
        @Body request: ExplainScanRequest
    ): Response<ExplainScanResponse>

    @POST("api/logs/client")
    suspend fun uploadClientLogs(
        @Header("Authorization") token: String,
        @Body request: ClientLogsUploadRequest
    ): Response<BasicResponse>

    // --- Purchases ---
    @POST("api/purchases")
    suspend fun savePurchase(
        @Header("Authorization") token: String,
        @Body request: SavePurchaseRequest
    ): Response<SaveScanResponse>

    @GET("api/purchases/active")
    suspend fun getActivePurchases(@Header("Authorization") token: String): Response<PurchasesResponse>
}
