package com.shield.antivirus.data.security

import android.content.Context
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.AuthResponse
import com.shield.antivirus.data.model.LogoutRequest
import com.shield.antivirus.data.model.RefreshRequest
import kotlinx.coroutines.flow.first
import retrofit2.Response

class ShieldSessionManager(context: Context) {
    private val prefs = UserPreferences(context.applicationContext)
    private val secureStore = SecureSessionStore(context.applicationContext)

    suspend fun persistAuth(response: AuthResponse): Boolean {
        val user = response.user ?: return false
        val accessToken = response.token ?: return false
        val refreshToken = response.refreshToken ?: return false
        val sessionId = response.sessionId ?: return false
        val accessTokenExpiresAt = response.accessTokenExpiresAt ?: return false
        val refreshTokenExpiresAt = response.refreshTokenExpiresAt ?: return false

        secureStore.saveSession(
            StoredSession(
                accessToken = accessToken,
                refreshToken = refreshToken,
                sessionId = sessionId,
                accessTokenExpiresAt = accessTokenExpiresAt,
                refreshTokenExpiresAt = refreshTokenExpiresAt,
                userId = user.id,
                userName = user.name,
                userEmail = user.email
            )
        )
        prefs.saveUser(user.name, user.email, user.id)
        prefs.setAuthToken(accessToken)
        return true
    }

    suspend fun getValidAccessToken(): String? {
        val session = secureStore.getSession() ?: return null
        hydrateSessionState(session)
        if (session.isAccessTokenFresh()) return session.accessToken
        if (!session.isRefreshTokenAlive()) {
            clearLocalSession()
            return null
        }

        return try {
            val response = ApiClient.executeShieldCall { api ->
                api.refresh(
                    RefreshRequest(
                        refreshToken = session.refreshToken,
                        sessionId = session.sessionId,
                        deviceId = prefs.getOrCreateDeviceId()
                    )
                )
            }
            if (!response.isSuccessful) {
                if (isTerminalRefreshFailure(response = response, error = null)) {
                    clearLocalSession()
                    return null
                }
                return session.accessToken.takeIf { it.isNotBlank() }
            }

            val body = response.body() ?: return session.accessToken.takeIf { it.isNotBlank() }
            if (!body.success || !persistAuth(body)) {
                if (isTerminalRefreshFailure(response = response, error = body.error)) {
                    clearLocalSession()
                    return null
                }
                return session.accessToken.takeIf { it.isNotBlank() }
            }

            body.token
        } catch (_: Exception) {
            session.accessToken.takeIf { it.isNotBlank() }
        }
    }

    suspend fun hasStoredSession(): Boolean = secureStore.getSession() != null

    private suspend fun hydrateSessionState(session: StoredSession) {
        prefs.setLoggedIn(true)
        prefs.setAuthToken(session.accessToken)

        val currentUserId = prefs.userId.first()
        if (currentUserId.isNotBlank()) {
            return
        }

        val userId = session.userId?.takeIf { it.isNotBlank() } ?: return
        val userName = session.userName?.takeIf { it.isNotBlank() } ?: return
        val userEmail = session.userEmail?.takeIf { it.isNotBlank() } ?: return
        prefs.saveUser(userName, userEmail, userId)
        prefs.setAuthToken(session.accessToken)
    }

    private fun isTerminalRefreshFailure(
        response: Response<AuthResponse>,
        error: String?
    ): Boolean {
        if (response.code() == 401 || response.code() == 403) {
            return true
        }
        val message = error.orEmpty().lowercase()
        return message.contains("refresh token invalid") ||
            message.contains("refresh token expired") ||
            message.contains("session revoked") ||
            message.contains("session not found") ||
            message.contains("device mismatch")
    }

    suspend fun logoutRemoteIfPossible() {
        val session = secureStore.getSession() ?: return
        val accessToken = getValidAccessToken() ?: return
        try {
            ApiClient.executeShieldCall { api ->
                api.logout("Bearer $accessToken", LogoutRequest(session.refreshToken))
            }
        } catch (_: Exception) {
        }
    }

    suspend fun clearLocalSession() {
        secureStore.clear()
        prefs.logout()
    }
}
