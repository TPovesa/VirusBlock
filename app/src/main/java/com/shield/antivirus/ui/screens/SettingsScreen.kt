package com.shield.antivirus.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.BuildConfig
import com.shield.antivirus.data.datastore.ThemeMode
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.util.AppLogger
import com.shield.antivirus.viewmodel.AuthViewModel
import kotlinx.coroutines.launch
import java.io.File

@Composable
fun SettingsScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val userName by viewModel.userName.collectAsState()
    val userEmail by viewModel.userEmail.collectAsState()
    val realtimeProtection by viewModel.realtimeProtection.collectAsState()
    val scanOnInstall by viewModel.scanOnInstall.collectAsState()
    val themeMode by viewModel.themeMode.collectAsState()
    val dynamicColorsEnabled by viewModel.dynamicColorsEnabled.collectAsState()
    val isDeveloperMode by viewModel.isDeveloperMode.collectAsState()

    var showLogoutDialog by remember { mutableStateOf(false) }
    var showDevMenuDialog by remember { mutableStateOf(false) }
    var devKeyInput by remember { mutableStateOf("") }
    var devKeyError by remember { mutableStateOf<String?>(null) }
    var versionTapCount by rememberSaveable { mutableIntStateOf(0) }
    var isDevMenuUnlocked by rememberSaveable { mutableStateOf(false) }
    var exportInProgress by rememberSaveable { mutableStateOf(false) }
    var pendingLogZip by remember { mutableStateOf<File?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val exportLogsLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/zip")
    ) { uri ->
        val zip = pendingLogZip
        if (uri == null || zip == null || !zip.exists()) {
            pendingLogZip = null
            exportInProgress = false
            return@rememberLauncherForActivityResult
        }
        runCatching {
            context.contentResolver.openOutputStream(uri)?.use { output ->
                zip.inputStream().use { input -> input.copyTo(output) }
            } ?: error("Не удалось открыть файл для записи")
        }.onSuccess {
            Toast.makeText(context, "Логи сохранены", Toast.LENGTH_SHORT).show()
        }.onFailure {
            Toast.makeText(context, "Ошибка экспорта логов: ${it.message}", Toast.LENGTH_LONG).show()
        }
        pendingLogZip = null
        exportInProgress = false
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Выйти") },
            text = { Text("Очистить сессию и вернуться на экран входа?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLogoutDialog = false
                        onLogout()
                    }
                ) {
                    Text("Выйти", color = MaterialTheme.colorScheme.criticalTone)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text("Отмена")
                }
            }
        )
    }

    if (showDevMenuDialog) {
        AlertDialog(
            onDismissRequest = { showDevMenuDialog = false },
            title = { Text("Меню разработчика") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = if (isDeveloperMode) {
                            "Режим разработчика активирован."
                        } else {
                            "Введите ключ разработки для активации."
                        },
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = devKeyInput,
                        onValueChange = {
                            devKeyInput = it
                            devKeyError = null
                        },
                        label = { Text("Ключ разработки") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        isError = devKeyError != null
                    )
                    if (devKeyError != null) {
                        Text(
                            text = devKeyError ?: "",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Button(
                        onClick = {
                            viewModel.activateDeveloperMode(devKeyInput) { success ->
                                if (success) {
                                    devKeyError = null
                                    devKeyInput = ""
                                    Toast
                                        .makeText(context, "Режим разработчика активирован", Toast.LENGTH_SHORT)
                                        .show()
                                } else {
                                    devKeyError = "Неверный ключ разработки"
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Активировать разработку")
                    }
                    Button(
                        onClick = {
                            viewModel.deactivateDeveloperMode()
                            Toast.makeText(context, "Режим разработчика отключён", Toast.LENGTH_SHORT).show()
                        },
                        enabled = isDeveloperMode,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Отписаться от разработки")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showDevMenuDialog = false }) {
                    Text("Закрыть")
                }
            }
        )
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = "Настройки",
            onBack = onBack
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                ShieldPanel(accent = MaterialTheme.colorScheme.primary) {
                    SettingsInfoRow(icon = Icons.Filled.Person, label = "Имя", value = userName.ifBlank { "Не указано" })
                    SettingsInfoRow(icon = Icons.Filled.Email, label = "Почта", value = userEmail.ifBlank { "Не указана" })
                    SettingsVersionRow(
                        version = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                        onClick = {
                            if (isDeveloperMode || isDevMenuUnlocked) {
                                showDevMenuDialog = true
                                return@SettingsVersionRow
                            }

                            versionTapCount += 1
                            if (versionTapCount >= DEV_TAP_HINT_START) {
                                val remaining = (DEV_TAP_TARGET - versionTapCount).coerceAtLeast(0)
                                if (remaining > 0) {
                                    Toast.makeText(
                                        context,
                                        "До разработчика осталось $remaining кликов",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } else {
                                    isDevMenuUnlocked = true
                                    showDevMenuDialog = true
                                    Toast.makeText(context, "Вы разработчик!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    )
                    if (isDeveloperMode) {
                        Button(
                            onClick = {
                                if (exportInProgress) return@Button
                                exportInProgress = true
                                scope.launch {
                                    try {
                                        val file = AppLogger.exportLogsSnapshot()
                                        if (file == null) {
                                            exportInProgress = false
                                            Toast.makeText(
                                                context,
                                                "Логи пока не найдены",
                                                Toast.LENGTH_SHORT
                                            ).show()
                                        } else {
                                            pendingLogZip = file
                                            exportLogsLauncher.launch(file.name)
                                        }
                                    } catch (error: Exception) {
                                        exportInProgress = false
                                        Toast.makeText(
                                            context,
                                            "Ошибка подготовки логов: ${error.message}",
                                            Toast.LENGTH_LONG
                                        ).show()
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !exportInProgress
                        ) {
                            Text(if (exportInProgress) "Подготовка логов..." else "Экспорт логов")
                        }
                    }
                }

                ShieldPanel(accent = MaterialTheme.colorScheme.primary) {
                    Text(
                        text = "Оформление",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    ThemeModeSelector(
                        selected = themeMode,
                        onSelect = viewModel::setThemeMode
                    )
                    SettingsToggleRow(
                        icon = Icons.Filled.Tune,
                        title = "Dynamic colors",
                        subtitle = "Использовать цвета системы на Android 12+",
                        checked = dynamicColorsEnabled,
                        onToggle = viewModel::setDynamicColorsEnabled
                    )
                }

                ShieldPanel(accent = MaterialTheme.colorScheme.primary) {
                    SettingsToggleRow(
                        icon = Icons.Filled.Security,
                        title = "Фоновая защита",
                        subtitle = "Работает только для авторизованного пользователя",
                        checked = realtimeProtection,
                        onToggle = viewModel::setRealtimeProtection
                    )
                    SettingsToggleRow(
                        icon = Icons.Filled.Tune,
                        title = "Проверка после установки",
                        subtitle = "Автоматически сканировать новые приложения",
                        checked = scanOnInstall,
                        onToggle = viewModel::setScanOnInstall
                    )
                }

                if (isDeveloperMode) {
                    ShieldPanel(accent = MaterialTheme.colorScheme.tertiary) {
                        Text(
                            text = "Инструменты разработчика",
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Вход в гостевой режим без полного logout и очистки токена/пользователя.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(
                            onClick = {
                                viewModel.enterGuestModeForDeveloper {
                                    onBack()
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Войти в гостевой режим для разработчика")
                        }
                    }
                }

                Button(
                    onClick = { showLogoutDialog = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
                    colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.criticalTone),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Icon(Icons.Filled.ExitToApp, contentDescription = null)
                    Text("  Выйти")
                }
            }
        }
    }
}

@Composable
private fun ThemeModeSelector(
    selected: ThemeMode,
    onSelect: (ThemeMode) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ThemeModeOption(
            title = "Системная",
            selected = selected == ThemeMode.SYSTEM,
            onClick = { onSelect(ThemeMode.SYSTEM) }
        )
        ThemeModeOption(
            title = "Светлая",
            selected = selected == ThemeMode.LIGHT,
            onClick = { onSelect(ThemeMode.LIGHT) }
        )
        ThemeModeOption(
            title = "Тёмная",
            selected = selected == ThemeMode.DARK,
            onClick = { onSelect(ThemeMode.DARK) }
        )
    }
}

@Composable
private fun ThemeModeOption(
    title: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick
        )
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

@Composable
private fun SettingsVersionRow(
    version: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Filled.Tune, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column {
                Text("Версия", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Text(version, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SettingsInfoRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column {
                Text(label, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SettingsToggleRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onToggle: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
                uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant
            )
        )
    }
}

private const val DEV_TAP_TARGET = 10
private const val DEV_TAP_HINT_START = 5
