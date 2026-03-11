package com.shield.antivirus.data.model

import com.google.gson.annotations.SerializedName

// ---- Auth ----
data class RegisterRequest(
    val name: String,
    val email: String,
    val password: String,
    @SerializedName("device_id") val deviceId: String
)

data class LoginRequest(
    val email: String,
    val password: String,
    @SerializedName("device_id") val deviceId: String
)

data class RefreshRequest(
    @SerializedName("refresh_token") val refreshToken: String,
    @SerializedName("session_id") val sessionId: String,
    @SerializedName("device_id") val deviceId: String
)

data class LogoutRequest(
    @SerializedName("refresh_token") val refreshToken: String?
)

data class AuthResponse(
    val success: Boolean,
    val token: String?,
    @SerializedName("refresh_token") val refreshToken: String?,
    @SerializedName("session_id") val sessionId: String?,
    @SerializedName("access_token_expires_at") val accessTokenExpiresAt: Long?,
    @SerializedName("refresh_token_expires_at") val refreshTokenExpiresAt: Long?,
    val user: RemoteUser?,
    val error: String?
)

data class RemoteUser(
    val id: String,
    val name: String,
    val email: String,
    @SerializedName("is_premium") val isPremium: Boolean = false,
    @SerializedName("premium_expires_at") val premiumExpiresAt: Long? = null
)

// ---- Scans ----
data class SaveScanRequest(
    @SerializedName("scan_type")     val scanType: String,
    @SerializedName("started_at")    val startedAt: Long,
    @SerializedName("completed_at")  val completedAt: Long,
    @SerializedName("total_scanned") val totalScanned: Int,
    @SerializedName("threats_found") val threatsFound: Int,
    @SerializedName("threats_json")  val threatsJson: List<ThreatInfo>,
    val status: String = "COMPLETED"
)

data class SaveScanResponse(
    val success: Boolean,
    val id: Long?,
    val error: String?
)

data class ScansListResponse(
    val success: Boolean,
    val scans: List<RemoteScan>?
)

data class RemoteScan(
    val id: Long,
    @SerializedName("scan_type")     val scanType: String,
    @SerializedName("started_at")    val startedAt: Long,
    @SerializedName("completed_at")  val completedAt: Long,
    @SerializedName("total_scanned") val totalScanned: Int,
    @SerializedName("threats_found") val threatsFound: Int,
    val status: String
)

// ---- Purchases ----
data class SavePurchaseRequest(
    @SerializedName("product_id")      val productId: String,
    @SerializedName("purchase_token")  val purchaseToken: String?,
    val amount: Double = 0.0,
    val currency: String = "USD",
    @SerializedName("expires_at")      val expiresAt: Long? = null
)

data class PurchasesResponse(
    val success: Boolean,
    @SerializedName("has_premium") val hasPremium: Boolean?,
    val purchases: List<Any>?
)

// ---- Generic ----
data class ApiError(val error: String)
