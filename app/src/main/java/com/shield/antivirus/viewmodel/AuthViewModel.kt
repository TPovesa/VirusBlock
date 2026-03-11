package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.*
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.repository.AuthRepository
import com.shield.antivirus.data.repository.AuthResult
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false
)

class AuthViewModel(private val context: Context) : ViewModel() {
    private val repo  = AuthRepository(context)
    private val prefs = UserPreferences(context)

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    val userName = prefs.userName.stateIn(viewModelScope, SharingStarted.Lazily, "")
    val userEmail = prefs.userEmail.stateIn(viewModelScope, SharingStarted.Lazily, "")
    val vtApiKey  = prefs.vtApiKey.stateIn(viewModelScope, SharingStarted.Lazily, "")
    val realtimeProtection = prefs.realtimeProtection.stateIn(viewModelScope, SharingStarted.Lazily, true)
    val scanOnInstall = prefs.scanOnInstall.stateIn(viewModelScope, SharingStarted.Lazily, true)

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            when (val result = repo.login(email, password)) {
                is AuthResult.Success -> _uiState.value = AuthUiState(success = true)
                is AuthResult.Error   -> _uiState.value = AuthUiState(error = result.message)
            }
        }
    }

    fun register(name: String, email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            when (val result = repo.register(name, email, password)) {
                is AuthResult.Success -> _uiState.value = AuthUiState(success = true)
                is AuthResult.Error   -> _uiState.value = AuthUiState(error = result.message)
            }
        }
    }

    fun logout() {
        viewModelScope.launch { repo.logout() }
    }

    fun saveVtApiKey(key: String) {
        viewModelScope.launch { prefs.setVtApiKey(key) }
    }

    fun setRealtimeProtection(enabled: Boolean) {
        viewModelScope.launch { prefs.setRealtimeProtection(enabled) }
    }

    fun setScanOnInstall(enabled: Boolean) {
        viewModelScope.launch { prefs.setScanOnInstall(enabled) }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            AuthViewModel(context.applicationContext) as T
    }
}
