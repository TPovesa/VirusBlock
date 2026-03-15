package com.shield.antivirus.data.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.io.File

data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val sessionId: String,
    val accessTokenExpiresAt: Long,
    val refreshTokenExpiresAt: Long,
    val userId: String? = null,
    val userName: String? = null,
    val userEmail: String? = null
) {
    fun isAccessTokenFresh(now: Long = System.currentTimeMillis(), skewMs: Long = 60_000L): Boolean {
        return accessToken.isNotBlank() && accessTokenExpiresAt > now + skewMs
    }

    fun isRefreshTokenAlive(now: Long = System.currentTimeMillis()): Boolean {
        return refreshToken.isNotBlank() && refreshTokenExpiresAt > now
    }
}

class SecureSessionStore(context: Context) {
    private val appContext = context.applicationContext
    private val preferences: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            appContext,
            PREF_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }
    private val sessionFile: File by lazy {
        File(appContext.filesDir, "session/shield_session.json")
    }

    fun getSession(): StoredSession? {
        val accessToken = preferences.getString(KEY_ACCESS_TOKEN, "").orEmpty()
        val refreshToken = preferences.getString(KEY_REFRESH_TOKEN, "").orEmpty()
        val sessionId = preferences.getString(KEY_SESSION_ID, "").orEmpty()
        if (accessToken.isNotBlank() && refreshToken.isNotBlank() && sessionId.isNotBlank()) {
            return StoredSession(
                accessToken = accessToken,
                refreshToken = refreshToken,
                sessionId = sessionId,
                accessTokenExpiresAt = preferences.getLong(KEY_ACCESS_TOKEN_EXPIRES_AT, 0L),
                refreshTokenExpiresAt = preferences.getLong(KEY_REFRESH_TOKEN_EXPIRES_AT, 0L)
            )
        }

        val fileSession = readSessionFile() ?: return null
        saveSession(fileSession)
        return fileSession
    }

    fun saveSession(session: StoredSession) {
        preferences.edit()
            .putString(KEY_ACCESS_TOKEN, session.accessToken)
            .putString(KEY_REFRESH_TOKEN, session.refreshToken)
            .putString(KEY_SESSION_ID, session.sessionId)
            .putLong(KEY_ACCESS_TOKEN_EXPIRES_AT, session.accessTokenExpiresAt)
            .putLong(KEY_REFRESH_TOKEN_EXPIRES_AT, session.refreshTokenExpiresAt)
            .apply()
        writeSessionFile(session)
    }

    fun clear() {
        preferences.edit().clear().apply()
        runCatching { sessionFile.delete() }
    }

    private fun readSessionFile(): StoredSession? = runCatching {
        if (!sessionFile.exists()) {
            return@runCatching null
        }
        val payload = JSONObject(sessionFile.readText(Charsets.UTF_8))
        val accessToken = payload.optString(KEY_ACCESS_TOKEN, "")
        val refreshToken = payload.optString(KEY_REFRESH_TOKEN, "")
        val sessionId = payload.optString(KEY_SESSION_ID, "")
        if (accessToken.isBlank() || refreshToken.isBlank() || sessionId.isBlank()) {
            return@runCatching null
        }

        StoredSession(
            accessToken = accessToken,
            refreshToken = refreshToken,
            sessionId = sessionId,
            accessTokenExpiresAt = payload.optLong(KEY_ACCESS_TOKEN_EXPIRES_AT, 0L),
            refreshTokenExpiresAt = payload.optLong(KEY_REFRESH_TOKEN_EXPIRES_AT, 0L),
            userId = payload.optString(KEY_USER_ID, "").ifBlank { null },
            userName = payload.optString(KEY_USER_NAME, "").ifBlank { null },
            userEmail = payload.optString(KEY_USER_EMAIL, "").ifBlank { null }
        )
    }.getOrNull()

    private fun writeSessionFile(session: StoredSession) {
        runCatching {
            sessionFile.parentFile?.mkdirs()
            val tempFile = File(sessionFile.parentFile, "${sessionFile.name}.tmp")
            val payload = JSONObject().apply {
                put(KEY_ACCESS_TOKEN, session.accessToken)
                put(KEY_REFRESH_TOKEN, session.refreshToken)
                put(KEY_SESSION_ID, session.sessionId)
                put(KEY_ACCESS_TOKEN_EXPIRES_AT, session.accessTokenExpiresAt)
                put(KEY_REFRESH_TOKEN_EXPIRES_AT, session.refreshTokenExpiresAt)
                put(KEY_USER_ID, session.userId.orEmpty())
                put(KEY_USER_NAME, session.userName.orEmpty())
                put(KEY_USER_EMAIL, session.userEmail.orEmpty())
            }
            tempFile.writeText(payload.toString(), Charsets.UTF_8)
            if (!tempFile.renameTo(sessionFile)) {
                tempFile.copyTo(sessionFile, overwrite = true)
                tempFile.delete()
            }
        }
    }

    companion object {
        private const val PREF_NAME = "shield_secure_session"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_SESSION_ID = "session_id"
        private const val KEY_ACCESS_TOKEN_EXPIRES_AT = "access_token_expires_at"
        private const val KEY_REFRESH_TOKEN_EXPIRES_AT = "refresh_token_expires_at"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USER_NAME = "user_name"
        private const val KEY_USER_EMAIL = "user_email"
    }
}
