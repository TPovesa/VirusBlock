package com.shield.antivirus.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Report
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldBlockingLoadingOverlay
import com.shield.antivirus.ui.components.ShieldLoadingState
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldStatusChip
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
    onOpenLatestReport: (Long) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLogin: () -> Unit,
    onOpenRegister: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    ShieldBackdrop {
        val current = state
        if (sessionGateIsGuest && current == null) {
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
            onOpenLatestReport = onOpenLatestReport,
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
    onOpenLatestReport: (Long) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLogin: () -> Unit,
    onOpenRegister: () -> Unit,
    onExitGuestMode: () -> Unit
) {
    val context = LocalContext.current
    val isGuestMode = state.isGuest && !state.isLoggedIn
    val scanLocked = state.isScanActive
    val statusColor = when {
        state.lastScanThreatCount > 0 -> MaterialTheme.colorScheme.warningTone
        else -> MaterialTheme.colorScheme.safeTone
    }

    val fullLimitReached = !state.isDeveloperMode && state.fullScansToday >= 1
    val selectiveLimitReached = !state.isDeveloperMode && state.selectiveScansToday >= 3
    val apkLimitReached = !state.isDeveloperMode && state.apkScansToday >= 3

    var guestIntroLoading by rememberSaveable(isGuestMode) { mutableStateOf(isGuestMode) }
    var showAppPicker by rememberSaveable { mutableStateOf(false) }
    var modeMessage by rememberSaveable { mutableStateOf<String?>(null) }
    var actionOverlay by rememberSaveable { mutableStateOf(false) }

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

    LaunchedEffect(isGuestMode) {
        if (isGuestMode) {
            guestIntroLoading = true
            delay(1100)
            guestIntroLoading = false
        } else {
            guestIntroLoading = false
        }
    }

    ShieldScreenScaffold(
        title = "ShieldSecurity",
        subtitle = null,
        leadingContent = {
            IconButton(onClick = if (isGuestMode) onOpenLogin else onOpenHistory) {
                Icon(Icons.Filled.History, contentDescription = "История")
            }
        },
        actions = {
            IconButton(onClick = if (isGuestMode) onOpenLogin else onOpenSettings) {
                Icon(Icons.Filled.Settings, contentDescription = "Настройки")
            }
        }
    ) { padding ->
        if (isGuestMode && guestIntroLoading) {
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
                    actionOverlay = true
                    onStartScan("SELECTIVE", selected.packageName, null)
                }
            )
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
            item {
                ShieldPanel(accent = statusColor) {
                    Text(
                        text = if (state.lastScanThreatCount > 0) "Обнаружена угроза" else "Угроз не обнаружено",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.Bold
                    )
                    if (state.lastScanThreatCount > 0) {
                        val latestId = state.lastBackgroundScanResultId
                        Button(
                            onClick = {
                                if (latestId != null) {
                                    onOpenLatestReport(latestId)
                                }
                            },
                            enabled = latestId != null,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.warningTone),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Icon(Icons.Filled.Report, contentDescription = null)
                            Text("  Открыть отчёт")
                        }
                    }
                }
            }

            item {
                ShieldPanel(accent = MaterialTheme.colorScheme.signalTone) {
                    Text(
                        text = "Режимы",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 2.dp),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                }
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
                        Text(
                            text = if (activeIsDeep) "Идёт глубокая проверка" else "Идёт проверка",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = state.activeScanCurrentApp.ifBlank { "Анализ пакетов" },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
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
                    icon = Icons.Filled.Security,
                    accent = MaterialTheme.colorScheme.tertiary,
                    enabled = !scanLocked,
                        onAction = {
                            modeMessage = null
                            actionOverlay = true
                            when {
                                isGuestMode -> onOpenLogin()
                                scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "FULL" })
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
                        icon = Icons.Filled.FlashOn,
                        accent = MaterialTheme.colorScheme.primary,
                        enabled = !scanLocked,
                        onAction = {
                            modeMessage = null
                            actionOverlay = true
                            when {
                                scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "QUICK" })
                                else -> onStartScan("QUICK", null, null)
                            }
                        }
                    )
                    ModeGridCard(
                        modifier = Modifier.weight(1f),
                        title = "Выборочная",
                        icon = Icons.Filled.TrackChanges,
                        accent = MaterialTheme.colorScheme.signalTone,
                        enabled = !scanLocked,
                        onAction = {
                            modeMessage = null
                            actionOverlay = true
                            when {
                                isGuestMode -> onOpenLogin()
                                scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "SELECTIVE" })
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
                val apkCardEnabled = !scanLocked
                val apkCardContainerColor = if (apkCardEnabled) {
                    MaterialTheme.colorScheme.surfaceContainerHigh
                } else {
                    MaterialTheme.colorScheme.surfaceContainerHighest
                }
                val apkCardBorderColor = if (apkCardEnabled) {
                    MaterialTheme.colorScheme.signalTone.copy(alpha = 0.38f)
                } else {
                    MaterialTheme.colorScheme.outline.copy(alpha = 0.85f)
                }
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = apkCardContainerColor),
                    shape = MaterialTheme.shapes.large,
                    border = BorderStroke(1.dp, apkCardBorderColor)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 58.dp)
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Filled.UploadFile,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.signalTone
                            )
                            Text(
                                text = "Проверить APK",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        Button(
                            onClick = {
                                modeMessage = null
                                actionOverlay = true
                                when {
                                    isGuestMode -> onOpenLogin()
                                    scanLocked -> onOpenActiveScan(state.activeScanType.ifBlank { "APK" })
                                    apkLimitReached -> {
                                        modeMessage = "Дневной лимит: проверка APK доступна 3 раза в сутки"
                                    }
                                    else -> apkPicker.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream", "*/*"))
                                }
                            },
                            colors = ShieldPrimaryButtonColors(
                                if (!isGuestMode && !apkLimitReached && apkCardEnabled) {
                                    MaterialTheme.colorScheme.signalTone
                                } else {
                                    MaterialTheme.colorScheme.outline
                                }
                            ),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Text(if (isGuestMode) "Войти" else "Выбрать")
                        }
                    }
                }
            }

            if (isGuestMode) {
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
            }

            LaunchedEffect(actionOverlay, state.isScanActive) {
                if (actionOverlay && state.isScanActive) {
                    delay(220)
                    actionOverlay = false
                }
            }
            LaunchedEffect(actionOverlay) {
                if (actionOverlay) {
                    delay(650)
                    actionOverlay = false
                }
            }

            ShieldBlockingLoadingOverlay(
                visible = actionOverlay,
                dimmed = true
            )
        }
    }
}

@Composable
private fun ModeWideCard(
    title: String,
    icon: ImageVector,
    accent: Color,
    enabled: Boolean,
    onAction: () -> Unit
) {
    val contentColor = if (enabled) accent else MaterialTheme.colorScheme.onSurfaceVariant
    val containerColor = if (enabled) {
        MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.95f)
    } else {
        MaterialTheme.colorScheme.surfaceContainerHighest
    }
    val borderColor = if (enabled) {
        accent.copy(alpha = 0.48f)
    } else {
        MaterialTheme.colorScheme.outline.copy(alpha = 0.92f)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, borderColor)
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
                    color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Bold
                )
            }
            IconButton(
                onClick = onAction,
                enabled = enabled,
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(
                        if (enabled) accent.copy(alpha = 0.18f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)
                    )
            ) {
                Icon(
                    imageVector = Icons.Filled.PlayArrow,
                    contentDescription = "Запуск",
                    tint = if (enabled) accent else MaterialTheme.colorScheme.outline,
                    modifier = Modifier.size(34.dp)
                )
            }
        }
    }
}

@Composable
private fun ModeGridCard(
    title: String,
    icon: ImageVector,
    accent: Color,
    enabled: Boolean,
    onAction: () -> Unit,
    modifier: Modifier = Modifier
) {
    val contentColor = if (enabled) accent else MaterialTheme.colorScheme.onSurfaceVariant
    val containerColor = if (enabled) {
        MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.95f)
    } else {
        MaterialTheme.colorScheme.surfaceContainerHighest
    }
    val borderColor = if (enabled) {
        accent.copy(alpha = 0.48f)
    } else {
        MaterialTheme.colorScheme.outline.copy(alpha = 0.92f)
    }

    Card(
        modifier = modifier.heightIn(min = 166.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, borderColor)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(18.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
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
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                fontWeight = FontWeight.Bold
            )
            Box(
                modifier = Modifier
                    .padding(top = 10.dp)
                    .size(66.dp)
                    .clip(CircleShape)
                    .background(if (enabled) accent.copy(alpha = 0.16f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center
            ) {
                IconButton(
                    onClick = onAction,
                    enabled = enabled,
                    modifier = Modifier
                        .size(54.dp)
                        .clip(CircleShape)
                        .background(if (enabled) accent.copy(alpha = 0.22f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.16f))
                ) {
                    Icon(
                        imageVector = Icons.Filled.PlayArrow,
                        contentDescription = "Запуск",
                        tint = if (enabled) accent else MaterialTheme.colorScheme.outline,
                        modifier = Modifier.size(36.dp)
                    )
                }
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
    val context = LocalContext.current
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
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(MaterialTheme.shapes.medium)
                                .clickable { onSelected(app) }
                                .padding(vertical = 10.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            val iconBitmap = remember(app.packageName) {
                                runCatching {
                                    context.packageManager
                                        .getApplicationIcon(app.packageName)
                                        .toBitmap(48, 48)
                                        .asImageBitmap()
                                }.getOrNull()
                            }
                            if (iconBitmap != null) {
                                Image(
                                    bitmap = iconBitmap,
                                    contentDescription = null,
                                    modifier = Modifier.size(28.dp)
                                )
                            } else {
                                Icon(
                                    imageVector = Icons.Filled.Description,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
