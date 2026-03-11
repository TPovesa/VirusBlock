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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.data.repository.ScanProgress
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.ui.theme.warningTone
import com.shield.antivirus.viewmodel.ScanViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    viewModel: ScanViewModel,
    scanType: String,
    onScanComplete: (Long) -> Unit,
    onCancel: () -> Unit
) {
    val progress by viewModel.progress.collectAsState()

    LaunchedEffect(scanType) {
        viewModel.startScan(scanType)
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
    val accent = if (threatCount > 0) MaterialTheme.colorScheme.warningTone else MaterialTheme.colorScheme.primary

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = scanTypeLabel(scanType),
            subtitle = scanPhase(progress),
            onBack = {
                viewModel.cancelScan()
                onCancel()
            }
        ) { padding ->
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    ShieldPanel(accent = accent) {
                        ShieldSectionHeader(
                            eyebrow = "Проверка",
                            title = if (progress?.isComplete == true) "Готово" else "Идёт сканирование",
                            subtitle = scanPhase(progress)
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ShieldStatusChip(
                                label = "${(animatedProgress * 100).toInt()}%",
                                icon = Icons.Filled.TrackChanges,
                                color = MaterialTheme.colorScheme.signalTone
                            )
                            ShieldStatusChip(
                                label = if (threatCount > 0) "Угроз: $threatCount" else "Совпадений нет",
                                icon = if (threatCount > 0) Icons.Filled.Warning else Icons.Filled.Security,
                                color = if (threatCount > 0) MaterialTheme.colorScheme.warningTone else MaterialTheme.colorScheme.safeTone
                            )
                        }
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(
                                progress = { animatedProgress.coerceIn(0f, 1f) },
                                modifier = Modifier.size(160.dp),
                                color = accent,
                                strokeWidth = 14.dp,
                                trackColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                            Text(
                                text = "${(animatedProgress * 100).toInt()}%",
                                style = MaterialTheme.typography.displayMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        Text(
                            text = progressSummary(progress),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface
                        )
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
                            title = "Подозрительные приложения",
                            subtitle = "Текущие совпадения"
                        )
                    }
                    items(progress?.threats.orEmpty(), key = { it.packageName + it.threatName }) { threat ->
                        val threatColor = when (threat.severity) {
                            ThreatSeverity.CRITICAL -> MaterialTheme.colorScheme.criticalTone
                            ThreatSeverity.HIGH -> MaterialTheme.colorScheme.warningTone
                            ThreatSeverity.MEDIUM -> MaterialTheme.colorScheme.tertiary
                            ThreatSeverity.LOW -> MaterialTheme.colorScheme.signalTone
                        }
                        ShieldPanel(accent = threatColor) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = threat.appName,
                                    style = MaterialTheme.typography.titleLarge,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold
                                )
                                ShieldStatusChip(
                                    label = severityLabel(threat.severity),
                                    icon = Icons.Filled.BugReport,
                                    color = threatColor
                                )
                            }
                            Text(
                                text = threat.threatName,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "${threat.detectionCount}/${threat.totalEngines} • ${threat.packageName}",
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
                        Text("  Остановить")
                    }
                }
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

private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
    "QUICK" -> "Быстрая проверка"
    "FULL" -> "Полная проверка"
    "SELECTIVE" -> "Выборочная проверка"
    else -> scanType
}

private fun severityLabel(severity: ThreatSeverity): String = when (severity) {
    ThreatSeverity.CRITICAL -> "Критично"
    ThreatSeverity.HIGH -> "Высокая"
    ThreatSeverity.MEDIUM -> "Средняя"
    ThreatSeverity.LOW -> "Низкая"
}
