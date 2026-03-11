package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.repository.ScanRepository
import com.shield.antivirus.util.PackageUtils
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

data class HomeUiState(
    val userName: String = "",
    val installedAppsCount: Int = 0,
    val lastScanTime: Long = 0L,
    val recentResults: List<ScanResult> = emptyList(),
    val isProtectionActive: Boolean = true,
    val totalThreatsEver: Int = 0,
    val totalScans: Int = 0,
    val isGuest: Boolean = false,
    val guestScanUsed: Boolean = false
)

class HomeViewModel(private val context: Context) : ViewModel() {
    private val prefs = UserPreferences(context)
    private val scanRepo = ScanRepository(context)

    private val _state = MutableStateFlow<HomeUiState?>(null)
    val state: StateFlow<HomeUiState?> = _state.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            combine(
                prefs.userName,
                prefs.lastScanTime,
                prefs.realtimeProtection,
                prefs.isGuest,
                prefs.guestScanUsed
            ) { name, lastScan, protection, isGuest, guestScanUsed ->
                HomeSnapshot(
                    name = name,
                    lastScan = lastScan,
                    protection = protection,
                    isGuest = isGuest,
                    guestScanUsed = guestScanUsed
                )
            }.combine(scanRepo.getAllResults()) { snapshot, results ->
                val appCount = PackageUtils.getUserApps(context).size
                HomeUiState(
                    userName = snapshot.name,
                    installedAppsCount = appCount,
                    lastScanTime = snapshot.lastScan,
                    recentResults = if (snapshot.isGuest) emptyList() else results.take(4),
                    isProtectionActive = snapshot.protection && !snapshot.isGuest,
                    totalThreatsEver = if (snapshot.isGuest) 0 else results.sumOf { it.threatsFound },
                    totalScans = if (snapshot.isGuest) 0 else results.size,
                    isGuest = snapshot.isGuest,
                    guestScanUsed = snapshot.guestScanUsed
                )
            }.collect { _state.value = it }
        }
    }

    private data class HomeSnapshot(
        val name: String,
        val lastScan: Long,
        val protection: Boolean,
        val isGuest: Boolean,
        val guestScanUsed: Boolean
    )

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            HomeViewModel(context.applicationContext) as T
    }
}
