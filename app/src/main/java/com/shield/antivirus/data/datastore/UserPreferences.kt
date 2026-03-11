package com.shield.antivirus.data.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import java.util.UUID

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "shield_prefs")

enum class PendingAuthFlow {
    LOGIN,
    REGISTER;

    companion object {
        fun fromRaw(value: String?): PendingAuthFlow? =
            entries.firstOrNull { it.name == value }
    }
}

class UserPreferences(private val context: Context) {

    companion object {
        val KEY_IS_LOGGED_IN = booleanPreferencesKey("is_logged_in")
        val KEY_USER_NAME = stringPreferencesKey("user_name")
        val KEY_USER_EMAIL = stringPreferencesKey("user_email")
        val KEY_USER_ID = stringPreferencesKey("user_id")
        val KEY_VT_API_KEY = stringPreferencesKey("vt_api_key")
        val KEY_REALTIME_PROT = booleanPreferencesKey("realtime_protection")
        val KEY_SCAN_ON_INSTALL = booleanPreferencesKey("scan_on_install")
        val KEY_LAST_SCAN_TIME = longPreferencesKey("last_scan_time")
        val KEY_TOTAL_THREATS = intPreferencesKey("total_threats_found")
        val KEY_AUTH_TOKEN = stringPreferencesKey("auth_token")
        val KEY_DEVICE_ID = stringPreferencesKey("device_id")
        val KEY_IS_GUEST = booleanPreferencesKey("is_guest")
        val KEY_GUEST_SCAN_USED = booleanPreferencesKey("guest_scan_used")
        val KEY_PENDING_AUTH_FLOW = stringPreferencesKey("pending_auth_flow")
        val KEY_PENDING_AUTH_CHALLENGE_ID = stringPreferencesKey("pending_auth_challenge_id")
        val KEY_PENDING_AUTH_EMAIL = stringPreferencesKey("pending_auth_email")
        val KEY_PENDING_AUTH_EXPIRES_AT = longPreferencesKey("pending_auth_expires_at")
    }

    val isLoggedIn: Flow<Boolean> = context.dataStore.data.preferenceFlow(KEY_IS_LOGGED_IN, false)
    val userName: Flow<String> = context.dataStore.data.preferenceFlow(KEY_USER_NAME, "")
    val userEmail: Flow<String> = context.dataStore.data.preferenceFlow(KEY_USER_EMAIL, "")
    val vtApiKey: Flow<String> = context.dataStore.data.preferenceFlow(KEY_VT_API_KEY, "")
    val realtimeProtection: Flow<Boolean> = context.dataStore.data.preferenceFlow(KEY_REALTIME_PROT, true)
    val scanOnInstall: Flow<Boolean> = context.dataStore.data.preferenceFlow(KEY_SCAN_ON_INSTALL, true)
    val authToken: Flow<String> = context.dataStore.data.preferenceFlow(KEY_AUTH_TOKEN, "")
    val userId: Flow<String> = context.dataStore.data.preferenceFlow(KEY_USER_ID, "")
    val lastScanTime: Flow<Long> = context.dataStore.data.preferenceFlow(KEY_LAST_SCAN_TIME, 0L)
    val isGuest: Flow<Boolean> = context.dataStore.data.preferenceFlow(KEY_IS_GUEST, false)
    val guestScanUsed: Flow<Boolean> = context.dataStore.data.preferenceFlow(KEY_GUEST_SCAN_USED, false)
    val pendingAuthFlow: Flow<PendingAuthFlow?> = context.dataStore.data
        .catchPreferences()
        .map { PendingAuthFlow.fromRaw(it[KEY_PENDING_AUTH_FLOW]) }
    val pendingAuthChallengeId: Flow<String> = context.dataStore.data.preferenceFlow(KEY_PENDING_AUTH_CHALLENGE_ID, "")
    val pendingAuthEmail: Flow<String> = context.dataStore.data.preferenceFlow(KEY_PENDING_AUTH_EMAIL, "")
    val pendingAuthExpiresAt: Flow<Long> = context.dataStore.data.preferenceFlow(KEY_PENDING_AUTH_EXPIRES_AT, 0L)

    suspend fun setLoggedIn(value: Boolean) {
        context.dataStore.edit { it[KEY_IS_LOGGED_IN] = value }
    }

    suspend fun saveUser(name: String, email: String, id: String) {
        context.dataStore.edit {
            it[KEY_USER_NAME] = name
            it[KEY_USER_EMAIL] = email
            it[KEY_USER_ID] = id
            it[KEY_IS_LOGGED_IN] = true
            it[KEY_IS_GUEST] = false
            it[KEY_REALTIME_PROT] = true
            it[KEY_SCAN_ON_INSTALL] = true
            it.remove(KEY_PENDING_AUTH_FLOW)
            it.remove(KEY_PENDING_AUTH_CHALLENGE_ID)
            it.remove(KEY_PENDING_AUTH_EMAIL)
            it.remove(KEY_PENDING_AUTH_EXPIRES_AT)
        }
    }

    suspend fun setAuthToken(token: String) {
        context.dataStore.edit { it[KEY_AUTH_TOKEN] = token }
    }

    suspend fun enterGuestMode() {
        context.dataStore.edit {
            it[KEY_IS_GUEST] = true
            it[KEY_IS_LOGGED_IN] = false
            it[KEY_REALTIME_PROT] = false
            it[KEY_SCAN_ON_INSTALL] = false
            it[KEY_USER_NAME] = ""
            it[KEY_USER_EMAIL] = ""
            it[KEY_USER_ID] = ""
            it[KEY_AUTH_TOKEN] = ""
        }
    }

    suspend fun exitGuestMode() {
        context.dataStore.edit { it[KEY_IS_GUEST] = false }
    }

    suspend fun markGuestScanUsed() {
        context.dataStore.edit { it[KEY_GUEST_SCAN_USED] = true }
    }

    suspend fun logout() {
        context.dataStore.edit {
            it[KEY_IS_LOGGED_IN] = false
            it[KEY_IS_GUEST] = false
            it[KEY_USER_NAME] = ""
            it[KEY_USER_EMAIL] = ""
            it[KEY_USER_ID] = ""
            it[KEY_AUTH_TOKEN] = ""
            it.remove(KEY_PENDING_AUTH_FLOW)
            it.remove(KEY_PENDING_AUTH_CHALLENGE_ID)
            it.remove(KEY_PENDING_AUTH_EMAIL)
            it.remove(KEY_PENDING_AUTH_EXPIRES_AT)
        }
    }

    suspend fun savePendingAuth(flow: PendingAuthFlow, challengeId: String, email: String, expiresAt: Long) {
        context.dataStore.edit {
            it[KEY_PENDING_AUTH_FLOW] = flow.name
            it[KEY_PENDING_AUTH_CHALLENGE_ID] = challengeId
            it[KEY_PENDING_AUTH_EMAIL] = email
            it[KEY_PENDING_AUTH_EXPIRES_AT] = expiresAt
        }
    }

    suspend fun clearPendingAuth(flow: PendingAuthFlow? = null) {
        context.dataStore.edit {
            val current = PendingAuthFlow.fromRaw(it[KEY_PENDING_AUTH_FLOW])
            if (flow == null || current == flow) {
                it.remove(KEY_PENDING_AUTH_FLOW)
                it.remove(KEY_PENDING_AUTH_CHALLENGE_ID)
                it.remove(KEY_PENDING_AUTH_EMAIL)
                it.remove(KEY_PENDING_AUTH_EXPIRES_AT)
            }
        }
    }

    suspend fun setVtApiKey(key: String) {
        context.dataStore.edit { it[KEY_VT_API_KEY] = key }
    }

    suspend fun setRealtimeProtection(enabled: Boolean) {
        context.dataStore.edit { it[KEY_REALTIME_PROT] = enabled }
    }

    suspend fun setScanOnInstall(enabled: Boolean) {
        context.dataStore.edit { it[KEY_SCAN_ON_INSTALL] = enabled }
    }

    suspend fun updateLastScanTime() {
        context.dataStore.edit { it[KEY_LAST_SCAN_TIME] = System.currentTimeMillis() }
    }

    suspend fun getOrCreateDeviceId(): String {
        val existing = context.dataStore.data.preferenceFlow(KEY_DEVICE_ID, "").first().trim()
        if (existing.isNotBlank()) return existing

        val generated = UUID.randomUUID().toString()
        context.dataStore.edit { it[KEY_DEVICE_ID] = generated }
        return generated
    }
}

private fun <T> Flow<Preferences>.preferenceFlow(key: Preferences.Key<T>, defaultValue: T): Flow<T> =
    catchPreferences().map { it[key] ?: defaultValue }

private fun Flow<Preferences>.catchPreferences(): Flow<Preferences> =
    catch { if (it is IOException) emit(emptyPreferences()) else throw it }
