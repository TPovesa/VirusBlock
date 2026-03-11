package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.*
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.repository.ScanProgress
import com.shield.antivirus.data.repository.ScanRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class ScanViewModel(private val context: Context) : ViewModel() {
    private val repo = ScanRepository(context)

    private val _progress = MutableStateFlow<ScanProgress?>(null)
    val progress: StateFlow<ScanProgress?> = _progress.asStateFlow()

    val allResults: StateFlow<List<ScanResult>> = repo.getAllResults()
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    private val _currentResult = MutableStateFlow<ScanResult?>(null)
    val currentResult: StateFlow<ScanResult?> = _currentResult.asStateFlow()

    private var scanJob: Job? = null

    fun startScan(scanType: String, selectedPackages: List<String> = emptyList()) {
        scanJob?.cancel()
        _progress.value = ScanProgress(totalCount = 1)
        scanJob = viewModelScope.launch {
            repo.startScan(scanType, selectedPackages).collect { progress ->
                _progress.value = progress
            }
        }
    }

    fun cancelScan() {
        scanJob?.cancel()
        _progress.value = null
    }

    fun loadResult(id: Long) {
        viewModelScope.launch {
            _currentResult.value = repo.getResultById(id)
        }
    }

    fun clearHistory() {
        viewModelScope.launch { repo.deleteAll() }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            ScanViewModel(context.applicationContext) as T
    }
}
