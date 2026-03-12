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
import java.util.Calendar

data class HomeInstalledApp(
    val appName: String,
    val packageName: String
)

data class HomeUiState(
    val userName: String = "",
    val isLoggedIn: Boolean = false,
    val installedAppsCount: Int = 0,
    val installedApps: List<HomeInstalledApp> = emptyList(),
    val lastScanTime: Long = 0L,
    val recentResults: List<ScanResult> = emptyList(),
    val isProtectionActive: Boolean = true,
    val totalThreatsEver: Int = 0,
    val totalScans: Int = 0,
    val isGuest: Boolean = false,
    val guestScanUsed: Boolean = false,
    val isScanActive: Boolean = false,
    val activeScanType: String = "",
    val activeScanCurrentApp: String = "",
    val activeScanProgress: Int = 0,
    val fullScansToday: Int = 0,
    val selectiveScansToday: Int = 0,
    val apkScansToday: Int = 0
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
            val primarySnapshotFlow = combine(
                prefs.isLoggedIn,
                prefs.userName,
                prefs.lastScanTime,
                prefs.realtimeProtection,
                prefs.isGuest
            ) { isLoggedIn, name, lastScan, protection, isGuest ->
                PrimarySnapshot(
                    isLoggedIn = isLoggedIn,
                    name = name,
                    lastScan = lastScan,
                    protection = protection,
                    isGuest = isGuest
                )
            }

            val activeScanSnapshotFlow = combine(
                prefs.guestScanUsed,
                prefs.activeScanType,
                prefs.activeScanCurrentApp,
                prefs.activeScanProgress,
                prefs.activeScanStartedAt
            ) { guestScanUsed, activeScanType, activeScanCurrentApp, activeScanProgress, activeScanStartedAt ->
                ActiveScanSnapshot(
                    guestScanUsed = guestScanUsed,
                    activeScanType = activeScanType,
                    activeScanCurrentApp = activeScanCurrentApp,
                    activeScanProgress = activeScanProgress,
                    activeScanStartedAt = activeScanStartedAt
                )
            }

            combine(
                primarySnapshotFlow,
                activeScanSnapshotFlow
            ) { primary, active ->
                HomeSnapshot(
                    isLoggedIn = primary.isLoggedIn,
                    name = primary.name,
                    lastScan = primary.lastScan,
                    protection = primary.protection,
                    isGuest = primary.isGuest,
                    guestScanUsed = active.guestScanUsed,
                    activeScanType = active.activeScanType,
                    activeScanCurrentApp = active.activeScanCurrentApp,
                    activeScanProgress = active.activeScanProgress,
                    activeScanStartedAt = active.activeScanStartedAt
                )
            }.combine(scanRepo.getAllResults()) { snapshot, results ->
                val scanTooOld = snapshot.activeScanType.isNotBlank() &&
                    snapshot.activeScanStartedAt > 0L &&
                    System.currentTimeMillis() - snapshot.activeScanStartedAt > 30L * 60L * 1000L
                val installedApps = PackageUtils.getUserApps(context)
                val appsForSelection = installedApps.map {
                    HomeInstalledApp(appName = it.appName, packageName = it.packageName)
                }
                val startOfDay = startOfCurrentDay()
                val todayResults = results.filter { it.completedAt >= startOfDay }
                HomeUiState(
                    userName = snapshot.name,
                    isLoggedIn = snapshot.isLoggedIn,
                    installedAppsCount = installedApps.size,
                    installedApps = appsForSelection,
                    lastScanTime = snapshot.lastScan,
                    recentResults = if (snapshot.isGuest) emptyList() else results.take(4),
                    isProtectionActive = snapshot.protection && !snapshot.isGuest,
                    totalThreatsEver = if (snapshot.isGuest) 0 else results.sumOf { it.threatsFound },
                    totalScans = if (snapshot.isGuest) 0 else results.size,
                    isGuest = snapshot.isGuest,
                    guestScanUsed = snapshot.guestScanUsed,
                    isScanActive = snapshot.activeScanType.isNotBlank() && !scanTooOld,
                    activeScanType = if (scanTooOld) "" else snapshot.activeScanType,
                    activeScanCurrentApp = if (scanTooOld) "" else snapshot.activeScanCurrentApp,
                    activeScanProgress = snapshot.activeScanProgress,
                    fullScansToday = todayResults.count { it.scanType.uppercase() == "FULL" },
                    selectiveScansToday = todayResults.count { it.scanType.uppercase() == "SELECTIVE" },
                    apkScansToday = todayResults.count { it.scanType.uppercase() == "APK" }
                )
            }.collect { _state.value = it }
        }
    }

    private fun startOfCurrentDay(): Long = Calendar.getInstance().run {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
        timeInMillis
    }

    private data class HomeSnapshot(
        val isLoggedIn: Boolean,
        val name: String,
        val lastScan: Long,
        val protection: Boolean,
        val isGuest: Boolean,
        val guestScanUsed: Boolean,
        val activeScanType: String,
        val activeScanCurrentApp: String,
        val activeScanProgress: Int,
        val activeScanStartedAt: Long
    )

    private data class PrimarySnapshot(
        val isLoggedIn: Boolean,
        val name: String,
        val lastScan: Long,
        val protection: Boolean,
        val isGuest: Boolean
    )

    private data class ActiveScanSnapshot(
        val guestScanUsed: Boolean,
        val activeScanType: String,
        val activeScanCurrentApp: String,
        val activeScanProgress: Int,
        val activeScanStartedAt: Long
    )

    fun exitGuestMode() {
        viewModelScope.launch {
            prefs.exitGuestMode()
        }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            HomeViewModel(context.applicationContext) as T
    }
}
