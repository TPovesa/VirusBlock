package com.shield.antivirus.data.model

import com.google.gson.annotations.SerializedName

// ---- Auth ----
data class RegisterRequest(
    val name: String,
    val email: String,
    val password: String,
    @SerializedName("device_id") val deviceId: String
)

data class VerifyCodeRequest(
    @SerializedName("challenge_id") val challengeId: String,
    val code: String,
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

data class ChallengeResponse(
    val success: Boolean,
    @SerializedName("challenge_id") val challengeId: String?,
    @SerializedName("expires_at") val expiresAt: Long?,
    val email: String?,
    val message: String?,
    val error: String?
)

data class PasswordResetRequest(
    val email: String
)

data class PasswordResetConfirmRequest(
    val token: String,
    val email: String,
    val password: String
)

data class BasicResponse(
    val success: Boolean,
    val message: String?,
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

data class ExplainScanRequest(
    val summary: ExplainSummaryPayload,
    val result: ExplainResultPayload
)

data class ExplainSummaryPayload(
    val verdict: String,
    @SerializedName("risk_score") val riskScore: Int,
    val mode: String,
    @SerializedName("is_guest") val isGuest: Boolean,
    @SerializedName("protection_active") val protectionActive: Boolean,
    @SerializedName("total_scans") val totalScans: Int,
    @SerializedName("total_threats") val totalThreats: Int,
    @SerializedName("last_scan_time") val lastScanTime: Long
)

data class ExplainResultPayload(
    val findings: List<ThreatInfo> = emptyList(),
    @SerializedName("scan_type") val scanType: String? = null,
    @SerializedName("total_scanned") val totalScanned: Int? = null,
    @SerializedName("threats_found") val threatsFound: Int? = null,
    @SerializedName("latest_completed_at") val latestCompletedAt: Long? = null,
    val notes: String? = null
)

data class ExplainScanResponse(
    val success: Boolean,
    val explanation: String?,
    val title: String? = null,
    val error: String? = null
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

data class DeepScanStartRequest(
    @SerializedName("app_name") val appName: String,
    @SerializedName("package_name") val packageName: String,
    val sha256: String?,
    @SerializedName("installer_package") val installerPackage: String?,
    val permissions: List<String>,
    @SerializedName("target_sdk") val targetSdk: Int? = null,
    @SerializedName("min_sdk") val minSdk: Int? = null,
    @SerializedName("version_code") val versionCode: Long? = null,
    @SerializedName("version_name") val versionName: String? = null,
    @SerializedName("first_install_time") val firstInstallTime: Long? = null,
    @SerializedName("last_update_time") val lastUpdateTime: Long? = null,
    @SerializedName("size_bytes") val sizeBytes: Long? = null,
    @SerializedName("signature_sha256") val signatureSha256: String? = null,
    @SerializedName("certificate_subject") val certificateSubject: String? = null,
    @SerializedName("is_debuggable") val isDebuggable: Boolean = false,
    @SerializedName("uses_cleartext_traffic") val usesCleartextTraffic: Boolean = false
)

data class DeepScanFinding(
    val type: String,
    val severity: String,
    val title: String,
    val detail: String
)

data class DeepScanSummary(
    val verdict: String?,
    @SerializedName("risk_score") val riskScore: Int? = null,
    val recommendations: List<String>? = emptyList()
)

data class DeepScanJob(
    val id: String,
    val status: String,
    @SerializedName("package_name") val packageName: String? = null,
    @SerializedName("app_name") val appName: String? = null,
    val verdict: String? = null,
    @SerializedName("risk_score") val riskScore: Int? = null,
    val summary: DeepScanSummary? = null,
    val findings: List<DeepScanFinding>? = emptyList(),
    val error: String? = null
)

data class DeepScanStartResponse(
    val success: Boolean,
    val scan: DeepScanJob?,
    val error: String? = null
)

data class DeepScanPollResponse(
    val success: Boolean,
    val scan: DeepScanJob?,
    val error: String? = null
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
