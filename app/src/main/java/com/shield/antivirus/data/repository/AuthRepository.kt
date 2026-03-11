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
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

sealed class AuthResult {
    data class Success(val user: User) : AuthResult()
    data class Error(val message: String) : AuthResult()
}

class AuthRepository(context: Context) {
    private val prefs = UserPreferences(context)
    private val sessionManager = ShieldSessionManager(context)

    suspend fun register(name: String, email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                if (name.isBlank() || email.isBlank() || password.isBlank()) {
                    return@withContext AuthResult.Error("Заполните все поля")
                }
                if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                    return@withContext AuthResult.Error("Неверный email")
                }
                if (password.length < 6) {
                    return@withContext AuthResult.Error("Пароль слишком короткий")
                }

                val response = ApiClient.executeShieldCall { api ->
                    api.register(
                        RegisterRequest(
                            name = name.trim(),
                            email = email.trim().lowercase(),
                            password = password,
                            deviceId = prefs.getOrCreateDeviceId()
                        )
                    )
                }
                if (response.isSuccessful) {
                    val body = response.body()
                    if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
                        AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
                    } else {
                        AuthResult.Error(body?.error ?: "Не удалось зарегистрироваться")
                    }
                } else {
                    val message = parseError(response.errorBody()?.string())
                        ?: if (response.code() == 404) {
                            "Сервер авторизации недоступен"
                        } else {
                            "Ошибка регистрации (${response.code()})"
                        }
                    AuthResult.Error(message)
                }
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
            }
        }

    suspend fun login(email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                if (email.isBlank() || password.isBlank()) {
                    return@withContext AuthResult.Error("Введите email и пароль")
                }

                val response = ApiClient.executeShieldCall { api ->
                    api.login(
                        LoginRequest(
                            email = email.trim().lowercase(),
                            password = password,
                            deviceId = prefs.getOrCreateDeviceId()
                        )
                    )
                }
                if (response.isSuccessful) {
                    val body = response.body()
                    if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
                        AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
                    } else {
                        AuthResult.Error(body?.error ?: "Не удалось войти")
                    }
                } else {
                    val message = parseError(response.errorBody()?.string())
                        ?: if (response.code() == 404) {
                            "Сервер авторизации недоступен"
                        } else {
                            "Неверный email или пароль"
                        }
                    AuthResult.Error(message)
                }
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
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
            ApiClient.executeShieldCall { api ->
                api.getMe("Bearer $token")
            }.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    private fun parseError(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val json = com.google.gson.JsonParser.parseString(body).asJsonObject
            when {
                json.get("error")?.isJsonPrimitive == true -> json.get("error").asString
                json.get("detail")?.isJsonPrimitive == true -> json.get("detail").asString
                json.get("message")?.isJsonPrimitive == true -> json.get("message").asString
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun Exception.toUserMessage(): String = when (this) {
        is ConnectException -> "Нет соединения с сервером"
        is UnknownHostException -> "Не удаётся найти сервер"
        is SocketTimeoutException -> "Сервер не ответил вовремя"
        is SSLException -> "Ошибка защищённого соединения"
        else -> message?.takeIf { it.isNotBlank() }?.let { "Ошибка: $it" }
            ?: "Ошибка авторизации"
    }
}
