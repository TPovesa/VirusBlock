package com.neuralv.desktop.app

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.neuralv.desktop.app.theme.NeuralVDesktopTheme
import com.neuralv.desktop.core.api.NeuralVApiClient
import com.neuralv.desktop.core.model.AuthChallengeMode
import com.neuralv.desktop.core.model.ChallengeTicket
import com.neuralv.desktop.core.model.DesktopArtifactKind
import com.neuralv.desktop.core.model.DesktopPlatform
import com.neuralv.desktop.core.model.DesktopScanMode
import com.neuralv.desktop.core.model.DesktopScanResult
import com.neuralv.desktop.core.model.DesktopStartScanRequest
import com.neuralv.desktop.core.model.ReleaseArtifact
import com.neuralv.desktop.core.model.SessionState
import com.neuralv.desktop.core.repository.AuthRepository
import com.neuralv.desktop.core.repository.DesktopScanRepository
import com.neuralv.desktop.core.service.SessionStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.awt.FileDialog
import java.awt.Frame
import java.io.File
import java.text.DateFormat
import java.util.Date

private enum class DesktopScreen {
    WELCOME,
    AUTH,
    HOME,
    SCAN,
    RESULTS,
    HISTORY,
    SETTINGS
}

private enum class ThemeMode {
    SYSTEM,
    LIGHT,
    DARK
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NeuralVDesktopApp() {
    var backendUrl by remember { mutableStateOf("https://sosiskibot.ru/basedata") }
    var themeMode by remember { mutableStateOf(ThemeMode.SYSTEM) }
    var screen by remember { mutableStateOf(DesktopScreen.WELCOME) }
    var authMode by remember { mutableStateOf(AuthChallengeMode.LOGIN) }
    var authName by remember { mutableStateOf("") }
    var authEmail by remember { mutableStateOf("") }
    var authPassword by remember { mutableStateOf("") }
    var authCode by remember { mutableStateOf("") }
    var challengeTicket by remember { mutableStateOf<ChallengeTicket?>(null) }
    var session by remember { mutableStateOf<SessionState?>(null) }
    var activeScan by remember { mutableStateOf<DesktopScanResult?>(null) }
    var selectedMode by remember { mutableStateOf(DesktopScanMode.FULL) }
    var selectedArtifact by remember { mutableStateOf<File?>(null) }
    var isBusy by remember { mutableStateOf(false) }
    var infoMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showThemeDialog by remember { mutableStateOf(false) }
    val history = remember { mutableStateListOf<DesktopScanResult>() }
    val manifestArtifacts = remember { mutableStateListOf<ReleaseArtifact>() }
    val sessionStore = remember { SessionStore() }
    val scope = rememberCoroutineScope()

    val apiClient = remember(backendUrl) { NeuralVApiClient(backendUrl) }
    val authRepository = remember(backendUrl) { AuthRepository(apiClient, sessionStore, backendUrl) }
    val scanRepository = remember(backendUrl) { DesktopScanRepository(apiClient) }

    LaunchedEffect(backendUrl) {
        session = authRepository.readCachedSession()
        if (session != null && screen == DesktopScreen.WELCOME) {
            screen = DesktopScreen.HOME
        }
        runCatching { scanRepository.releaseManifest() }
            .onSuccess {
                manifestArtifacts.clear()
                manifestArtifacts.addAll(it)
            }
    }

    NeuralVDesktopTheme(
        darkTheme = when (themeMode) {
            ThemeMode.SYSTEM -> isSystemInDarkTheme()
            ThemeMode.LIGHT -> false
            ThemeMode.DARK -> true
        },
        dynamicAccentEnabled = true
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            MaterialTheme.colorScheme.background,
                            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            MaterialTheme.colorScheme.surface
                        )
                    )
                )
        ) {
            Scaffold(
                containerColor = Color.Transparent,
                topBar = {
                    TopAppBar(
                        title = {
                            Column {
                                Text("NeuralV", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                                Text(
                                    screenTitle(screen),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        actions = {
                            IconButton(onClick = { showThemeDialog = true }) {
                                Icon(
                                    imageVector = if (themeMode == ThemeMode.DARK) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
                                    contentDescription = "Тема"
                                )
                            }
                            if (session != null) {
                                IconButton(onClick = { screen = DesktopScreen.HISTORY }) {
                                    Icon(Icons.Rounded.History, contentDescription = "История")
                                }
                                IconButton(onClick = { screen = DesktopScreen.SETTINGS }) {
                                    Icon(Icons.Rounded.Settings, contentDescription = "Настройки")
                                }
                            }
                        }
                    )
                }
            ) { paddingValues ->
                when (screen) {
                    DesktopScreen.WELCOME -> WelcomeScreen(
                        modifier = Modifier.padding(paddingValues),
                        artifacts = manifestArtifacts,
                        onEnter = { screen = if (session == null) DesktopScreen.AUTH else DesktopScreen.HOME }
                    )
                    DesktopScreen.AUTH -> AuthScreen(
                        modifier = Modifier.padding(paddingValues),
                        authMode = authMode,
                        challengePending = challengeTicket != null,
                        name = authName,
                        email = authEmail,
                        password = authPassword,
                        code = authCode,
                        infoMessage = infoMessage,
                        errorMessage = errorMessage,
                        isBusy = isBusy,
                        onModeChange = { authMode = it },
                        onNameChange = { authName = it },
                        onEmailChange = { authEmail = it },
                        onPasswordChange = { authPassword = it },
                        onCodeChange = { authCode = it },
                        onBack = {
                            if (challengeTicket != null) {
                                challengeTicket = null
                                authCode = ""
                                infoMessage = null
                            } else {
                                screen = DesktopScreen.WELCOME
                            }
                        },
                        onSubmit = {
                            scope.launch {
                                isBusy = true
                                errorMessage = null
                                runCatching {
                                    if (challengeTicket == null) {
                                        challengeTicket = when (authMode) {
                                            AuthChallengeMode.LOGIN -> authRepository.startLogin(authEmail, authPassword)
                                            AuthChallengeMode.REGISTER -> authRepository.startRegister(authName, authEmail, authPassword)
                                        }
                                        infoMessage = "Код отправлен на почту"
                                    } else {
                                        session = authRepository.verifyChallenge(requireNotNull(challengeTicket), authCode)
                                        challengeTicket = null
                                        authCode = ""
                                        infoMessage = "Сессия сохранена"
                                        screen = DesktopScreen.HOME
                                    }
                                }.onFailure {
                                    errorMessage = it.message ?: "Не удалось завершить авторизацию"
                                }
                                isBusy = false
                            }
                        }
                    )
                    DesktopScreen.HOME -> HomeScreen(
                        modifier = Modifier.padding(paddingValues),
                        session = session,
                        activeScan = activeScan,
                        history = history,
                        onScan = { screen = DesktopScreen.SCAN },
                        onHistory = { screen = DesktopScreen.HISTORY },
                        onSettings = { screen = DesktopScreen.SETTINGS },
                        onOpenResult = {
                            activeScan = it
                            screen = DesktopScreen.RESULTS
                        }
                    )
                    DesktopScreen.SCAN -> ScanScreen(
                        modifier = Modifier.padding(paddingValues),
                        selectedMode = selectedMode,
                        selectedArtifact = selectedArtifact,
                        activeScan = activeScan,
                        isBusy = isBusy,
                        infoMessage = infoMessage,
                        errorMessage = errorMessage,
                        onModeChange = { selectedMode = it },
                        onChooseArtifact = { selectedArtifact = chooseFile() },
                        onStart = {
                            val currentSession = session ?: return@ScanScreen
                            scope.launch {
                                isBusy = true
                                errorMessage = null
                                infoMessage = "Отправляем задачу на сервер"
                                runCatching {
                                    val artifact = selectedArtifact
                                    val request = DesktopStartScanRequest(
                                        platform = currentPlatform(),
                                        mode = selectedMode,
                                        artifactKind = artifact?.toArtifactKind() ?: DesktopArtifactKind.UNKNOWN,
                                        artifactMetadata = mapOf(
                                            "target_name" to (artifact?.name ?: currentPlatform().name.lowercase()),
                                            "target_path" to (artifact?.absolutePath ?: System.getProperty("user.home")),
                                            "file_size_bytes" to artifact?.length(),
                                            "upload_required" to (selectedMode == DesktopScanMode.SELECTIVE || selectedMode == DesktopScanMode.ARTIFACT),
                                            "origin_path" to artifact?.parent
                                        )
                                    )
                                    var result = scanRepository.startScan(currentSession, request)
                                    if ((selectedMode == DesktopScanMode.SELECTIVE || selectedMode == DesktopScanMode.ARTIFACT) &&
                                        artifact != null && result.summary.status == "AWAITING_UPLOAD"
                                    ) {
                                        result = scanRepository.uploadArtifact(currentSession, result.summary.scanId, artifact)
                                    }
                                    activeScan = result
                                    if (result.summary.status == "QUEUED" || result.summary.status == "RUNNING" || result.summary.status == "AWAITING_UPLOAD") {
                                        pollDesktopScan(scanRepository, currentSession, result.summary.scanId) { polled ->
                                            activeScan = polled
                                            if (polled.summary.status == "COMPLETED") {
                                                history.removeAll { it.summary.scanId == polled.summary.scanId }
                                                history.add(0, polled)
                                                infoMessage = "Проверка завершена"
                                                screen = DesktopScreen.RESULTS
                                            }
                                        }
                                    } else {
                                        history.removeAll { it.summary.scanId == result.summary.scanId }
                                        history.add(0, result)
                                        screen = DesktopScreen.RESULTS
                                    }
                                }.onFailure {
                                    errorMessage = it.message ?: "Не удалось запустить проверку"
                                }
                                isBusy = false
                            }
                        },
                        onCancel = {
                            val currentSession = session ?: return@ScanScreen
                            scope.launch {
                                runCatching { scanRepository.cancelActive(currentSession) }
                                    .onSuccess {
                                        activeScan = it
                                        infoMessage = "Активная проверка отменена"
                                    }
                                    .onFailure {
                                        errorMessage = it.message ?: "Не удалось отменить проверку"
                                    }
                            }
                        }
                    )
                    DesktopScreen.RESULTS -> ResultsScreen(
                        modifier = Modifier.padding(paddingValues),
                        result = activeScan,
                        onBack = { screen = DesktopScreen.HOME },
                        onSyncFullReport = {
                            val currentSession = session ?: return@ResultsScreen
                            val currentScan = activeScan ?: return@ResultsScreen
                            scope.launch {
                                runCatching { scanRepository.fullReport(currentSession, listOf(currentScan.summary.scanId)) }
                                    .onSuccess { reports ->
                                        val report = reports.firstOrNull() ?: return@onSuccess
                                        activeScan = report
                                        history.removeAll { it.summary.scanId == report.summary.scanId }
                                        history.add(0, report)
                                        infoMessage = "Полный отчёт синхронизирован"
                                    }
                                    .onFailure {
                                        errorMessage = it.message ?: "Не удалось загрузить полный отчёт"
                                    }
                            }
                        }
                    )
                    DesktopScreen.HISTORY -> HistoryScreen(
                        modifier = Modifier.padding(paddingValues),
                        history = history,
                        onOpen = {
                            activeScan = it
                            screen = DesktopScreen.RESULTS
                        }
                    )
                    DesktopScreen.SETTINGS -> SettingsScreen(
                        modifier = Modifier.padding(paddingValues),
                        backendUrl = backendUrl,
                        session = session,
                        onBackendUrlChange = { backendUrl = it.trim().removeSuffix("/") },
                        onLogout = {
                            scope.launch {
                                authRepository.logout()
                                session = null
                                activeScan = null
                                history.clear()
                                screen = DesktopScreen.AUTH
                            }
                        }
                    )
                }
            }

            if (isBusy) {
                BusyOverlay()
            }
            if (showThemeDialog) {
                ThemeDialog(
                    current = themeMode,
                    onSelect = {
                        themeMode = it
                        showThemeDialog = false
                    },
                    onDismiss = { showThemeDialog = false }
                )
            }
            if (!errorMessage.isNullOrBlank()) {
                AlertDialog(
                    onDismissRequest = { errorMessage = null },
                    confirmButton = { TextButton(onClick = { errorMessage = null }) { Text("Ок") } },
                    title = { Text("NeuralV") },
                    text = { Text(errorMessage.orEmpty()) }
                )
            }
        }
    }
}

@Composable
private fun WelcomeScreen(
    modifier: Modifier,
    artifacts: List<ReleaseArtifact>,
    onEnter: () -> Unit
) {
    ScrollColumn(modifier) {
        HeroCard(
            title = "NeuralV для рабочего стола",
            text = "Windows и Linux используют тот же backend, что и Android: единая авторизация, серверные проверки и общая история.",
            primaryLabel = "Открыть",
            onPrimary = onEnter
        )
        SectionCard(title = "Артефакты") {
            if (artifacts.isEmpty()) {
                Text("Публикация ещё не завершена. После зелёных GitHub builder’ов здесь появятся актуальные загрузки.")
            } else {
                artifacts.forEach { artifact ->
                    ArtifactRow(artifact)
                }
            }
        }
    }
}

@Composable
private fun AuthScreen(
    modifier: Modifier,
    authMode: AuthChallengeMode,
    challengePending: Boolean,
    name: String,
    email: String,
    password: String,
    code: String,
    infoMessage: String?,
    errorMessage: String?,
    isBusy: Boolean,
    onModeChange: (AuthChallengeMode) -> Unit,
    onNameChange: (String) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onBack: () -> Unit,
    onSubmit: () -> Unit
) {
    ScrollColumn(modifier, centered = true) {
        SectionCard(title = if (challengePending) "Код подтверждения" else "Авторизация") {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ModeButton("Вход", authMode == AuthChallengeMode.LOGIN && !challengePending) { onModeChange(AuthChallengeMode.LOGIN) }
                ModeButton("Регистрация", authMode == AuthChallengeMode.REGISTER && !challengePending) { onModeChange(AuthChallengeMode.REGISTER) }
            }
            if (!challengePending && authMode == AuthChallengeMode.REGISTER) {
                OutlinedTextField(value = name, onValueChange = onNameChange, label = { Text("Имя") }, modifier = Modifier.fillMaxWidth())
            }
            OutlinedTextField(value = email, onValueChange = onEmailChange, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
            if (challengePending) {
                OutlinedTextField(value = code, onValueChange = onCodeChange, label = { Text("Код из письма") }, modifier = Modifier.fillMaxWidth())
            } else {
                OutlinedTextField(value = password, onValueChange = onPasswordChange, label = { Text("Пароль") }, modifier = Modifier.fillMaxWidth())
            }
            infoMessage?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            errorMessage?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onBack) { Text("Назад") }
                Button(onClick = onSubmit, enabled = !isBusy) { Text(if (challengePending) "Подтвердить" else "Продолжить") }
            }
        }
    }
}

@Composable
private fun HomeScreen(
    modifier: Modifier,
    session: SessionState?,
    activeScan: DesktopScanResult?,
    history: List<DesktopScanResult>,
    onScan: () -> Unit,
    onHistory: () -> Unit,
    onSettings: () -> Unit,
    onOpenResult: (DesktopScanResult) -> Unit
) {
    ScrollColumn(modifier) {
        HeroCard(
            title = session?.user?.name ?: "NeuralV",
            text = session?.user?.email ?: "Сессия ещё не активна",
            primaryLabel = "Проверка",
            onPrimary = onScan,
            secondary = {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onHistory) {
                        Icon(Icons.Rounded.History, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("История")
                    }
                    OutlinedButton(onClick = onSettings) {
                        Icon(Icons.Rounded.Settings, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Настройки")
                    }
                }
            }
        )
        activeScan?.let {
            SectionCard(title = "Текущая проверка") {
                Text("${modeLabel(it.summary.mode)} • ${it.summary.status}")
                it.summary.message?.let { message -> Text(message) }
                Button(onClick = { onOpenResult(it) }) { Text("Открыть") }
            }
        }
        if (history.isNotEmpty()) {
            SectionCard(title = "Последние результаты") {
                history.take(5).forEach { item ->
                    HistoryRow(item, onOpen = { onOpenResult(item) })
                }
            }
        }
    }
}

@Composable
private fun ScanScreen(
    modifier: Modifier,
    selectedMode: DesktopScanMode,
    selectedArtifact: File?,
    activeScan: DesktopScanResult?,
    isBusy: Boolean,
    infoMessage: String?,
    errorMessage: String?,
    onModeChange: (DesktopScanMode) -> Unit,
    onChooseArtifact: () -> Unit,
    onStart: () -> Unit,
    onCancel: () -> Unit
) {
    ScrollColumn(modifier) {
        SectionCard(title = "Режим проверки") {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf(DesktopScanMode.FULL, DesktopScanMode.SELECTIVE, DesktopScanMode.ARTIFACT).forEach { mode ->
                    ModeButton(modeLabel(mode), selectedMode == mode) { onModeChange(mode) }
                }
            }
            if (selectedMode == DesktopScanMode.SELECTIVE || selectedMode == DesktopScanMode.ARTIFACT) {
                OutlinedButton(onClick = onChooseArtifact) {
                    Icon(Icons.Rounded.UploadFile, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(selectedArtifact?.name ?: "Выбрать файл")
                }
                selectedArtifact?.let { Text(it.absolutePath, style = MaterialTheme.typography.bodySmall) }
            }
            infoMessage?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            errorMessage?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onStart, enabled = !isBusy) {
                    Icon(Icons.Rounded.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Запустить")
                }
                if (activeScan != null) {
                    OutlinedButton(onClick = onCancel) { Text("Отменить") }
                }
            }
        }
        activeScan?.let {
            SectionCard(title = "Серверный job") {
                Text(it.summary.scanId)
                Text(it.summary.status)
                it.summary.message?.let { message -> Text(message) }
            }
        }
    }
}

@Composable
private fun ResultsScreen(
    modifier: Modifier,
    result: DesktopScanResult?,
    onBack: () -> Unit,
    onSyncFullReport: () -> Unit
) {
    if (result == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Результат ещё не загружен")
        }
        return
    }
    ScrollColumn(modifier) {
        SectionCard(title = "${modeLabel(result.summary.mode)} • ${result.summary.platform.name}") {
            Text(result.summary.message ?: result.summary.status)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onBack) { Text("Назад") }
                Button(onClick = onSyncFullReport) {
                    Icon(Icons.Rounded.Download, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Полный отчёт")
                }
            }
        }
        result.findings.forEach { finding ->
            SectionCard(title = finding.title) {
                Text(finding.summary)
                if (finding.evidence.isNotEmpty()) {
                    Text(finding.evidence.joinToString(separator = "\n• ", prefix = "• "), style = MaterialTheme.typography.bodySmall)
                }
                finding.artifact?.let { artifact ->
                    Text(
                        "${artifact.displayName} • ${artifact.path}",
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryScreen(
    modifier: Modifier,
    history: List<DesktopScanResult>,
    onOpen: (DesktopScanResult) -> Unit
) {
    ScrollColumn(modifier) {
        if (history.isEmpty()) {
            SectionCard(title = "История") {
                Text("История пока пуста")
            }
        } else {
            SectionCard(title = "История") {
                history.forEach { item ->
                    HistoryRow(item, onOpen = { onOpen(item) })
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    modifier: Modifier,
    backendUrl: String,
    session: SessionState?,
    onBackendUrlChange: (String) -> Unit,
    onLogout: () -> Unit
) {
    ScrollColumn(modifier) {
        SectionCard(title = "Подключение") {
            OutlinedTextField(
                value = backendUrl,
                onValueChange = onBackendUrlChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Backend URL") }
            )
            Text("Desktop клиент работает через тот же /basedata backend.")
        }
        session?.let {
            SectionCard(title = "Сессия") {
                Text(it.user.email)
                Text(if (it.user.isDeveloperMode) "Режим разработчика активен" else "Обычный доступ")
                OutlinedButton(onClick = onLogout) { Text("Выйти") }
            }
        }
    }
}

@Composable
private fun ScrollColumn(
    modifier: Modifier,
    centered: Boolean = false,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = if (centered) Alignment.CenterHorizontally else Alignment.Start,
        content = content
    )
}

@Composable
private fun HeroCard(
    title: String,
    text: String,
    primaryLabel: String,
    onPrimary: () -> Unit,
    secondary: @Composable (() -> Unit)? = null
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(30.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Surface(
                modifier = Modifier.size(84.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Security, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
                }
            }
            Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onPrimary) { Text(primaryLabel) }
                secondary?.invoke()
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(26.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                content()
            }
        )
    }
}

@Composable
private fun ArtifactRow(artifact: ReleaseArtifact) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.Download, contentDescription = null)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${artifact.platform.uppercase()} • ${artifact.version}", fontWeight = FontWeight.SemiBold)
            Text(
                artifact.downloadUrl ?: artifact.installCommand.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun HistoryRow(result: DesktopScanResult, onOpen: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${modeLabel(result.summary.mode)} • ${result.summary.status}", fontWeight = FontWeight.SemiBold)
            Text(DateFormat.getDateTimeInstance().format(Date(result.summary.startedAt)), style = MaterialTheme.typography.bodySmall)
        }
        OutlinedButton(onClick = onOpen) { Text("Открыть") }
    }
}

@Composable
private fun ModeButton(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = if (selected) {
        CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    } else {
        CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
    }
    Card(colors = colors, modifier = Modifier, shape = RoundedCornerShape(999.dp)) {
        TextButton(onClick = onClick) { Text(label) }
    }
}

@Composable
private fun BusyOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.20f)),
        contentAlignment = Alignment.Center
    ) {
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                LinearProgressIndicator(modifier = Modifier.width(220.dp))
                Text("NeuralV выполняет операцию")
            }
        }
    }
}

@Composable
private fun ThemeDialog(current: ThemeMode, onSelect: (ThemeMode) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {},
        title = { Text("Тема") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ThemeMode.entries.forEach { mode ->
                    TextButton(onClick = { onSelect(mode) }) {
                        Text(if (mode == current) "• ${themeLabel(mode)}" else themeLabel(mode))
                    }
                }
            }
        }
    )
}

private suspend fun pollDesktopScan(
    repository: DesktopScanRepository,
    session: SessionState,
    scanId: String,
    onResult: (DesktopScanResult) -> Unit
) {
    repeat(300) {
        val result = repository.pollScan(session, scanId)
        onResult(result)
        if (result.summary.status == "COMPLETED" || result.summary.status == "FAILED" || result.summary.status == "CANCELLED") {
            return
        }
        delay(2_000)
    }
}

private fun currentPlatform(): DesktopPlatform {
    return if (System.getProperty("os.name", "").lowercase().contains("win")) DesktopPlatform.WINDOWS else DesktopPlatform.LINUX
}

private fun screenTitle(screen: DesktopScreen): String = when (screen) {
    DesktopScreen.WELCOME -> "Windows и Linux GUI"
    DesktopScreen.AUTH -> "Единая авторизация"
    DesktopScreen.HOME -> "Панель управления"
    DesktopScreen.SCAN -> "Серверная проверка"
    DesktopScreen.RESULTS -> "Результаты"
    DesktopScreen.HISTORY -> "История"
    DesktopScreen.SETTINGS -> "Настройки"
}

private fun modeLabel(mode: DesktopScanMode): String = when (mode) {
    DesktopScanMode.QUICK -> "Быстрая"
    DesktopScanMode.FULL -> "Глубокая"
    DesktopScanMode.SELECTIVE -> "Выборочная"
    DesktopScanMode.ARTIFACT -> "Файл"
}

private fun themeLabel(mode: ThemeMode): String = when (mode) {
    ThemeMode.SYSTEM -> "Как в системе"
    ThemeMode.LIGHT -> "Светлая"
    ThemeMode.DARK -> "Тёмная"
}

private fun chooseFile(): File? {
    val dialog = FileDialog(null as Frame?, "Выберите файл", FileDialog.LOAD)
    dialog.isVisible = true
    val directory = dialog.directory ?: return null
    val name = dialog.file ?: return null
    return File(directory, name)
}

private fun File.toArtifactKind(): DesktopArtifactKind {
    val lower = name.lowercase()
    return when {
        lower.endsWith(".exe") || lower.endsWith(".dll") || lower.endsWith(".msi") -> DesktopArtifactKind.EXECUTABLE
        lower.endsWith(".so") -> DesktopArtifactKind.LIBRARY
        lower.endsWith(".deb") || lower.endsWith(".rpm") || lower.endsWith(".pkg.tar.zst") || lower.endsWith(".appimage") -> DesktopArtifactKind.PACKAGE
        lower.endsWith(".sh") || lower.endsWith(".py") || lower.endsWith(".desktop") -> DesktopArtifactKind.SCRIPT
        lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".gz") || lower.endsWith(".7z") -> DesktopArtifactKind.ARCHIVE
        else -> DesktopArtifactKind.UNKNOWN
    }
}
