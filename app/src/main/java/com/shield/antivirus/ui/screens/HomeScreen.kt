package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldLoadingState
import com.shield.antivirus.ui.components.ShieldMetricTile
import com.shield.antivirus.ui.components.ShieldModeCard
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.ui.theme.warningTone
import com.shield.antivirus.viewmodel.HomeUiState
import com.shield.antivirus.viewmodel.HomeViewModel
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onStartScan: (String) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLogin: () -> Unit,
    onOpenRegister: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    ShieldBackdrop {
        val current = state
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
            onOpenHistory = onOpenHistory,
            onOpenSettings = onOpenSettings,
            onOpenLogin = onOpenLogin,
            onOpenRegister = onOpenRegister
        )
    }
}

@Composable
private fun HomeContent(
    state: HomeUiState,
    onStartScan: (String) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLogin: () -> Unit,
    onOpenRegister: () -> Unit
) {
    val protectionScore = calculateProtectionScore(state)
    val statusColor = when {
        state.isGuest -> MaterialTheme.colorScheme.signalTone
        !state.isProtectionActive -> MaterialTheme.colorScheme.criticalTone
        state.totalThreatsEver > 0 -> MaterialTheme.colorScheme.warningTone
        else -> MaterialTheme.colorScheme.safeTone
    }

    var guestIntroLoading by rememberSaveable(state.isGuest) { mutableStateOf(state.isGuest) }
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
            if (!state.isGuest) {
                IconButton(onClick = onOpenHistory) {
                    Icon(Icons.Filled.History, contentDescription = "История")
                }
                IconButton(onClick = onOpenSettings) {
                    Icon(Icons.Filled.Settings, contentDescription = "Настройки")
                }
            }
        }
    ) { padding ->
        if (state.isGuest && guestIntroLoading) {
            ShieldLoadingState(
                title = "Готовим режим гостя",
                subtitle = "Поднимаем одноразовую проверку",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            )
            return@ShieldScreenScaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (state.isGuest) {
                item {
                    ShieldPanel(accent = statusColor) {
                        ShieldSectionHeader(
                            eyebrow = "Гость",
                            title = if (state.guestScanUsed) "Лимит исчерпан" else "Одна проверка",
                            subtitle = if (state.guestScanUsed) "Чтобы продолжить, нужен аккаунт" else "Сейчас доступна только быстрая проверка"
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ShieldStatusChip(
                                label = if (state.guestScanUsed) "Лимит исчерпан" else "1 запуск",
                                icon = Icons.Filled.FlashOn,
                                color = statusColor
                            )
                            ShieldStatusChip(
                                label = "Без истории",
                                icon = Icons.Filled.Security,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                }
                item {
                    ShieldModeCard(
                        title = "Быстрая проверка",
                        subtitle = if (state.guestScanUsed) "Этот запуск уже израсходован" else "Базовая локальная проверка приложений",
                        icon = Icons.Filled.FlashOn,
                        accent = MaterialTheme.colorScheme.primary,
                        enabled = !state.guestScanUsed,
                        actionLabel = if (state.guestScanUsed) "Войти" else "Старт",
                        onAction = {
                            if (state.guestScanUsed) onOpenLogin() else onStartScan("QUICK")
                        },
                        meta = if (state.guestScanUsed) "Требуется аккаунт" else "Доступно сейчас"
                    )
                }
                item {
                    ShieldModeCard(
                        title = "Глубокая проверка",
                        subtitle = "Серверная сверка и расширенные правила",
                        icon = Icons.Filled.Security,
                        accent = MaterialTheme.colorScheme.tertiary,
                        enabled = false,
                        actionLabel = "Войти",
                        onAction = onOpenLogin,
                        meta = "Только для аккаунта"
                    )
                }
                item {
                    ShieldModeCard(
                        title = "Выборочная проверка",
                        subtitle = "Ручной режим с историей и сохранением отчётов",
                        icon = Icons.Filled.Tune,
                        accent = MaterialTheme.colorScheme.signalTone,
                        enabled = false,
                        actionLabel = "Войти",
                        onAction = onOpenLogin,
                        meta = "Только для аккаунта"
                    )
                }
                if (state.guestScanUsed) {
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
                return@LazyColumn
            }

            item {
                ShieldPanel(accent = statusColor) {
                    ShieldSectionHeader(
                        eyebrow = "Статус",
                        title = when {
                            !state.isProtectionActive -> "Защита выключена"
                            state.totalThreatsEver > 0 -> "Нужна проверка"
                            else -> "Устройство защищено"
                        },
                        subtitle = "Последняя проверка ${formatTime(state.lastScanTime)}"
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ShieldStatusChip(
                            label = if (state.isProtectionActive) "24/7 включена" else "24/7 выключена",
                            icon = Icons.Filled.Security,
                            color = statusColor
                        )
                        ShieldStatusChip(
                            label = "Индекс $protectionScore",
                            icon = Icons.Filled.BugReport,
                            color = MaterialTheme.colorScheme.signalTone
                        )
                    }
                    Text(
                        text = protectionScore.toString(),
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
                    title = "Проверка",
                    subtitle = "Выберите нужный режим"
                )
            }
            item {
                ShieldModeCard(
                    title = "Быстрая проверка",
                    subtitle = "Локальная экспресс-проверка",
                    icon = Icons.Filled.FlashOn,
                    accent = MaterialTheme.colorScheme.primary,
                    enabled = true,
                    actionLabel = "Старт",
                    onAction = { onStartScan("QUICK") },
                    meta = "Локально"
                )
            }
            item {
                ShieldModeCard(
                    title = "Глубокая проверка",
                    subtitle = "Сервер, облачные сверки и расширенные правила",
                    icon = Icons.Filled.Security,
                    accent = MaterialTheme.colorScheme.tertiary,
                    enabled = true,
                    actionLabel = "Старт",
                    onAction = { onStartScan("FULL") },
                    meta = "Сервер + локально"
                )
            }
            item {
                ShieldModeCard(
                    title = "Выборочная проверка",
                    subtitle = "Проверка выбранных приложений",
                    icon = Icons.Filled.Tune,
                    accent = MaterialTheme.colorScheme.signalTone,
                    enabled = true,
                    actionLabel = "Старт",
                    onAction = { onStartScan("SELECTIVE") },
                    meta = "Ручной режим"
                )
            }

            item {
                ShieldSectionHeader(
                    eyebrow = "История",
                    title = "Последние проверки",
                    subtitle = if (state.recentResults.isEmpty()) "Пока пусто" else "Последние результаты"
                )
            }

            if (state.recentResults.isEmpty()) {
                item {
                    ShieldPanel(accent = MaterialTheme.colorScheme.surfaceVariant) {
                        Text(
                            text = "История пуста",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Запустите быструю или глубокую проверку",
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
    "QUICK" -> "Быстрая проверка"
    "FULL" -> "Глубокая проверка"
    "SELECTIVE" -> "Выборочная проверка"
    else -> scanType
}
