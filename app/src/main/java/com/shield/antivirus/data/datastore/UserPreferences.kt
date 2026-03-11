package com.shield.antivirus.data.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import java.util.UUID

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "shield_prefs")

class UserPreferences(private val context: Context) {

    companion object {
        val KEY_IS_LOGGED_IN    = booleanPreferencesKey("is_logged_in")
        val KEY_USER_NAME       = stringPreferencesKey("user_name")
        val KEY_USER_EMAIL      = stringPreferencesKey("user_email")
        val KEY_USER_ID         = stringPreferencesKey("user_id")
        val KEY_VT_API_KEY      = stringPreferencesKey("vt_api_key")
        val KEY_REALTIME_PROT   = booleanPreferencesKey("realtime_protection")
        val KEY_SCAN_ON_INSTALL = booleanPreferencesKey("scan_on_install")
        val KEY_LAST_SCAN_TIME  = longPreferencesKey("last_scan_time")
        val KEY_TOTAL_THREATS   = intPreferencesKey("total_threats_found")
        val KEY_AUTH_TOKEN      = stringPreferencesKey("auth_token")
        val KEY_DEVICE_ID       = stringPreferencesKey("device_id")
    }

    val isLoggedIn: Flow<Boolean> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_IS_LOGGED_IN] ?: false }

    val userName: Flow<String> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_USER_NAME] ?: "" }

    val userEmail: Flow<String> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_USER_EMAIL] ?: "" }

    val vtApiKey: Flow<String> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_VT_API_KEY] ?: "" }

    val realtimeProtection: Flow<Boolean> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_REALTIME_PROT] ?: true }

    val scanOnInstall: Flow<Boolean> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_SCAN_ON_INSTALL] ?: true }

    val authToken: Flow<String> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_AUTH_TOKEN] ?: "" }

    val userId: Flow<String> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_USER_ID] ?: "" }

    val lastScanTime: Flow<Long> = context.dataStore.data
        .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
        .map { it[KEY_LAST_SCAN_TIME] ?: 0L }

    suspend fun setLoggedIn(value: Boolean) {
        context.dataStore.edit { it[KEY_IS_LOGGED_IN] = value }
    }

    suspend fun saveUser(name: String, email: String, id: String) {
        context.dataStore.edit {
            it[KEY_USER_NAME] = name
            it[KEY_USER_EMAIL] = email
            it[KEY_USER_ID] = id
            it[KEY_IS_LOGGED_IN] = true
        }
    }

    suspend fun setAuthToken(token: String) {
        context.dataStore.edit { it[KEY_AUTH_TOKEN] = token }
    }

    suspend fun logout() {
        context.dataStore.edit {
            it[KEY_IS_LOGGED_IN] = false
            it[KEY_USER_NAME] = ""
            it[KEY_USER_EMAIL] = ""
            it[KEY_USER_ID] = ""
            it[KEY_AUTH_TOKEN] = ""
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
        val existing = context.dataStore.data
            .catch { if (it is IOException) emit(emptyPreferences()) else throw it }
            .map { it[KEY_DEVICE_ID] ?: "" }
            .first()
            .trim()
        if (existing.isNotBlank()) return existing

        val generated = UUID.randomUUID().toString()
        context.dataStore.edit { it[KEY_DEVICE_ID] = generated }
        return generated
    }
}
