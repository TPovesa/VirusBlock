package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.shield.antivirus.data.datastore.PendingAuthFlow
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.repository.AuthRepository
import com.shield.antivirus.data.repository.AuthResult
import com.shield.antivirus.util.ProtectionServiceController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val infoMessage: String? = null,
    val success: Boolean = false,
    val requiresCode: Boolean = false,
    val pendingEmail: String = "",
    val pendingChallengeId: String = "",
    val passwordResetComplete: Boolean = false
)

class AuthViewModel(private val context: Context) : ViewModel() {
    private val repo = AuthRepository(context)
    private val prefs = UserPreferences(context)

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    val userName = prefs.userName.stateIn(viewModelScope, SharingStarted.Lazily, "")
    val userEmail = prefs.userEmail.stateIn(viewModelScope, SharingStarted.Lazily, "")
    val realtimeProtection = prefs.realtimeProtection.stateIn(viewModelScope, SharingStarted.Lazily, true)
    val scanOnInstall = prefs.scanOnInstall.stateIn(viewModelScope, SharingStarted.Lazily, true)
    val isGuest = prefs.isGuest.stateIn(viewModelScope, SharingStarted.Lazily, false)
    val guestScanUsed = prefs.guestScanUsed.stateIn(viewModelScope, SharingStarted.Lazily, false)

    fun restorePending(flow: PendingAuthFlow) {
        viewModelScope.launch {
            val pendingFlow = prefs.pendingAuthFlow.first()
            val expiresAt = prefs.pendingAuthExpiresAt.first()
            if (pendingFlow == flow && expiresAt > System.currentTimeMillis()) {
                _uiState.value = _uiState.value.copy(
                    requiresCode = true,
                    pendingEmail = prefs.pendingAuthEmail.first(),
                    pendingChallengeId = prefs.pendingAuthChallengeId.first(),
                    error = null
                )
            } else if (pendingFlow == flow) {
                prefs.clearPendingAuth(flow)
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            when (val result = repo.startLogin(email, password)) {
                is AuthResult.Success -> {
                    ProtectionServiceController.sync(context)
                    _uiState.value = AuthUiState(success = true)
                }
                is AuthResult.CodeSent -> {
                    prefs.savePendingAuth(
                        flow = PendingAuthFlow.LOGIN,
                        challengeId = result.challengeId,
                        email = result.email,
                        expiresAt = result.expiresAt
                    )
                    _uiState.value = AuthUiState(
                        requiresCode = true,
                        pendingEmail = result.email,
                        pendingChallengeId = result.challengeId,
                        infoMessage = "${result.message}. Проверьте входящие и папку Спам."
                    )
                }
                is AuthResult.Error -> _uiState.value = AuthUiState(error = result.message)
                else -> _uiState.value = AuthUiState(error = "Не удалось начать вход")
            }
        }
    }

    fun register(name: String, email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            when (val result = repo.startRegister(name, email, password)) {
                is AuthResult.Success -> {
                    ProtectionServiceController.sync(context)
                    _uiState.value = AuthUiState(success = true)
                }
                is AuthResult.CodeSent -> {
                    prefs.savePendingAuth(
                        flow = PendingAuthFlow.REGISTER,
                        challengeId = result.challengeId,
                        email = result.email,
                        expiresAt = result.expiresAt
                    )
                    _uiState.value = AuthUiState(
                        requiresCode = true,
                        pendingEmail = result.email,
                        pendingChallengeId = result.challengeId,
                        infoMessage = "${result.message}. Проверьте входящие и папку Спам."
                    )
                }
                is AuthResult.Error -> _uiState.value = AuthUiState(error = result.message)
                else -> _uiState.value = AuthUiState(error = "Не удалось начать регистрацию")
            }
        }
    }

    fun verifyCode(flow: PendingAuthFlow, code: String) {
        viewModelScope.launch {
            val challengeId = uiState.value.pendingChallengeId.ifBlank { prefs.pendingAuthChallengeId.first() }
            val pendingEmail = uiState.value.pendingEmail.ifBlank { prefs.pendingAuthEmail.first() }
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            val result = when (flow) {
                PendingAuthFlow.LOGIN -> repo.verifyLogin(challengeId, code)
                PendingAuthFlow.REGISTER -> repo.verifyRegister(challengeId, code)
            }

            when (result) {
                is AuthResult.Success -> {
                    prefs.clearPendingAuth(flow)
                    ProtectionServiceController.sync(context)
                    _uiState.value = AuthUiState(success = true, pendingEmail = pendingEmail)
                }
                is AuthResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message,
                        requiresCode = true,
                        pendingEmail = pendingEmail,
                        pendingChallengeId = challengeId
                    )
                }
                else -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = "Не удалось подтвердить код",
                        requiresCode = true,
                        pendingEmail = pendingEmail,
                        pendingChallengeId = challengeId
                    )
                }
            }
        }
    }

    fun requestPasswordReset(email: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, infoMessage = null)
            when (val result = repo.requestPasswordReset(email)) {
                is AuthResult.Message -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        infoMessage = result.message
                    )
                }
                is AuthResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        infoMessage = "Проверьте почту"
                    )
                }
            }
        }
    }

    fun confirmPasswordReset(token: String, email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, infoMessage = null)
            when (val result = repo.confirmPasswordReset(token, email, password)) {
                is AuthResult.Message -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        infoMessage = result.message,
                        passwordResetComplete = true
                    )
                }
                is AuthResult.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        infoMessage = "Пароль обновлён",
                        passwordResetComplete = true
                    )
                }
            }
        }
    }

    fun enterGuestMode(onComplete: (() -> Unit)? = null) {
        viewModelScope.launch {
            prefs.enterGuestMode()
            ProtectionServiceController.stop(context)
            onComplete?.invoke()
        }
    }

    fun logout(onComplete: (() -> Unit)? = null) {
        viewModelScope.launch {
            repo.logout()
            ProtectionServiceController.stop(context)
            onComplete?.invoke()
        }
    }

    fun setRealtimeProtection(enabled: Boolean) {
        viewModelScope.launch {
            prefs.setRealtimeProtection(enabled)
            ProtectionServiceController.sync(context)
        }
    }

    fun setScanOnInstall(enabled: Boolean) {
        viewModelScope.launch { prefs.setScanOnInstall(enabled) }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun clearInfo() {
        _uiState.value = _uiState.value.copy(infoMessage = null)
    }

    fun clearPending(flow: PendingAuthFlow) {
        viewModelScope.launch {
            prefs.clearPendingAuth(flow)
            _uiState.value = AuthUiState()
        }
    }

    fun resetUiState() {
        _uiState.value = AuthUiState()
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            AuthViewModel(context.applicationContext) as T
    }
}
