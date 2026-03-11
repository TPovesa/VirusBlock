package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.data.model.ThreatInfo
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldEmptyState
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.ui.theme.warningTone
import com.shield.antivirus.viewmodel.ScanViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanResultsScreen(
    viewModel: ScanViewModel,
    scanId: Long,
    onBack: () -> Unit
) {
    val result by viewModel.currentResult.collectAsState()
    val isGuest by viewModel.isGuest.collectAsState()
    val explainState by viewModel.explainState.collectAsState()
    var showExplainSheet by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(scanId) {
        viewModel.loadResult(scanId)
    }

    ShieldBackdrop {
        if (showExplainSheet) {
            ModalBottomSheet(
                onDismissRequest = {
                    showExplainSheet = false
                    viewModel.clearExplanation()
                }
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp)
                ) {
                    when {
                        explainState.isLoading -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CircularProgressIndicator(strokeWidth = 2.dp)
                                Text(
                                    text = "Собираем объяснение по этому отчёту",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                        !explainState.error.isNullOrBlank() -> {
                            Text(
                                text = explainState.error.orEmpty(),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.criticalTone
                            )
                        }
                        !explainState.explanation.isNullOrBlank() -> {
                            Text(
                                text = explainState.explanation.orEmpty(),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }
            }
        }

        ShieldScreenScaffold(
            title = "Результат",
            subtitle = "Проверка #$scanId",
            onBack = onBack
        ) { padding ->
            val current = result
            if (current == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                return@ShieldScreenScaffold
            }

            val accent = if (current.threatsFound > 0) {
                MaterialTheme.colorScheme.warningTone
            } else {
                MaterialTheme.colorScheme.safeTone
            }

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
                            eyebrow = "Итог",
                            title = if (current.threatsFound == 0) "Угроз не найдено" else "Найдены угрозы",
                            subtitle = "${scanTypeLabel(current.scanType)} • ${current.totalScanned} пакетов"
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ShieldStatusChip(
                                label = if (current.threatsFound == 0) "Чисто" else "Угроз: ${current.threatsFound}",
                                icon = if (current.threatsFound == 0) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                                color = accent
                            )
                            ShieldStatusChip(
                                label = formatResultsTime(current.completedAt),
                                icon = Icons.Filled.Security,
                                color = MaterialTheme.colorScheme.signalTone
                            )
                        }
                        TextButton(
                            onClick = {
                                showExplainSheet = true
                                viewModel.explainCurrentResult()
                            },
                            modifier = Modifier.align(Alignment.End)
                        ) {
                            Text("Объяснить")
                        }
                    }
                }

                if (current.threats.isEmpty()) {
                    item {
                        ShieldEmptyState(
                            icon = Icons.Filled.Security,
                            title = "Всё чисто",
                            subtitle = if (isGuest) "Гостевая проверка завершена" else "Защита активна"
                        )
                    }
                } else {
                    item {
                        ShieldSectionHeader(
                            eyebrow = if (current.threats.any { !it.summary.isNullOrBlank() }) "Источники" else "Угрозы",
                            title = if (current.threats.any { !it.summary.isNullOrBlank() }) "Источники проверки" else "Список совпадений",
                            subtitle = if (current.threats.any { !it.summary.isNullOrBlank() }) {
                                "Сводка по каждому движку и этапу"
                            } else {
                                "Проверьте отмеченные приложения"
                            }
                        )
                    }
                    items(current.threats, key = { it.packageName + it.threatName }) { threat ->
                        ThreatCard(threat)
                    }
                }
            }
        }
    }
}

@Composable
private fun ThreatCard(threat: ThreatInfo) {
    val accent = when (threat.severity) {
        ThreatSeverity.CRITICAL -> MaterialTheme.colorScheme.criticalTone
        ThreatSeverity.HIGH -> MaterialTheme.colorScheme.warningTone
        ThreatSeverity.MEDIUM -> MaterialTheme.colorScheme.tertiary
        ThreatSeverity.LOW -> MaterialTheme.colorScheme.signalTone
    }
    ShieldPanel(accent = accent) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = threat.appName,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold
            )
            ShieldStatusChip(
                label = severityLabel(threat.severity),
                icon = if (threat.severity == ThreatSeverity.CRITICAL) Icons.Filled.Error else Icons.Filled.Warning,
                color = accent
            )
        }
        Text(
            text = threat.threatName,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
        if (!threat.summary.isNullOrBlank()) {
            Text(
                text = threat.summary.orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Text(
            text = threat.packageName,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = "${threat.detectionCount}/${threat.totalEngines} • ${threat.detectionEngine}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private fun formatResultsTime(timestamp: Long): String =
    SimpleDateFormat("dd MMM, HH:mm", Locale("ru")).format(Date(timestamp))

private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
    "QUICK" -> "Быстрая проверка"
    "FULL" -> "Глубокая проверка"
    "SELECTIVE" -> "Выборочная проверка"
    else -> scanType
}

private fun severityLabel(severity: ThreatSeverity): String = when (severity) {
    ThreatSeverity.CRITICAL -> "Критично"
    ThreatSeverity.HIGH -> "Высокая"
    ThreatSeverity.MEDIUM -> "Средняя"
    ThreatSeverity.LOW -> "Низкая"
}
