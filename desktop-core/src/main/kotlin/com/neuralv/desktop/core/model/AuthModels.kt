package com.neuralv.desktop.core.model

data class SessionUser(
    val id: String = "",
    val name: String = "",
    val email: String = "",
    val isPremium: Boolean = false,
    val isDeveloperMode: Boolean = false
)

data class SessionState(
    val accessToken: String = "",
    val refreshToken: String = "",
    val sessionId: String = "",
    val accessTokenExpiresAt: Long = 0L,
    val refreshTokenExpiresAt: Long = 0L,
    val user: SessionUser = SessionUser(),
    val deviceId: String = "",
    val backendBaseUrl: String = ""
)

data class ChallengeTicket(
    val challengeId: String = "",
    val expiresAt: Long = 0L,
    val email: String = "",
    val mode: AuthChallengeMode = AuthChallengeMode.LOGIN
)

enum class AuthChallengeMode {
    REGISTER,
    LOGIN
}

data class AuthResponse(
    val success: Boolean = false,
    val token: String = "",
    val refreshToken: String = "",
    val sessionId: String = "",
    val accessTokenExpiresAt: Long = 0L,
    val refreshTokenExpiresAt: Long = 0L,
    val user: SessionUser = SessionUser()
)
