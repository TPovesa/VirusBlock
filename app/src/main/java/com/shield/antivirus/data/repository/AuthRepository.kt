package com.shield.antivirus.data.repository

import android.content.Context
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.LoginRequest
import com.shield.antivirus.data.model.RegisterRequest
import com.shield.antivirus.data.model.User
import com.shield.antivirus.data.security.ShieldSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

sealed class AuthResult {
    data class Success(val user: User) : AuthResult()
    data class Error(val message: String) : AuthResult()
}

class AuthRepository(context: Context) {
    private val prefs = UserPreferences(context)
    private val sessionManager = ShieldSessionManager(context)
    private val api   = ApiClient.shieldApi

    suspend fun register(name: String, email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                if (name.isBlank() || email.isBlank() || password.isBlank())
                    return@withContext AuthResult.Error("All fields are required")
                if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches())
                    return@withContext AuthResult.Error("Invalid email address")
                if (password.length < 6)
                    return@withContext AuthResult.Error("Password must be at least 6 characters")

                val response = api.register(
                    RegisterRequest(
                        name = name.trim(),
                        email = email.trim().lowercase(),
                        password = password,
                        deviceId = prefs.getOrCreateDeviceId()
                    )
                )
                if (response.isSuccessful) {
                    val body = response.body()
                    if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
                        AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
                    } else {
                        AuthResult.Error(body?.error ?: "Registration failed")
                    }
                } else {
                    val msg = parseError(response.errorBody()?.string()) ?: "Registration failed (${response.code()})"
                    AuthResult.Error(msg)
                }
            } catch (e: java.net.ConnectException) {
                AuthResult.Error("Cannot connect to server. Check internet connection.")
            } catch (e: Exception) {
                AuthResult.Error("Error: ${e.message}")
            }
        }

    suspend fun login(email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                if (email.isBlank() || password.isBlank())
                    return@withContext AuthResult.Error("Email and password required")

                val response = api.login(
                    LoginRequest(
                        email = email.trim().lowercase(),
                        password = password,
                        deviceId = prefs.getOrCreateDeviceId()
                    )
                )
                if (response.isSuccessful) {
                    val body = response.body()
                    if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
                        AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
                    } else {
                        AuthResult.Error(body?.error ?: "Login failed")
                    }
                } else {
                    val msg = parseError(response.errorBody()?.string()) ?: "Invalid email or password"
                    AuthResult.Error(msg)
                }
            } catch (e: java.net.ConnectException) {
                AuthResult.Error("Cannot connect to server. Check internet connection.")
            } catch (e: Exception) {
                AuthResult.Error("Error: ${e.message}")
            }
        }

    suspend fun logout() {
        sessionManager.logoutRemoteIfPossible()
        sessionManager.clearLocalSession()
    }

    suspend fun verifyToken(): Boolean {
        return try {
            val token = sessionManager.getValidAccessToken()
            if (token.isNullOrBlank()) return false
            api.getMe("Bearer $token").isSuccessful
        } catch (e: Exception) { false }
    }

    private fun parseError(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            com.google.gson.JsonParser.parseString(body).asJsonObject.get("error")?.asString
        } catch (e: Exception) { null }
    }
}
