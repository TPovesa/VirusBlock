package com.shield.antivirus.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularWavyProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.WavyProgressIndicatorDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.data.repository.ScanProgress
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldBlockingLoadingOverlay
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.ui.theme.warningTone
import com.shield.antivirus.viewmodel.ScanViewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ScanScreen(
    viewModel: ScanViewModel,
    scanType: String,
    selectedPackage: String? = null,
    apkUri: String? = null,
    onScanComplete: (Long) -> Unit,
    onCancel: () -> Unit
) {
    val progress by viewModel.progress.collectAsState()
    val guestLimitReached by viewModel.guestLimitReached.collectAsState()
    val actionLoading by viewModel.actionLoading.collectAsState()
    val keepRunningInBackground = scanType.uppercase() != "QUICK"

    LaunchedEffect(scanType, selectedPackage, apkUri) {
        viewModel.startScan(
            scanType = scanType,
            selectedPackages = selectedPackage?.let { listOf(it) }.orEmpty(),
            apkUri = apkUri
        )
    }

    LaunchedEffect(progress?.isComplete) {
        val current = progress
        if (current?.isComplete == true) {
            onScanComplete(current.savedId)
        }
    }

    val fraction = progressFraction(progress)
    val animatedProgress by animateFloatAsState(
        targetValue = fraction,
        animationSpec = spring(),
        label = "scanProgress"
    )
    val threatCount = progress?.threats?.size ?: 0
    val scanError = scanError(progress)
    val accent = when {
        scanError != null -> MaterialTheme.colorScheme.criticalTone
        threatCount > 0 -> MaterialTheme.colorScheme.warningTone
        else -> MaterialTheme.colorScheme.primary
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = scanTypeLabel(scanType),
            onBack = {
                if (!keepRunningInBackground) {
                    viewModel.cancelScan()
                }
                onCancel()
            }
        ) { padding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                if (guestLimitReached) {
                    item {
                        ShieldPanel(accent = MaterialTheme.colorScheme.warningTone) {
                            Text(
                                text = "Запуск в гостевом режиме заблокирован",
                                style = MaterialTheme.typography.titleLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "Войдите в аккаунт, чтобы запускать проверки.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    item {
                        Button(
                            onClick = onCancel,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.criticalTone),
                            shape = MaterialTheme.shapes.medium
                        ) {
                            Text("Назад")
                        }
                    }
                    return@LazyColumn
                }

                item {
                    ShieldPanel(accent = accent) {
                        ShieldSectionHeader(
                            eyebrow = "Проверка",
                            title = if (progress?.isComplete == true) "Готово" else "Идёт сканирование"
                        )
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            CircularWavyProgressIndicator(
                                progress = { animatedProgress.coerceIn(0f, 1f) },
                                modifier = Modifier.size(160.dp),
                                color = accent,
                                trackColor = MaterialTheme.colorScheme.surfaceVariant,
                                amplitude = WavyProgressIndicatorDefaults.indicatorAmplitude,
                                wavelength = WavyProgressIndicatorDefaults.CircularWavelength
                            )
                            Text(
                                text = "${(animatedProgress * 100).toInt()}%",
                                style = MaterialTheme.typography.displayMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        Text(
                            text = scanError ?: progressSummary(progress),
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (scanError != null) {
                                MaterialTheme.colorScheme.criticalTone
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            }
                        )
                        if (keepRunningInBackground) {
                            Text(
                                text = "Если выйти из приложения, глубокая проверка продолжится в уведомлении.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (!progress?.currentApp.isNullOrBlank()) {
                            Text(
                                text = "Сейчас: ${progress?.currentApp}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                if (threatCount > 0) {
                    item {
                        ShieldSectionHeader(
                            eyebrow = "Найдено",
                            title = "Подозрительные приложения"
                        )
                    }
                    itemsIndexed(
                        items = progress?.threats.orEmpty(),
                        key = { index, threat ->
                            "${threat.packageName}|${threat.threatName}|$index"
                        }
                    ) { _, threat ->
                        val threatColor = when (threat.severity) {
                            ThreatSeverity.CRITICAL -> MaterialTheme.colorScheme.criticalTone
                            ThreatSeverity.HIGH -> MaterialTheme.colorScheme.warningTone
                            ThreatSeverity.MEDIUM -> MaterialTheme.colorScheme.tertiary
                            ThreatSeverity.LOW -> MaterialTheme.colorScheme.signalTone
                        }
                        ShieldPanel(accent = threatColor) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = threat.appName,
                                    style = MaterialTheme.typography.titleLarge,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                ShieldStatusChip(
                                    label = null,
                                    icon = severityIcon(threat.severity),
                                    color = threatColor
                                )
                            }
                            Text(
                                text = threat.threatName,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = threat.packageName,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                item {
                    Button(
                        onClick = {
                            viewModel.cancelScan()
                            onCancel()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.criticalTone),
                        shape = MaterialTheme.shapes.medium
                    ) {
                        Icon(Icons.Filled.Close, contentDescription = null)
                        Text(if (keepRunningInBackground) "  Остановить глубокую проверку" else "  Остановить")
                    }
                }
                }

                ShieldBlockingLoadingOverlay(
                    visible = actionLoading && progress?.scannedCount == 0,
                    dimmed = true
                )
            }
        }
    }
}

private fun progressFraction(progress: ScanProgress?): Float {
    if (progress == null || progress.totalCount <= 0) return 0f
    return progress.scannedCount.toFloat() / progress.totalCount.toFloat()
}

private fun scanPhase(progress: ScanProgress?): String {
    if (progress == null) return "Подготовка"
    if (progress.isComplete) return "Результат сохранён"
    return when (progressFraction(progress)) {
        in 0f..0.15f -> "Сбор пакетов"
        in 0.15f..0.45f -> "Проверка хэшей"
        in 0.45f..0.75f -> "Анализ эвристики"
        else -> "Сохранение результата"
    }
}

private fun progressSummary(progress: ScanProgress?): String {
    if (progress == null) return "Запуск движка"
    return "${progress.scannedCount} из ${progress.totalCount.coerceAtLeast(0)}"
}

private fun scanError(progress: ScanProgress?): String? {
    val current = progress?.currentApp.orEmpty()
    if (current.startsWith("Глубокая проверка была прервана")) return current
    if (current.startsWith("Лимит")) return current
    if (current.startsWith("Режим")) return current
    if (current.startsWith("Выберите")) return current
    if (current.startsWith("Уже идёт")) return current
    if (current.contains("ошиб", ignoreCase = true)) return current
    if (current.contains("не является корректным APK", ignoreCase = true)) return current
    return null
}

private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
    "QUICK" -> "Быстрая проверка"
    "QUICK_BG", "BACKGROUND_QUICK" -> "Быстрая проверка (фон)"
    "FULL" -> "Глубокая проверка"
    "SELECTIVE" -> "Выборочная проверка"
    "APK" -> "Проверка APK"
    else -> scanType
}

private fun severityIcon(severity: ThreatSeverity) = when (severity) {
    ThreatSeverity.CRITICAL -> Icons.Filled.Error
    ThreatSeverity.HIGH -> Icons.Filled.Warning
    ThreatSeverity.MEDIUM -> Icons.Filled.BugReport
    ThreatSeverity.LOW -> Icons.Filled.Security
}
