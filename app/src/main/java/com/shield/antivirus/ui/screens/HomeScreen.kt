package com.shield.antivirus.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.R
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldLoadingState
import com.shield.antivirus.ui.components.ShieldMetricTile
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.ui.theme.warningTone
import com.shield.antivirus.viewmodel.HomeInstalledApp
import com.shield.antivirus.viewmodel.HomeUiState
import com.shield.antivirus.viewmodel.HomeViewModel
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipInputStream

@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    sessionGateIsGuest: Boolean,
    onStartScan: (scanType: String, selectedPackage: String?, apkUri: String?) -> Unit,
    onOpenActiveScan: (String) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLogin: () -> Unit,
    onOpenRegister: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    ShieldBackdrop {
        val current = state
        if (sessionGateIsGuest && (current == null || !current.isGuest)) {
            ShieldLoadingState(
                title = "Готовим режим гостя",
                subtitle = "Применяем ограничения доступа",
                modifier = Modifier.fillMaxSize()
            )
            return@ShieldBackdrop
        }

        if (current == null) {
            ShieldLoadingState(
                title = "Загружаем защиту",
                subtitle = "Проверяем состояние сессии",
                modifier = Modifier.fillMaxSize()
            )
            return@ShieldBackdrop
        }

        HomeContent(
            state = current,
            onStartScan = onStartScan,
            onOpenActiveScan = onOpenActiveScan,
            onOpenHistory = onOpenHistory,
            onOpenSettings = onOpenSettings,
            onOpenLogin = onOpenLogin,
            onOpenRegister = onOpenRegister,
            onExitGuestMode = { viewModel.exitGuestMode() }
        )
    }
}

@Composable
private fun HomeContent(
    state: HomeUiState,
    onStartScan: (scanType: String, selectedPackage: String?, apkUri: String?) -> Unit,
    onOpenActiveScan: (String) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLogin: () -> Unit,
    onOpenRegister: () -> Unit,
    onExitGuestMode: () -> Unit
) {
    val context = LocalContext.current
    val scanLocked = state.isScanActive
    val protectionScore = calculateProtectionScore(state)
    val statusColor = when {
        state.isGuest -> MaterialTheme.colorScheme.signalTone
        !state.isProtectionActive -> MaterialTheme.colorScheme.criticalTone
        state.totalThreatsEver > 0 -> MaterialTheme.colorScheme.warningTone
        else -> MaterialTheme.colorScheme.safeTone
    }

    val fullLimitReached = state.fullScansToday >= 1
    val selectiveLimitReached = state.selectiveScansToday >= 3
    val apkLimitReached = state.apkScansToday >= 3

    var guestIntroLoading by rememberSaveable(state.isGuest) { mutableStateOf(state.isGuest) }
    var showAppPicker by rememberSaveable { mutableStateOf(false) }
    var modeMessage by rememberSaveable { mutableStateOf<String?>(null) }

    val apkPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            modeMessage = "Файл не выбран"
        } else {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
            if (!isValidApkSelection(context, uri)) {
                modeMessage = "Выбранный файл не похож на корректный APK."
                return@rememberLauncherForActivityResult
            }
            onStartScan("APK", null, uri.toString())
        }
    }

    LaunchedEffect(state.isGuest) {
        if (state.isGuest) {
            guestIntroLoading = true
            delay(1100)
            guestIntroLoading = false
        } else {
            guestIntroLoading = false
        }
    }

    ShieldScreenScaffold(
        title = "ShieldSecurity",
        subtitle = when {
            state.isGuest -> "Гостевой режим"
            state.userName.isBlank() -> null
            else -> state.userName
        },
        actions = {
            IconButton(onClick = if (state.isGuest) onOpenLogin else onOpenHistory) {
                Icon(Icons.Filled.History, contentDescription = "История")
            }
            IconButton(onClick = if (state.isGuest) onOpenLogin else onOpenSettings) {
                Icon(Icons.Filled.Settings, contentDescription = "Настройки")
            }
        }
    ) { padding ->
        if (state.isGuest && guestIntroLoading) {
            ShieldLoadingState(
                title = "Готовим режим гостя",
                subtitle = "Применяем ограничения доступа",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            )
            return@ShieldScreenScaffold
        }

        if (showAppPicker) {
            SelectInstalledAppDialog(
                apps = state.installedApps,
                onDismiss = { showAppPicker = false },
                onSelected = { selected ->
                    showAppPicker = false
                    onStartScan("SELECTIVE", selected.packageName, null)
                }
            )
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    Card(
                        modifier = Modifier.size(186.dp),
                        shape = CircleShape,
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f)
                        )
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.radialGradient(
                                        colors = listOf(
                                            MaterialTheme.colorScheme.primary.copy(alpha = 0.23f),
                                            MaterialTheme.colorScheme.secondary.copy(alpha = 0.14f),
                                            MaterialTheme.colorScheme.surface.copy(alpha = 0.05f)
                                        )
                                    )
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Image(
                                painter = painterResource(id = R.drawable.shield_logo_transparent),
                                contentDescription = null,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(24.dp),
                                contentScale = ContentScale.Fit
                            )
                        }
                    }
                }
            }

            item {
                ShieldPanel(accent = statusColor) {
                    ShieldSectionHeader(
                        eyebrow = if (state.isGuest) "Гость" else "Статус",
                        title = when {
                            state.isGuest -> "Только просмотр"
                            !state.isProtectionActive -> "Защита выключена"
                            state.totalThreatsEver > 0 -> "Нужна проверка"
                            else -> "Устройство защищено"
                        },
                        subtitle = when {
                            state.isGuest -> "Все проверки заблокированы до входа"
                            else -> "Последняя проверка ${formatTime(state.lastScanTime)}"
                        }
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ShieldStatusChip(
                            label = when {
                                state.isGuest -> "Запуск заблокирован"
                                state.isProtectionActive -> "24/7 включена"
                                else -> "24/7 выключена"
                            },
                            icon = if (state.isGuest) Icons.Filled.FlashOn else Icons.Filled.Security,
                            color = statusColor
                        )
                        ShieldStatusChip(
                            label = if (state.isGuest) "Без истории" else "Индекс $protectionScore",
                            icon = if (state.isGuest) Icons.Filled.Security else Icons.Filled.BugReport,
                            color = if (state.isGuest) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.signalTone
                        )
                    }
                    Text(
                        text = if (state.isGuest) "—" else protectionScore.toString(),
                        style = MaterialTheme.typography.displayLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    ShieldMetricTile(
                        modifier = Modifier.weight(1f),
                        title = "Приложений",
                        value = state.installedAppsCount.toString(),
                        support = "В пуле сканирования",
                        icon = Icons.Filled.Security,
                        accent = MaterialTheme.colorScheme.primary
                    )
                    ShieldMetricTile(
                        modifier = Modifier.weight(1f),
                        title = "Угроз",
                        value = state.totalThreatsEver.toString(),
                        support = if (state.totalThreatsEver == 0) "Пока чисто" else "Есть совпадения",
                        icon = Icons.Filled.BugReport,
                        accent = if (state.totalThreatsEver == 0) {
                            MaterialTheme.colorScheme.safeTone
                        } else {
                            MaterialTheme.colorScheme.warningTone
                        }
                    )
                }
            }

            item {
                ShieldSectionHeader(
                    eyebrow = "Режимы",
                    title = "Сканирование",
                    subtitle = when {
                        scanLocked -> "Идёт проверка. Новая недоступна"
                        state.isGuest -> "Запуск проверок доступен после входа"
                        else -> "Глубокая, быстрая, выборочная и APK"
                    }
                )
            }

            modeMessage?.let { message ->
                item {
                    ShieldPanel(accent = MaterialTheme.colorScheme.warningTone) {
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }

            if (scanLocked) {
                item {
                    val activeIsDeep = state.activeScanType.equals("FULL", ignoreCase = true) ||
                        state.activeScanType.equals("SELECTIVE", ignoreCase = true) ||
                        state.activeScanType.equals("APK", ignoreCase = true)
                    ShieldPanel(accent = MaterialTheme.colorScheme.signalTone) {
                        ShieldSectionHeader(
                            eyebrow = "Текущая проверка",
                            title = if (activeIsDeep) "Идёт глубокая проверка" else "Идёт фоновая проверка",
                            subtitle = state.activeScanCurrentApp.ifBlank { "Анализ пакетов" }
                        )
                        ShieldStatusChip(
                            label = "${state.activeScanProgress.coerceIn(0, 100)}%",
                            icon = Icons.Filled.TrackChanges,
                            color = MaterialTheme.colorScheme.signalTone
                        )
                        Button(
                            onClick = { onOpenActiveScan(state.activeScanType.ifBlank { "FULL" }) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.signalTone),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Text("Посмотреть текущую проверку")
                        }
                    }
                }
            }

            item {
                ModeWideCard(
                    title = "Глубокая",
                    subtitle = when {
                        state.isGuest -> "Недоступно в гостевом режиме"
                        fullLimitReached -> "Лимит сегодня исчерпан (1/1)"
                        else -> "Сервер + локально • осталось ${1 - state.fullScansToday}"
                    },
                    icon = Icons.Filled.Security,
                    accent = MaterialTheme.colorScheme.tertiary,
                    enabled = !state.isGuest && !fullLimitReached && !scanLocked,
                    actionLabel = if (state.isGuest) "Войти" else if (fullLimitReached) "Лимит" else "Старт",
                    onAction = {
                        modeMessage = null
                        when {
                            scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "FULL" })
                            state.isGuest -> onOpenLogin()
                            fullLimitReached -> modeMessage = "Дневной лимит: глубокая проверка доступна 1 раз в сутки"
                            else -> onStartScan("FULL", null, null)
                        }
                    }
                )
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    ModeGridCard(
                        modifier = Modifier.weight(1f),
                        title = "Быстрая",
                        subtitle = if (state.isGuest) "Нужен вход" else "Локальная проверка",
                        icon = Icons.Filled.FlashOn,
                        accent = MaterialTheme.colorScheme.primary,
                        enabled = !state.isGuest && !scanLocked,
                        actionLabel = if (state.isGuest) "Войти" else "Старт",
                        onAction = {
                            modeMessage = null
                            when {
                                scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "QUICK" })
                                state.isGuest -> onOpenLogin()
                                else -> onStartScan("QUICK", null, null)
                            }
                        }
                    )
                    ModeGridCard(
                        modifier = Modifier.weight(1f),
                        title = "Выборочная",
                        subtitle = when {
                            state.isGuest -> "Нужен вход"
                            selectiveLimitReached -> "Лимит 3/3"
                            else -> "Осталось ${3 - state.selectiveScansToday}"
                        },
                        icon = Icons.Filled.TrackChanges,
                        accent = MaterialTheme.colorScheme.signalTone,
                        enabled = !state.isGuest && !selectiveLimitReached && !scanLocked,
                        actionLabel = if (state.isGuest) "Войти" else "Выбрать",
                        onAction = {
                            modeMessage = null
                            when {
                                scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "SELECTIVE" })
                                state.isGuest -> onOpenLogin()
                                selectiveLimitReached -> {
                                    modeMessage = "Дневной лимит: выборочная проверка доступна 3 раза в сутки"
                                }
                                state.installedApps.isEmpty() -> {
                                    modeMessage = "Не удалось получить список установленных приложений"
                                }
                                else -> {
                                    showAppPicker = true
                                }
                            }
                        }
                    )
                }
            }

            item {
                ShieldPanel(accent = MaterialTheme.colorScheme.signalTone) {
                    ShieldSectionHeader(
                        eyebrow = "Файл",
                        title = "Проверить APK",
                        subtitle = when {
                            state.isGuest -> "Только для авторизованных пользователей"
                            apkLimitReached -> "Лимит сегодня исчерпан (3/3)"
                            else -> "Осталось ${3 - state.apkScansToday} запуска"
                        }
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        ShieldStatusChip(
                            label = "Серверный анализ",
                            icon = Icons.Filled.UploadFile,
                            color = MaterialTheme.colorScheme.signalTone
                        )
                        Button(
                            onClick = {
                                modeMessage = null
                                when {
                                    scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "APK" })
                                    state.isGuest -> onOpenLogin()
                                    apkLimitReached -> {
                                        modeMessage = "Дневной лимит: проверка APK доступна 3 раза в сутки"
                                    }
                                    else -> apkPicker.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream", "*/*"))
                                }
                            },
                            colors = ShieldPrimaryButtonColors(
                                if (!state.isGuest && !apkLimitReached && !scanLocked) {
                                    MaterialTheme.colorScheme.signalTone
                                } else {
                                    MaterialTheme.colorScheme.outline
                                }
                            ),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Text(if (state.isGuest) "Войти" else "Выбрать")
                        }
                    }
                }
            }

            if (state.isGuest) {
                item {
                    ShieldPanel(accent = MaterialTheme.colorScheme.secondary) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            TextButton(onClick = onOpenLogin) {
                                Text("Войти")
                            }
                            TextButton(onClick = onOpenRegister) {
                                Text("Регистрация")
                            }
                        }
                    }
                }
            }

            if (state.isGuest && state.isLoggedIn) {
                item {
                    ShieldPanel(accent = MaterialTheme.colorScheme.tertiary) {
                        Text(
                            text = "Тестовый гостевой режим активен",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Button(
                            onClick = onExitGuestMode,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.tertiary),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Text("Вернуться в аккаунт")
                        }
                    }
                }
            }

            item {
                ShieldSectionHeader(
                    eyebrow = "История",
                    title = "Последние проверки",
                    subtitle = if (state.recentResults.isEmpty()) "Пока пусто" else "Свежие результаты"
                )
            }

            if (state.isGuest) {
                item {
                    ShieldPanel(accent = MaterialTheme.colorScheme.outline) {
                        Text(
                            text = "История доступна после входа",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Структура экрана сохранена, но просмотр отчётов заблокирован в гостевом режиме.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(
                            onClick = onOpenLogin,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.signalTone),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Text("Войти")
                        }
                    }
                }
            } else if (state.recentResults.isEmpty()) {
                item {
                    ShieldPanel(accent = MaterialTheme.colorScheme.surfaceVariant) {
                        Text(
                            text = "История пуста",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Запустите быструю, глубокую или выборочную проверку",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                items(state.recentResults, key = { it.id }) { result ->
                    val accent = if (result.threatsFound > 0) {
                        MaterialTheme.colorScheme.warningTone
                    } else {
                        MaterialTheme.colorScheme.safeTone
                    }
                    ShieldPanel(accent = accent) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = scanTypeLabel(result.scanType),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.Bold
                            )
                            ShieldStatusChip(
                                label = if (result.threatsFound > 0) "Угроз: ${result.threatsFound}" else "Чисто",
                                icon = if (result.threatsFound > 0) Icons.Filled.BugReport else Icons.Filled.Security,
                                color = accent
                            )
                        }
                        Text(
                            text = "${result.totalScanned} пакетов • ${formatAbsoluteTime(result.completedAt)}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ModeWideCard(
    title: String,
    subtitle: String,
    icon: ImageVector,
    accent: Color,
    enabled: Boolean,
    actionLabel: String,
    onAction: () -> Unit
) {
    val contentColor = if (enabled) accent else MaterialTheme.colorScheme.outline
    val containerColor = if (enabled) {
        accent.copy(alpha = 0.12f)
    } else {
        MaterialTheme.colorScheme.surface.copy(alpha = 0.86f)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        shape = MaterialTheme.shapes.large
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(contentColor.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = contentColor)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Button(
                onClick = onAction,
                colors = ShieldPrimaryButtonColors(if (enabled) accent else MaterialTheme.colorScheme.outline),
                shape = MaterialTheme.shapes.medium
            ) {
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun ModeGridCard(
    title: String,
    subtitle: String,
    icon: ImageVector,
    accent: Color,
    enabled: Boolean,
    actionLabel: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier
) {
    val contentColor = if (enabled) accent else MaterialTheme.colorScheme.outline
    val containerColor = if (enabled) {
        accent.copy(alpha = 0.10f)
    } else {
        MaterialTheme.colorScheme.surface.copy(alpha = 0.82f)
    }

    Card(
        modifier = modifier.aspectRatio(1f),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        shape = MaterialTheme.shapes.large
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(contentColor.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = contentColor)
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.weight(1f))
            Button(
                onClick = onAction,
                modifier = Modifier.fillMaxWidth(),
                colors = ShieldPrimaryButtonColors(if (enabled) accent else MaterialTheme.colorScheme.outline),
                shape = MaterialTheme.shapes.medium
            ) {
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun SelectInstalledAppDialog(
    apps: List<HomeInstalledApp>,
    onDismiss: () -> Unit,
    onSelected: (HomeInstalledApp) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Выбор приложения") },
        text = {
            if (apps.isEmpty()) {
                Text(
                    text = "Список приложений пуст",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 360.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(apps, key = { it.packageName }) { app ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(MaterialTheme.shapes.medium)
                                .clickable { onSelected(app) }
                                .padding(vertical = 10.dp, horizontal = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(
                                text = app.appName,
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                text = app.packageName,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Закрыть")
            }
        },
        icon = { Icon(Icons.Filled.Description, contentDescription = null) }
    )
}

private fun calculateProtectionScore(state: HomeUiState): Int {
    var score = 44
    if (state.isProtectionActive) score += 28 else score -= 18
    if (state.lastScanTime > System.currentTimeMillis() - 86_400_000L) score += 18
    if (state.totalThreatsEver == 0) score += 10 else score -= (state.totalThreatsEver * 4).coerceAtMost(28)
    if (state.totalScans > 2) score += 6
    return score.coerceIn(7, 99)
}

private fun formatTime(timestamp: Long): String {
    if (timestamp == 0L) return "ещё не запускалась"
    val delta = System.currentTimeMillis() - timestamp
    return when {
        delta < 60_000L -> "только что"
        delta < 3_600_000L -> "${delta / 60_000L} мин назад"
        delta < 86_400_000L -> "${delta / 3_600_000L} ч назад"
        else -> SimpleDateFormat("dd MMM, HH:mm", Locale("ru")).format(Date(timestamp))
    }
}

private fun formatAbsoluteTime(timestamp: Long): String =
    SimpleDateFormat("dd MMM, HH:mm", Locale("ru")).format(Date(timestamp))

private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
    "QUICK" -> "Быстрая"
    "FULL" -> "Глубокая"
    "SELECTIVE" -> "Выборочная"
    "APK" -> "Проверка APK"
    else -> scanType
}

private fun isValidApkSelection(context: Context, uri: Uri): Boolean {
    return runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            ZipInputStream(input).use { zip ->
                var hasManifest = false
                var hasDex = false
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (entry.name == "AndroidManifest.xml") hasManifest = true
                    if (entry.name == "classes.dex") hasDex = true
                    if (hasManifest && hasDex) break
                }
                hasManifest && hasDex
            }
        } ?: false
    }.getOrDefault(false)
}
