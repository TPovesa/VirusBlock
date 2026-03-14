package com.shield.antivirus.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.data.repository.FullReportRateLimitException
import com.shield.antivirus.data.repository.ScanAlreadyRunningException
import com.shield.antivirus.data.repository.ScanProgress
import com.shield.antivirus.data.repository.ScanRepository
import com.shield.antivirus.util.AppLogger
import com.shield.antivirus.worker.DeepScanWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

data class ScanReportDownloadState(
    val isLoading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val nonce: Long = 0L
)

class ScanViewModel(private val context: Context) : ViewModel() {
    private val repo = ScanRepository(context)
    private val prefs = UserPreferences(context)
    private val workManager = WorkManager.getInstance(context.applicationContext)

    private val _progress = MutableStateFlow<ScanProgress?>(null)
    val progress: StateFlow<ScanProgress?> = _progress.asStateFlow()
    private val _actionLoading = MutableStateFlow(false)
    val actionLoading: StateFlow<Boolean> = _actionLoading.asStateFlow()

    private val _guestLimitReached = MutableStateFlow(false)
    val guestLimitReached: StateFlow<Boolean> = _guestLimitReached.asStateFlow()

    val isGuest = prefs.isGuest.stateIn(viewModelScope, SharingStarted.Lazily, false)
    val guestScanUsed = prefs.guestScanUsed.stateIn(viewModelScope, SharingStarted.Lazily, false)
    val isDeveloperMode = prefs.isDeveloperMode.stateIn(viewModelScope, SharingStarted.Lazily, false)

    val allResults: StateFlow<List<ScanResult>> = repo.getAllResults()
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    private val _currentResult = MutableStateFlow<ScanResult?>(null)
    val currentResult: StateFlow<ScanResult?> = _currentResult.asStateFlow()
    private val _reportDownloadState = MutableStateFlow(ScanReportDownloadState())
    val reportDownloadState: StateFlow<ScanReportDownloadState> = _reportDownloadState.asStateFlow()

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
            _actionLoading.value = true
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
                _actionLoading.value = false
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
                _actionLoading.value = false
                return@launch
            }
            if (guest) {
                _guestLimitReached.value = false
            }

            val dailyLimitMessage = when (scanType.uppercase()) {
                "SELECTIVE" -> when {
                    selectedPackages.isEmpty() -> "Для выборочной проверки сначала выберите приложение."
                    else -> null
                }
                "APK" -> when {
                    apkUri.isNullOrBlank() -> "Выберите APK-файл перед запуском проверки."
                    else -> null
                }
                else -> null
            }
            if (!dailyLimitMessage.isNullOrBlank()) {
                AppLogger.log(
                    tag = "scan_view_model",
                    message = "Scan start blocked by missing input",
                    level = "WARN",
                    metadata = mapOf("scan_type" to normalizedType)
                )
                _progress.value = ScanProgress(
                    currentApp = dailyLimitMessage,
                    scannedCount = 0,
                    totalCount = 1
                )
                _actionLoading.value = false
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
                    _actionLoading.value = false
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
                _actionLoading.value = false
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
                _actionLoading.value = false
            }
        }
    }

    private fun observeDeepScan(workId: UUID) {
        workObserverJob?.cancel()
        workObserverJob = viewModelScope.launch {
            workManager.getWorkInfoByIdFlow(workId).collect { info ->
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
                    _actionLoading.value = false
                    workObserverJob?.cancel()
                    return@collect
                }
                val data = if (info.state.isFinished) info.outputData else info.progress
                val totalCount = data.getInt(DeepScanWorker.KEY_TOTAL_COUNT, _progress.value?.totalCount ?: 1)
                val scannedCount = data.getInt(DeepScanWorker.KEY_SCANNED_COUNT, _progress.value?.scannedCount ?: 0)
                val savedId = data.getLong(DeepScanWorker.KEY_SAVED_ID, 0L)
                val errorMessage = data.getString(DeepScanWorker.KEY_ERROR_MESSAGE).orEmpty()
                val isComplete = data.getBoolean(DeepScanWorker.KEY_IS_COMPLETE, false) && savedId > 0L
                _progress.value = ScanProgress(
                    currentApp = if (errorMessage.isNotBlank()) errorMessage else data.getString(DeepScanWorker.KEY_CURRENT_APP).orEmpty(),
                    scannedCount = scannedCount,
                    totalCount = totalCount.coerceAtLeast(1),
                    threats = _progress.value?.threats.orEmpty(),
                    isComplete = isComplete,
                    savedId = savedId
                )
                _actionLoading.value = false
                if (info.state.isFinished) {
                    prefs.clearActiveDeepScan()
                    if (savedId > 0L) {
                        _currentResult.value = repo.getResultById(savedId)
                    } else if (errorMessage.isBlank()) {
                        _progress.value = _progress.value?.copy(
                            currentApp = "Серверная проверка завершилась без сохранённого отчёта. Повторите запуск."
                        )
                    }
                    AppLogger.log(
                        tag = "scan_view_model",
                        message = "Deep scan finished",
                        metadata = mapOf("saved_id" to savedId.toString())
                    )
                    workObserverJob?.cancel()
                }
            }
        }
    }

    fun cancelScan() {
        _actionLoading.value = true
        scanJob?.cancel()
        workObserverJob?.cancel()
        DeepScanWorker.cancel(context.applicationContext)
        viewModelScope.launch {
            prefs.clearActiveDeepScan()
            prefs.clearActiveScan()
            _actionLoading.value = false
        }
        _progress.value = null
        AppLogger.log(tag = "scan_view_model", message = "Scan cancelled by user")
    }

    fun loadResult(id: Long) {
        viewModelScope.launch {
            _currentResult.value = repo.getResultById(id)
        }
    }

    fun downloadCurrentFullReport() {
        viewModelScope.launch {
            val current = _currentResult.value
            if (current == null) {
                _reportDownloadState.value = ScanReportDownloadState(
                    error = "Сначала откройте результат проверки",
                    nonce = System.currentTimeMillis()
                )
                return@launch
            }
            val isDev = prefs.isDeveloperMode.first()
            if (!isDev) {
                _reportDownloadState.value = ScanReportDownloadState(
                    error = "Доступно только в режиме разработчика",
                    nonce = System.currentTimeMillis()
                )
                return@launch
            }
            _reportDownloadState.value = ScanReportDownloadState(isLoading = true)
            repo.downloadFullServerReport(current)
                .onSuccess { path ->
                    _reportDownloadState.value = ScanReportDownloadState(
                        message = "Отчёт сохранён: $path",
                        nonce = System.currentTimeMillis()
                    )
                }
                .onFailure { error ->
                    val userMessage = when {
                        error is FullReportRateLimitException ->
                            error.message
                        error.message?.contains("429") == true ->
                            "Слишком много запросов к полному отчёту. Подождите 1-2 минуты и попробуйте снова."
                        else ->
                            error.message
                    } ?: "Не удалось скачать полный отчёт"
                    _reportDownloadState.value = ScanReportDownloadState(
                        error = userMessage,
                        nonce = System.currentTimeMillis()
                    )
                }
        }
    }

    fun clearReportDownloadState() {
        _reportDownloadState.value = ScanReportDownloadState()
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
        val info = withContext(Dispatchers.IO) {
            runCatching { workManager.getWorkInfoById(workId).get() }.getOrNull()
        } ?: return false
        return info.state == WorkInfo.State.RUNNING || info.state == WorkInfo.State.ENQUEUED
    }

    private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
        "FULL", "SELECTIVE", "APK" -> "проверка"
        else -> "проверка"
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            ScanViewModel(context.applicationContext) as T
    }
}
