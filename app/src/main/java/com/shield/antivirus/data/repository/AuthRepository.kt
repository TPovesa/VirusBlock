package com.shield.antivirus.data.repository

import android.content.Context
import android.util.Patterns
import com.google.gson.JsonParser
import com.shield.antivirus.data.api.ApiClient
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.LoginRequest
import com.shield.antivirus.data.model.PasswordResetConfirmRequest
import com.shield.antivirus.data.model.PasswordResetRequest
import com.shield.antivirus.data.model.ResendChallengeRequest
import com.shield.antivirus.data.model.RegisterRequest
import com.shield.antivirus.data.model.User
import com.shield.antivirus.data.model.VerifyCodeRequest
import com.shield.antivirus.data.security.ShieldSessionManager
import com.shield.antivirus.util.AppLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

sealed class AuthResult {
    data class Success(val user: User) : AuthResult()
    data class CodeSent(
        val email: String,
        val challengeId: String,
        val message: String,
        val expiresAt: Long
    ) : AuthResult()
    data class Message(val message: String) : AuthResult()
    data class Error(val message: String) : AuthResult()
}

class AuthRepository(context: Context) {
    private val prefs = UserPreferences(context)
    private val sessionManager = ShieldSessionManager(context)

    suspend fun startRegister(name: String, email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                val normalizedEmail = email.trim().lowercase()
                if (name.isBlank() || normalizedEmail.isBlank() || password.isBlank()) {
                    return@withContext AuthResult.Error("Заполните все поля")
                }
                if (!Patterns.EMAIL_ADDRESS.matcher(normalizedEmail).matches()) {
                    return@withContext AuthResult.Error("Неверный email")
                }
                if (password.length < 6) {
                    return@withContext AuthResult.Error("Пароль слишком короткий")
                }

                val response = ApiClient.executeShieldCall { api ->
                    api.startRegister(
                        RegisterRequest(
                            name = name.trim(),
                            email = normalizedEmail,
                            password = password,
                            deviceId = prefs.getOrCreateDeviceId()
                        )
                    )
                }
                if (!response.isSuccessful) {
                    val parsedError = parseError(response.errorBody()?.string())
                    if (response.code() == 404) {
                        return@withContext performDirectRegister(name.trim(), normalizedEmail, password)
                    }
                    return@withContext AuthResult.Error(
                        parsedError ?: "Не удалось отправить код (${response.code()})"
                    )
                }

                val body = response.body()
                val challengeId = body?.challengeId
                val targetEmail = body?.email ?: normalizedEmail
                if (body?.success == true && !challengeId.isNullOrBlank()) {
                    AppLogger.log(
                        tag = "auth_repository",
                        message = "Register challenge sent",
                        metadata = mapOf("email_domain" to normalizedEmail.substringAfter('@', missingDelimiterValue = "unknown"))
                    )
                    AuthResult.CodeSent(
                        email = targetEmail,
                        challengeId = challengeId,
                        message = body.message ?: "Код отправлен на $targetEmail",
                        expiresAt = body.expiresAt ?: (System.currentTimeMillis() + 15 * 60 * 1000)
                    )
                } else {
                    AuthResult.Error(body?.error ?: "Не удалось начать регистрацию")
                }
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
            }
        }

    suspend fun verifyRegister(challengeId: String, code: String): AuthResult =
        verifyCode(challengeId, code) { api, request -> api.verifyRegister(request) }

    suspend fun startLogin(email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                val normalizedEmail = email.trim().lowercase()
                if (normalizedEmail.isBlank() || password.isBlank()) {
                    return@withContext AuthResult.Error("Введите email и пароль")
                }

                val response = ApiClient.executeShieldCall { api ->
                    api.startLogin(
                        LoginRequest(
                            email = normalizedEmail,
                            password = password,
                            deviceId = prefs.getOrCreateDeviceId()
                        )
                    )
                }
                if (!response.isSuccessful) {
                    val parsedError = parseError(response.errorBody()?.string())
                    if (response.code() == 404) {
                        return@withContext performDirectLogin(normalizedEmail, password)
                    }
                    return@withContext AuthResult.Error(
                        parsedError ?: "Не удалось отправить код (${response.code()})"
                    )
                }

                val body = response.body()
                val challengeId = body?.challengeId
                val targetEmail = body?.email ?: normalizedEmail
                if (body?.success == true && !challengeId.isNullOrBlank()) {
                    AppLogger.log(
                        tag = "auth_repository",
                        message = "Login challenge sent",
                        metadata = mapOf("email_domain" to normalizedEmail.substringAfter('@', missingDelimiterValue = "unknown"))
                    )
                    AuthResult.CodeSent(
                        email = targetEmail,
                        challengeId = challengeId,
                        message = body.message ?: "Код отправлен на $targetEmail",
                        expiresAt = body.expiresAt ?: (System.currentTimeMillis() + 15 * 60 * 1000)
                    )
                } else {
                    AuthResult.Error(body?.error ?: "Не удалось начать вход")
                }
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
            }
        }

    suspend fun verifyLogin(challengeId: String, code: String): AuthResult =
        verifyCode(challengeId, code) { api, request -> api.verifyLogin(request) }

    suspend fun resendCode(flow: com.shield.antivirus.data.datastore.PendingAuthFlow, challengeId: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                if (challengeId.isBlank()) {
                    return@withContext AuthResult.Error("Нет активного кода для повторной отправки")
                }
                val response = ApiClient.executeShieldCall { api ->
                    when (flow) {
                        com.shield.antivirus.data.datastore.PendingAuthFlow.LOGIN -> {
                            api.resendLoginCode(ResendChallengeRequest(challengeId))
                        }
                        com.shield.antivirus.data.datastore.PendingAuthFlow.REGISTER -> {
                            api.resendRegisterCode(ResendChallengeRequest(challengeId))
                        }
                    }
                }
                if (!response.isSuccessful) {
                    return@withContext AuthResult.Error(
                        parseError(response.errorBody()?.string()) ?: "Не удалось отправить код повторно"
                    )
                }
                val body = response.body()
                val email = body?.email.orEmpty()
                val refreshedChallengeId = body?.challengeId ?: challengeId
                if (body?.success == true && refreshedChallengeId.isNotBlank()) {
                    AuthResult.CodeSent(
                        email = email,
                        challengeId = refreshedChallengeId,
                        message = body.message ?: "Код отправлен повторно",
                        expiresAt = body.expiresAt ?: (System.currentTimeMillis() + 15 * 60 * 1000)
                    )
                } else {
                    AuthResult.Error(body?.error ?: "Не удалось отправить код повторно")
                }
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
            }
        }

    suspend fun requestPasswordReset(email: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                val normalizedEmail = email.trim().lowercase()
                if (!Patterns.EMAIL_ADDRESS.matcher(normalizedEmail).matches()) {
                    return@withContext AuthResult.Error("Введите корректный email")
                }

                val response = ApiClient.executeShieldCall(shouldFailover = { it.code() >= 500 }) { api ->
                    api.requestPasswordReset(PasswordResetRequest(normalizedEmail))
                }
                if (!response.isSuccessful) {
                    return@withContext AuthResult.Error(
                        parseError(response.errorBody()?.string())
                            ?: "Не удалось отправить ссылку"
                    )
                }
                val body = response.body()
                AuthResult.Message(body?.message ?: "Если почта существует, ссылка уже отправлена")
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
            }
        }

    suspend fun confirmPasswordReset(token: String, email: String, password: String): AuthResult =
        withContext(Dispatchers.IO) {
            try {
                if (token.isBlank()) {
                    return@withContext AuthResult.Error("Ссылка недействительна")
                }
                val normalizedEmail = email.trim().lowercase()
                if (!Patterns.EMAIL_ADDRESS.matcher(normalizedEmail).matches()) {
                    return@withContext AuthResult.Error("Неверный email")
                }
                if (password.length < 6) {
                    return@withContext AuthResult.Error("Пароль слишком короткий")
                }

                val response = ApiClient.executeShieldCall(shouldFailover = { it.code() >= 500 }) { api ->
                    api.confirmPasswordReset(
                        PasswordResetConfirmRequest(
                            token = token,
                            email = normalizedEmail,
                            password = password
                        )
                    )
                }
                if (!response.isSuccessful) {
                    return@withContext AuthResult.Error(
                        parseError(response.errorBody()?.string())
                            ?: "Не удалось изменить пароль"
                    )
                }

                sessionManager.clearLocalSession()
                val body = response.body()
                AuthResult.Message(body?.message ?: "Пароль обновлён")
            } catch (error: Exception) {
                AuthResult.Error(error.toUserMessage())
            }
        }

    suspend fun logout() {
        AppLogger.log(tag = "auth_repository", message = "Logout requested")
        sessionManager.logoutRemoteIfPossible()
        sessionManager.clearLocalSession()
    }

    suspend fun verifyToken(): Boolean {
        return try {
            val token = sessionManager.getValidAccessToken()
            if (token.isNullOrBlank()) return sessionManager.hasStoredSession()
            val response = ApiClient.executeShieldCall { api ->
                api.getMe("Bearer $token")
            }
            when {
                response.isSuccessful -> true
                response.code() == 401 || response.code() == 403 -> false
                else -> sessionManager.hasStoredSession()
            }
        } catch (_: Exception) {
            sessionManager.hasStoredSession()
        }
    }

    private suspend fun verifyCode(
        challengeId: String,
        code: String,
        block: suspend (com.shield.antivirus.data.api.ShieldApi, VerifyCodeRequest) -> retrofit2.Response<com.shield.antivirus.data.model.AuthResponse>
    ): AuthResult = withContext(Dispatchers.IO) {
        try {
            if (challengeId.isBlank() || code.length < 4) {
                return@withContext AuthResult.Error("Введите код из письма")
            }

            val response = ApiClient.executeShieldCall { api ->
                block(
                    api,
                    VerifyCodeRequest(
                        challengeId = challengeId,
                        code = code.trim(),
                        deviceId = prefs.getOrCreateDeviceId()
                    )
                )
            }
            if (!response.isSuccessful) {
                return@withContext AuthResult.Error(
                    parseError(response.errorBody()?.string())
                        ?: "Неверный код"
                )
            }

            val body = response.body()
            if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
                AppLogger.log(
                    tag = "auth_repository",
                    message = "Auth code verified",
                    metadata = mapOf("user_id" to body.user.id)
                )
                AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
            } else {
                AuthResult.Error(body?.error ?: "Код не подтверждён")
            }
        } catch (error: Exception) {
            AuthResult.Error(error.toUserMessage())
        }
    }

    private suspend fun performDirectRegister(name: String, normalizedEmail: String, password: String): AuthResult {
        val response = ApiClient.executeShieldCall { api ->
            api.registerDirect(
                RegisterRequest(
                    name = name,
                    email = normalizedEmail,
                    password = password,
                    deviceId = prefs.getOrCreateDeviceId()
                )
            )
        }
        if (!response.isSuccessful) {
            return AuthResult.Error(
                parseError(response.errorBody()?.string())
                    ?: "Не удалось зарегистрироваться (${response.code()})"
            )
        }

        val body = response.body()
        return if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
            AppLogger.log(
                tag = "auth_repository",
                message = "Direct register success",
                metadata = mapOf("user_id" to body.user.id)
            )
            AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
        } else {
            AuthResult.Error(body?.error ?: "Не удалось зарегистрироваться")
        }
    }

    private suspend fun performDirectLogin(normalizedEmail: String, password: String): AuthResult {
        val response = ApiClient.executeShieldCall { api ->
            api.loginDirect(
                LoginRequest(
                    email = normalizedEmail,
                    password = password,
                    deviceId = prefs.getOrCreateDeviceId()
                )
            )
        }
        if (!response.isSuccessful) {
            return AuthResult.Error(
                parseError(response.errorBody()?.string())
                    ?: "Не удалось войти (${response.code()})"
            )
        }

        val body = response.body()
        return if (body?.success == true && body.user != null && sessionManager.persistAuth(body)) {
            AppLogger.log(
                tag = "auth_repository",
                message = "Direct login success",
                metadata = mapOf("user_id" to body.user.id)
            )
            AuthResult.Success(User(body.user.id, body.user.name, body.user.email))
        } else {
            AuthResult.Error(body?.error ?: "Не удалось войти")
        }
    }

    private fun parseError(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val json = JsonParser.parseString(body).asJsonObject
            when {
                json.get("error")?.isJsonPrimitive == true -> localizeServerMessage(json.get("error").asString)
                json.get("detail")?.isJsonPrimitive == true -> localizeServerMessage(json.get("detail").asString)
                json.get("message")?.isJsonPrimitive == true -> localizeServerMessage(json.get("message").asString)
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun localizeServerMessage(message: String): String = when (message.trim()) {
        "Mail service is not configured" -> "Почта сервера пока не настроена"
        "Server error" -> "Ошибка сервера"
        "Endpoint not found" -> "Маршрут не найден"
        "Too many auth requests." -> "Слишком много попыток входа"
        "Too many requests, please try again later." -> "Слишком много запросов, попробуйте позже"
        "All fields are required" -> "Заполните все поля"
        "Invalid email address" -> "Неверный email"
        "Password must be at least 6 characters" -> "Пароль должен быть не короче 6 символов"
        "Email already registered" -> "Почта уже зарегистрирована"
        "Invalid email or password" -> "Неверная почта или пароль"
        "Email and password required" -> "Введите почту и пароль"
        "Invalid verification code" -> "Неверный код"
        "Challenge expired" -> "Код истёк"
        "Challenge already used" -> "Код уже использован"
        "Reset link sent to email" -> "Ссылка для сброса отправлена на почту"
        "If the email exists, a reset link has been sent" -> "Если почта существует, ссылка уже отправлена"
        "Password updated successfully" -> "Пароль обновлён"
        else -> message
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
