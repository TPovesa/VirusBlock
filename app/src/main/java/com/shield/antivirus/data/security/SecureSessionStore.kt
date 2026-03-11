package com.shield.antivirus.data.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val sessionId: String,
    val accessTokenExpiresAt: Long,
    val refreshTokenExpiresAt: Long
) {
    fun isAccessTokenFresh(now: Long = System.currentTimeMillis(), skewMs: Long = 60_000L): Boolean {
        return accessToken.isNotBlank() && accessTokenExpiresAt > now + skewMs
    }

    fun isRefreshTokenAlive(now: Long = System.currentTimeMillis()): Boolean {
        return refreshToken.isNotBlank() && refreshTokenExpiresAt > now
    }
}

class SecureSessionStore(context: Context) {
    private val preferences: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREF_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun getSession(): StoredSession? {
        val accessToken = preferences.getString(KEY_ACCESS_TOKEN, "").orEmpty()
        val refreshToken = preferences.getString(KEY_REFRESH_TOKEN, "").orEmpty()
        val sessionId = preferences.getString(KEY_SESSION_ID, "").orEmpty()
        if (accessToken.isBlank() || refreshToken.isBlank() || sessionId.isBlank()) return null

        return StoredSession(
            accessToken = accessToken,
            refreshToken = refreshToken,
            sessionId = sessionId,
            accessTokenExpiresAt = preferences.getLong(KEY_ACCESS_TOKEN_EXPIRES_AT, 0L),
            refreshTokenExpiresAt = preferences.getLong(KEY_REFRESH_TOKEN_EXPIRES_AT, 0L)
        )
    }

    fun saveSession(session: StoredSession) {
        preferences.edit()
            .putString(KEY_ACCESS_TOKEN, session.accessToken)
            .putString(KEY_REFRESH_TOKEN, session.refreshToken)
            .putString(KEY_SESSION_ID, session.sessionId)
            .putLong(KEY_ACCESS_TOKEN_EXPIRES_AT, session.accessTokenExpiresAt)
            .putLong(KEY_REFRESH_TOKEN_EXPIRES_AT, session.refreshTokenExpiresAt)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    companion object {
        private const val PREF_NAME = "shield_secure_session"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_SESSION_ID = "session_id"
        private const val KEY_ACCESS_TOKEN_EXPIRES_AT = "access_token_expires_at"
        private const val KEY_REFRESH_TOKEN_EXPIRES_AT = "refresh_token_expires_at"
    }
}
