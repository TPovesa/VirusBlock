package com.shield.antivirus.data.security

import android.content.Context
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.AuthResponse
import com.shield.antivirus.data.model.LogoutRequest
import com.shield.antivirus.data.model.RefreshRequest

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
                refreshTokenExpiresAt = refreshTokenExpiresAt
            )
        )
        prefs.saveUser(user.name, user.email, user.id)
        prefs.setAuthToken(accessToken)
        return true
    }

    suspend fun getValidAccessToken(): String? {
        val session = secureStore.getSession() ?: return null
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
                clearLocalSession()
                return null
            }

            val body = response.body() ?: return null
            if (!body.success || !persistAuth(body)) {
                clearLocalSession()
                return null
            }

            body.token
        } catch (_: Exception) {
            null
        }
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
