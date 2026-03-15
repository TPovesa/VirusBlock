package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.repository.ScanRepository
import com.shield.antivirus.util.PackageUtils
import com.shield.antivirus.worker.DeepScanWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import java.util.Calendar

data class HomeInstalledApp(
    val appName: String,
    val packageName: String
)

data class HomeUiState(
    val userName: String = "",
    val isLoggedIn: Boolean = false,
    val isDeveloperMode: Boolean = false,
    val installedAppsCount: Int = 0,
    val installedApps: List<HomeInstalledApp> = emptyList(),
    val lastScanTime: Long = 0L,
    val lastBackgroundScanTime: Long = 0L,
    val lastBackgroundScanResultId: Long? = null,
    val recentResults: List<ScanResult> = emptyList(),
    val isProtectionActive: Boolean = true,
    val lastScanThreatCount: Int = 0,
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
            val installedApps = withContext(Dispatchers.IO) {
                PackageUtils.getAllInstalledApps(context, includeSystem = true)
            }
            val selectableApps = installedApps.filter { !it.isSystemApp }
            val appsForSelection = selectableApps.map {
                HomeInstalledApp(appName = it.appName, packageName = it.packageName)
            }

            val primarySnapshotFlow = prefs.isLoggedIn
                .combine(prefs.userName) { isLoggedIn, name ->
                    Pair(isLoggedIn, name)
                }
                .combine(prefs.lastScanTime) { pair, lastScan ->
                    Triple(pair.first, pair.second, lastScan)
                }
                .combine(prefs.realtimeProtection) { triple, protection ->
                    PrimarySnapshot(
                        isLoggedIn = triple.first,
                        name = triple.second,
                        lastScan = triple.third,
                        protection = protection,
                        isGuest = false,
                        isDeveloperMode = false
                    )
                }
                .combine(prefs.isGuest) { snapshot, isGuest ->
                    snapshot.copy(isGuest = isGuest)
                }
                .combine(prefs.isDeveloperMode) { snapshot, isDeveloperMode ->
                    snapshot.copy(isDeveloperMode = isDeveloperMode)
                }

            val activeScanSnapshotFlow = prefs.guestScanUsed
                .combine(prefs.activeScanType) { guestScanUsed, activeScanType ->
                    Pair(guestScanUsed, activeScanType)
                }
                .combine(prefs.activeScanCurrentApp) { pair, activeScanCurrentApp ->
                    Triple(pair.first, pair.second, activeScanCurrentApp)
                }
                .combine(prefs.activeScanProgress) { triple, activeScanProgress ->
                    ActiveScanSnapshot(
                        guestScanUsed = triple.first,
                        activeScanType = triple.second,
                        activeScanCurrentApp = triple.third,
                        activeScanProgress = activeScanProgress,
                        activeScanStartedAt = 0L
                    )
                }
                .combine(prefs.activeScanStartedAt) { snapshot, activeScanStartedAt ->
                    snapshot.copy(activeScanStartedAt = activeScanStartedAt)
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
                    isDeveloperMode = primary.isDeveloperMode,
                    guestScanUsed = active.guestScanUsed,
                    activeScanType = active.activeScanType,
                    activeScanCurrentApp = active.activeScanCurrentApp,
                    activeScanProgress = active.activeScanProgress,
                    activeScanStartedAt = active.activeScanStartedAt
                )
            }.combine(scanRepo.getAllResults()) { snapshot, results ->
                val startOfDay = startOfCurrentDay()
                val todayResults = results.filter { it.completedAt >= startOfDay }
                val latestBackgroundResult = results
                    .filter { it.scanType.uppercase() == "QUICK_BG" }
                    .maxByOrNull { it.completedAt }
                HomeUiState(
                    userName = snapshot.name,
                    isLoggedIn = snapshot.isLoggedIn,
                    isDeveloperMode = snapshot.isDeveloperMode,
                    installedAppsCount = installedApps.size,
                    installedApps = appsForSelection,
                    lastScanTime = snapshot.lastScan,
                    lastBackgroundScanTime = latestBackgroundResult?.completedAt ?: 0L,
                    lastBackgroundScanResultId = latestBackgroundResult?.id,
                    recentResults = if (snapshot.isGuest) emptyList() else results.take(4),
                    isProtectionActive = snapshot.protection && !snapshot.isGuest,
                    lastScanThreatCount = if (snapshot.isGuest) 0 else (latestBackgroundResult?.threatsFound ?: 0),
                    totalScans = if (snapshot.isGuest) 0 else results.size,
                    isGuest = snapshot.isGuest,
                    guestScanUsed = snapshot.guestScanUsed,
                    isScanActive = snapshot.activeScanType.isNotBlank(),
                    activeScanType = snapshot.activeScanType,
                    activeScanCurrentApp = snapshot.activeScanCurrentApp,
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
        val isDeveloperMode: Boolean,
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
        val isGuest: Boolean,
        val isDeveloperMode: Boolean
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

    fun cancelActiveScan() {
        viewModelScope.launch {
            DeepScanWorker.cancel(context.applicationContext)
            prefs.clearActiveDeepScan()
            prefs.clearActiveScan()
        }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            HomeViewModel(context.applicationContext) as T
    }
}
