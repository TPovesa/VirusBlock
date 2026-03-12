package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.ThreatInfo
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.repository.InsightRepository
import com.shield.antivirus.data.repository.ScanAlreadyRunningException
import com.shield.antivirus.data.repository.ScanProgress
import com.shield.antivirus.data.repository.ScanRepository
import com.shield.antivirus.util.AppLogger
import com.shield.antivirus.worker.DeepScanWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

data class ScanExplainUiState(
    val isLoading: Boolean = false,
    val title: String? = null,
    val explanation: String? = null,
    val error: String? = null
)

class ScanViewModel(private val context: Context) : ViewModel() {
    private val repo = ScanRepository(context)
    private val insightRepo = InsightRepository(context)
    private val prefs = UserPreferences(context)
    private val workManager = WorkManager.getInstance(context.applicationContext)

    private val _progress = MutableStateFlow<ScanProgress?>(null)
    val progress: StateFlow<ScanProgress?> = _progress.asStateFlow()

    private val _guestLimitReached = MutableStateFlow(false)
    val guestLimitReached: StateFlow<Boolean> = _guestLimitReached.asStateFlow()

    val isGuest = prefs.isGuest.stateIn(viewModelScope, SharingStarted.Lazily, false)
    val guestScanUsed = prefs.guestScanUsed.stateIn(viewModelScope, SharingStarted.Lazily, false)

    val allResults: StateFlow<List<ScanResult>> = repo.getAllResults()
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    private val _currentResult = MutableStateFlow<ScanResult?>(null)
    val currentResult: StateFlow<ScanResult?> = _currentResult.asStateFlow()

    private val _explainState = MutableStateFlow(ScanExplainUiState())
    val explainState: StateFlow<ScanExplainUiState> = _explainState.asStateFlow()

    private var scanJob: Job? = null
    private var workObserverJob: Job? = null

    fun startScan(
        scanType: String,
        selectedPackages: List<String> = emptyList(),
        apkUri: String? = null
    ) {
        scanJob?.cancel()
        workObserverJob?.cancel()
        scanJob = viewModelScope.launch {
            AppLogger.log(
                tag = "scan_view_model",
                message = "startScan called",
                metadata = mapOf(
                    "scan_type" to scanType.uppercase(),
                    "selected_count" to selectedPackages.size.toString(),
                    "has_apk_uri" to (!apkUri.isNullOrBlank()).toString()
                )
            )
            var activeType = prefs.activeScanType.first()
            val activeStartedAt = prefs.activeScanStartedAt.first()
            val activeTooOld = activeType.isNotBlank() &&
                activeStartedAt > 0L &&
                System.currentTimeMillis() - activeStartedAt > 30L * 60L * 1000L
            if (activeTooOld) {
                prefs.clearActiveScan()
                activeType = ""
            }
            val activeDeepWorkId = prefs.activeDeepScanWorkId.first()
            val attachToRunningDeep = activeType.equals(scanType, ignoreCase = true) &&
                activeDeepWorkId.isNotBlank() &&
                scanType != "QUICK"
            if (activeType.isNotBlank() && !attachToRunningDeep) {
                AppLogger.log(
                    tag = "scan_view_model",
                    message = "startScan rejected: another active scan",
                    level = "WARN",
                    metadata = mapOf("active_type" to activeType)
                )
                _progress.value = ScanProgress(
                    currentApp = "Уже идёт ${scanTypeLabel(activeType)}. Нажмите «Посмотреть текущую проверку» на главном экране.",
                    scannedCount = 0,
                    totalCount = 1
                )
                return@launch
            }

            val guest = prefs.isGuest.first()
            val normalizedType = scanType.uppercase()
            if (guest && normalizedType != "QUICK") {
                AppLogger.log(
                    tag = "scan_view_model",
                    message = "Guest denied non-quick scan",
                    level = "WARN",
                    metadata = mapOf("scan_type" to normalizedType)
                )
                _guestLimitReached.value = true
                _progress.value = ScanProgress(
                    currentApp = "В гостевом режиме доступна только быстрая проверка. Войдите в аккаунт для остальных режимов.",
                    scannedCount = 0,
                    totalCount = 1
                )
                return@launch
            }
            if (guest) {
                _guestLimitReached.value = false
            }

            val selectedCountToday = repo.getDailyLaunchCount(scanType)
            val isDeveloperMode = prefs.isDeveloperMode.first()
            val dailyLimitMessage = when (scanType.uppercase()) {
                "FULL" -> if (selectedCountToday >= 1) {
                    "Лимит запусков: глубокая проверка доступна 1 раз в сутки."
                } else {
                    null
                }
                "SELECTIVE" -> when {
                    selectedPackages.isEmpty() -> "Для выборочной проверки сначала выберите приложение."
                    selectedCountToday >= 3 -> "Лимит запусков: выборочная проверка доступна 3 раза в сутки."
                    else -> null
                }
                "APK" -> when {
                    apkUri.isNullOrBlank() -> "Выберите APK-файл перед запуском проверки."
                    selectedCountToday >= 3 -> "Лимит запусков: проверка APK доступна 3 раза в сутки."
                    else -> null
                }
                else -> null
            }
            if (!isDeveloperMode && !dailyLimitMessage.isNullOrBlank()) {
                AppLogger.log(
                    tag = "scan_view_model",
                    message = "Scan limited by daily quota",
                    level = "WARN",
                    metadata = mapOf("scan_type" to normalizedType)
                )
                _progress.value = ScanProgress(
                    currentApp = dailyLimitMessage,
                    scannedCount = 0,
                    totalCount = 1
                )
                return@launch
            }

            _guestLimitReached.value = false
            _progress.value = ScanProgress(totalCount = 1)

            if (!guest && normalizedType != "QUICK") {
                val existingWorkId = prefs.activeDeepScanWorkId.first()
                    .takeIf { it.isNotBlank() }
                    ?.let { runCatching { UUID.fromString(it) }.getOrNull() }
                val existingType = prefs.activeDeepScanType.first()
                val reusableWorkId = existingWorkId
                    ?.takeIf { existingType == normalizedType && isWorkReusable(it) }

                val workId = if (reusableWorkId != null) {
                    reusableWorkId
                } else {
                    if (existingWorkId != null) {
                        prefs.clearActiveDeepScan()
                    }
                    val newId = DeepScanWorker.enqueue(
                        context = context.applicationContext,
                        scanType = normalizedType,
                        selectedPackages = selectedPackages,
                        apkUri = apkUri
                    )
                    prefs.setActiveDeepScan(newId.toString(), normalizedType)
                    newId
                }
                observeDeepScan(workId)
                return@launch
            }

            try {
                repo.startScan(
                    scanType = scanType,
                    selectedPackages = selectedPackages,
                    apkUriString = apkUri
                ).collect { progress ->
                    _progress.value = progress
                }
            } catch (error: ScanAlreadyRunningException) {
                AppLogger.logError(
                    tag = "scan_view_model",
                    message = "ScanAlreadyRunningException",
                    error = error
                )
                _progress.value = ScanProgress(
                    currentApp = error.message ?: "Уже выполняется другая проверка",
                    scannedCount = 0,
                    totalCount = 1
                )
            } catch (error: Exception) {
                AppLogger.logError(
                    tag = "scan_view_model",
                    message = "Quick scan failed",
                    error = error
                )
                _progress.value = ScanProgress(
                    currentApp = "Проверка завершилась с ошибкой: ${error.message ?: "неизвестно"}",
                    scannedCount = 0,
                    totalCount = 1
                )
            }
        }
    }

    private fun observeDeepScan(workId: UUID) {
        workObserverJob?.cancel()
        workObserverJob = viewModelScope.launch {
            while (true) {
                val info = runCatching { workManager.getWorkInfoById(workId).get() }.getOrNull()
                if (info == null) {
                    AppLogger.log(
                        tag = "scan_view_model",
                        message = "Deep scan work info lost",
                        level = "WARN"
                    )
                    prefs.clearActiveDeepScan()
                    _progress.value = _progress.value?.copy(
                        currentApp = "Глубокая проверка была прервана. Запустите её заново."
                    )
                    break
                }
                val data = if (info.state.isFinished) info.outputData else info.progress
                val totalCount = data.getInt(DeepScanWorker.KEY_TOTAL_COUNT, _progress.value?.totalCount ?: 1)
                val scannedCount = data.getInt(DeepScanWorker.KEY_SCANNED_COUNT, _progress.value?.scannedCount ?: 0)
                val savedId = data.getLong(DeepScanWorker.KEY_SAVED_ID, 0L)
                val errorMessage = data.getString(DeepScanWorker.KEY_ERROR_MESSAGE).orEmpty()
                _progress.value = ScanProgress(
                    currentApp = if (errorMessage.isNotBlank()) errorMessage else data.getString(DeepScanWorker.KEY_CURRENT_APP).orEmpty(),
                    scannedCount = scannedCount,
                    totalCount = totalCount.coerceAtLeast(1),
                    threats = _progress.value?.threats.orEmpty(),
                    isComplete = data.getBoolean(DeepScanWorker.KEY_IS_COMPLETE, info.state.isFinished),
                    savedId = savedId
                )
                if (info.state.isFinished) {
                    prefs.clearActiveDeepScan()
                    if (savedId > 0L) {
                        _currentResult.value = repo.getResultById(savedId)
                    }
                    AppLogger.log(
                        tag = "scan_view_model",
                        message = "Deep scan finished",
                        metadata = mapOf("saved_id" to savedId.toString())
                    )
                    break
                }
                delay(400)
            }
        }
    }

    fun cancelScan() {
        scanJob?.cancel()
        workObserverJob?.cancel()
        DeepScanWorker.cancel(context.applicationContext)
        viewModelScope.launch {
            prefs.clearActiveDeepScan()
            prefs.clearActiveScan()
        }
        _progress.value = null
        AppLogger.log(tag = "scan_view_model", message = "Scan cancelled by user")
    }

    fun loadResult(id: Long) {
        viewModelScope.launch {
            _currentResult.value = repo.getResultById(id)
        }
    }

    fun explainCurrentResult() {
        viewModelScope.launch {
            val result = _currentResult.value ?: run {
                _explainState.value = ScanExplainUiState(error = "Сначала откройте готовый отчёт")
                return@launch
            }
            _explainState.value = ScanExplainUiState(
                isLoading = true,
                title = result.threats.firstOrNull()?.appName ?: "Отчёт"
            )
            insightRepo.explainResult(
                result = result,
                isGuest = prefs.isGuest.first()
            ).onSuccess { explanation ->
                _explainState.value = ScanExplainUiState(
                    title = result.threats.firstOrNull()?.appName ?: "Отчёт",
                    explanation = explanation
                )
            }.onFailure { error ->
                _explainState.value = ScanExplainUiState(
                    title = result.threats.firstOrNull()?.appName ?: "Отчёт",
                    error = error.message ?: "Не удалось получить объяснение"
                )
            }
        }
    }

    fun explainThreat(threat: ThreatInfo) {
        viewModelScope.launch {
            val result = _currentResult.value ?: run {
                _explainState.value = ScanExplainUiState(error = "Сначала откройте готовый отчёт")
                return@launch
            }
            _explainState.value = ScanExplainUiState(isLoading = true, title = threat.appName)
            val scopedResult = result.copy(
                threats = listOf(threat),
                threatsFound = 1
            )
            insightRepo.explainResult(
                result = scopedResult,
                isGuest = prefs.isGuest.first()
            ).onSuccess { explanation ->
                _explainState.value = ScanExplainUiState(
                    title = threat.appName,
                    explanation = explanation
                )
            }.onFailure { error ->
                _explainState.value = ScanExplainUiState(
                    title = threat.appName,
                    error = error.message ?: "Не удалось получить объяснение"
                )
            }
        }
    }

    fun clearExplanation() {
        _explainState.value = ScanExplainUiState()
    }

    fun clearHistory() {
        viewModelScope.launch { repo.deleteAll() }
    }

    suspend fun exitGuestMode() {
        prefs.exitGuestMode()
    }

    suspend fun shouldExitGuestModeAfterResult(): Boolean =
        prefs.isGuest.first() && !prefs.isLoggedIn.first() && prefs.guestScanUsed.first()

    private suspend fun isWorkReusable(workId: UUID): Boolean {
        val info = runCatching { workManager.getWorkInfoById(workId).get() }.getOrNull() ?: return false
        return info.state == WorkInfo.State.RUNNING || info.state == WorkInfo.State.ENQUEUED
    }

    private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
        "FULL" -> "глубокая проверка"
        "SELECTIVE" -> "выборочная проверка"
        "APK" -> "проверка APK"
        else -> "проверка"
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            ScanViewModel(context.applicationContext) as T
    }
}
