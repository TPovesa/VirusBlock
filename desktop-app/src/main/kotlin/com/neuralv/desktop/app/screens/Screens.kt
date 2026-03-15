package com.neuralv.desktop.app.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.neuralv.desktop.app.components.NeuralVBrandBadge
import com.neuralv.desktop.app.components.NeuralVPanel
import com.neuralv.desktop.app.components.PrimaryAction
import com.neuralv.desktop.app.state.AuthTab
import com.neuralv.desktop.app.state.DesktopUiState
import com.neuralv.desktop.app.theme.DesktopThemeMode
import com.neuralv.desktop.core.model.DesktopArtifactKind
import com.neuralv.desktop.core.model.DesktopPlatform
import com.neuralv.desktop.core.model.DesktopScanMode
import com.neuralv.desktop.core.model.ReleaseArtifact

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WelcomeScreen(
    state: DesktopUiState,
    onChoosePlatform: (DesktopPlatform) -> Unit,
    onLogin: () -> Unit,
    onRegister: () -> Unit
) {
    val releases = state.releaseArtifacts.groupBy { it.platform.lowercase() }
    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        NeuralVBrandBadge()
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("NeuralV", style = MaterialTheme.typography.displayMedium)
            Text(
                "Единая защитная платформа для Android, Windows и Linux с серверным triage и общей авторизацией.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DesktopPlatform.entries.forEach { platform ->
                AssistChip(
                    onClick = { onChoosePlatform(platform) },
                    label = { Text(if (platform == state.selectedPlatform) "${platform.label()} выбрано" else platform.label()) },
                    leadingIcon = { Icon(Icons.Default.Computer, null) },
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = if (platform == state.selectedPlatform) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                        labelColor = if (platform == state.selectedPlatform) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface
                    )
                )
            }
        }
        NeuralVPanel {
            Text("Latest artifacts", style = MaterialTheme.typography.titleLarge)
            releases.entries.sortedBy { it.key }.forEach { (platform, artifacts) ->
                ReleaseSection(platform = platform, artifacts = artifacts)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = onLogin) { Text("Войти") }
            PrimaryAction(text = "Создать аккаунт", onClick = onRegister, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
fun AuthScreen(
    state: DesktopUiState,
    onStartAuth: (String, String, String, AuthTab) -> Unit,
    onVerify: (String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    val selectedTab = state.pendingAuthMode

    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        NeuralVBrandBadge()
        Text("Авторизация", style = MaterialTheme.typography.displayMedium)
        NeuralVPanel(modifier = Modifier.fillMaxWidth().heightIn(max = 720.dp)) {
            TabRow(selectedTabIndex = when (selectedTab) {
                AuthTab.LOGIN -> 0
                AuthTab.REGISTER -> 1
                AuthTab.VERIFY -> 2
            }) {
                listOf("Вход", "Регистрация", "Код").forEachIndexed { index, label ->
                    Tab(selected = index == when (selectedTab) {
                        AuthTab.LOGIN -> 0
                        AuthTab.REGISTER -> 1
                        AuthTab.VERIFY -> 2
                    }, onClick = {}) {
                        Text(label, modifier = Modifier.padding(vertical = 14.dp))
                    }
                }
            }
            when (selectedTab) {
                AuthTab.LOGIN, AuthTab.REGISTER -> {
                    if (selectedTab == AuthTab.REGISTER) {
                        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Имя") }, modifier = Modifier.fillMaxWidth())
                    }
                    OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Пароль") }, modifier = Modifier.fillMaxWidth())
                    PrimaryAction(
                        text = if (selectedTab == AuthTab.REGISTER) "Получить код" else "Продолжить",
                        onClick = { onStartAuth(name, email, password, selectedTab) }
                    )
                }
                AuthTab.VERIFY -> {
                    Text(state.authNotice ?: "Введите код из письма", style = MaterialTheme.typography.bodyLarge)
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it },
                        label = { Text("Код") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )
                    PrimaryAction(text = "Подтвердить", onClick = { onVerify(code) })
                }
            }
            state.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    state: DesktopUiState,
    onNavigateHistory: () -> Unit,
    onNavigateSettings: () -> Unit,
    onStartScan: (DesktopScanMode) -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        NeuralVPanel {
            Text("NeuralV ${state.selectedPlatform.label()}", style = MaterialTheme.typography.displayMedium)
            Text("Сессия: ${state.session?.user?.email ?: "offline"}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionCard("Быстрый обзор", "Hash + telemetry + AI triage", onClick = { onStartScan(DesktopScanMode.QUICK) })
                ActionCard("Глубокая проверка", "Локальные сигналы + серверные stages", onClick = { onStartScan(DesktopScanMode.FULL) })
                ActionCard("Выборочная", "Один артефакт или путь", onClick = { onStartScan(DesktopScanMode.SELECTIVE) })
                ActionCard("Артефакт", "EXE / ELF / AppImage / script upload", onClick = { onStartScan(DesktopScanMode.ARTIFACT) })
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            MiniNavCard("История", Icons.Default.History, onNavigateHistory)
            MiniNavCard("Настройки", Icons.Default.Settings, onNavigateSettings)
            state.releaseArtifacts.firstOrNull { it.platform.equals(state.selectedPlatform.name, true) }?.let {
                MiniNavCard("Скачать", Icons.Default.CloudDownload) {}
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ScanScreen(
    state: DesktopUiState,
    onStartMode: (DesktopScanMode, DesktopArtifactKind) -> Unit,
    onUploadArtifact: () -> Unit,
    onCancel: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        NeuralVPanel {
            Text("Режимы проверки", style = MaterialTheme.typography.displayMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ActionCard("Quick", "Telemetry-first", onClick = { onStartMode(DesktopScanMode.QUICK, DesktopArtifactKind.EXECUTABLE) })
                ActionCard("Full", "Server orchestration", onClick = { onStartMode(DesktopScanMode.FULL, DesktopArtifactKind.EXECUTABLE) })
                ActionCard("Selective", "Focus on one target", onClick = { onStartMode(DesktopScanMode.SELECTIVE, DesktopArtifactKind.EXECUTABLE) })
                ActionCard("Artifact", "Upload binary", onClick = onUploadArtifact)
            }
            state.activeScan?.let { scan ->
                Text("Текущая проверка: ${scan.summary.status}")
                TextButton(onClick = onCancel) { Text("Отменить") }
            }
        }
    }
}

@Composable
fun ResultsScreen(state: DesktopUiState, onRefresh: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        NeuralVPanel {
            Text("Последний отчёт", style = MaterialTheme.typography.displayMedium)
            val result = state.activeScan
            if (result == null) {
                Text("Отчёт пока не загружен")
            } else {
                Text("${result.summary.mode.name} • ${result.summary.status}")
                Text("Показано угроз: ${result.summary.surfacedFindings}")
                result.findings.forEach { finding ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(finding.title, fontWeight = FontWeight.Bold)
                            Text(finding.summary)
                            if (finding.evidence.isNotEmpty()) {
                                Text(finding.evidence.joinToString(" • "), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                PrimaryAction(text = "Обновить статус", onClick = onRefresh)
            }
        }
    }
}

@Composable
fun HistoryScreen(state: DesktopUiState) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        NeuralVPanel {
            Text("История", style = MaterialTheme.typography.displayMedium)
            if (state.scanHistory.isEmpty()) {
                Text("Локальная история пока пуста")
            } else {
                state.scanHistory.forEach { scan ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(scan.summary.mode.name, fontWeight = FontWeight.Bold)
                            Text(scan.summary.status)
                            Text(scan.summary.message ?: "Без дополнительного сообщения", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    state: DesktopUiState,
    onBackendUpdate: (String) -> Unit,
    onThemeChange: (DesktopThemeMode) -> Unit,
    onDynamicPaletteToggle: (Boolean) -> Unit,
    onLogout: () -> Unit
) {
    var backendUrl by remember(state.backendBaseUrl) { mutableStateOf(state.backendBaseUrl) }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        NeuralVPanel {
            Text("Настройки", style = MaterialTheme.typography.displayMedium)
            OutlinedTextField(value = backendUrl, onValueChange = { backendUrl = it }, label = { Text("Backend URL") }, modifier = Modifier.fillMaxWidth())
            PrimaryAction(text = "Применить backend", onClick = { onBackendUpdate(backendUrl) })
            Text("Palette source: ${state.wallpaperSource}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                DesktopThemeMode.entries.forEach { mode ->
                    AssistChip(
                        onClick = { onThemeChange(mode) },
                        label = { Text(mode.name) },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = if (state.themeMode == mode) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
                        )
                    )
                }
            }
            TextButton(onClick = { onDynamicPaletteToggle(!state.useDynamicPalette) }) {
                Text(if (state.useDynamicPalette) "Отключить динамическую палитру" else "Включить динамическую палитру")
            }
            TextButton(onClick = onLogout) { Text("Выйти") }
        }
    }
}

@Composable
private fun ActionCard(title: String, subtitle: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.24f))
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun MiniNavCard(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Card(modifier = Modifier.clickable(onClick = onClick), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null)
            Text(title)
        }
    }
}

@Composable
private fun ReleaseSection(platform: String, artifacts: List<ReleaseArtifact>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(platform.replaceFirstChar { it.uppercase() }, fontWeight = FontWeight.Bold)
        artifacts.forEach { artifact ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${artifact.channel} • ${artifact.version}")
                    Text(
                        artifact.downloadUrl ?: artifact.installCommand.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    artifact.installCommand?.let { Text(it, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold) }
                }
            }
        }
    }
}

private fun DesktopPlatform.label(): String = when (this) {
    DesktopPlatform.WINDOWS -> "Windows"
    DesktopPlatform.LINUX -> "Linux"
}
