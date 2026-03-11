package com.shield.antivirus.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.data.model.ScanResult
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldEmptyState
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.warningTone
import com.shield.antivirus.viewmodel.ScanViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class HistoryFilter {
    ALL,
    CLEAN,
    THREATS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    viewModel: ScanViewModel,
    onBack: () -> Unit,
    onViewResult: (Long) -> Unit
) {
    val results by viewModel.allResults.collectAsState()
    var showClearDialog by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(HistoryFilter.ALL) }

    val filteredResults = remember(results, filter) {
        when (filter) {
            HistoryFilter.ALL -> results
            HistoryFilter.CLEAN -> results.filter { it.threatsFound == 0 }
            HistoryFilter.THREATS -> results.filter { it.threatsFound > 0 }
        }
    }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("Очистить историю") },
            text = { Text("Удалить все локальные результаты?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.clearHistory()
                        showClearDialog = false
                    }
                ) {
                    Text("Удалить", color = MaterialTheme.colorScheme.criticalTone)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) {
                    Text("Отмена")
                }
            }
        )
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = "История",
            onBack = onBack,
            actions = {
                if (results.isNotEmpty()) {
                    IconButton(onClick = { showClearDialog = true }) {
                        Icon(Icons.Filled.Delete, contentDescription = "Очистить")
                    }
                }
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
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        HistoryFilter.values().forEach { option ->
                            FilterChip(
                                selected = filter == option,
                                onClick = { filter = option },
                                label = {
                                    Text(
                                        when (option) {
                                            HistoryFilter.ALL -> "Все"
                                            HistoryFilter.CLEAN -> "Чистые"
                                            HistoryFilter.THREATS -> "Угрозы"
                                        }
                                    )
                                }
                            )
                        }
                    }
                }

                if (filteredResults.isEmpty()) {
                    item {
                        ShieldEmptyState(
                            icon = Icons.Filled.Security,
                            title = if (results.isEmpty()) "История пуста" else "По фильтру ничего нет",
                            subtitle = if (results.isEmpty()) "Запустите проверку" else "Попробуйте другой фильтр"
                        )
                    }
                } else {
                    items(filteredResults, key = { it.id }) { result ->
                        HistoryCard(result = result, onClick = { onViewResult(result.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryCard(result: ScanResult, onClick: () -> Unit) {
    val accent = if (result.threatsFound > 0) MaterialTheme.colorScheme.warningTone else MaterialTheme.colorScheme.safeTone
    ShieldPanel(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        accent = accent
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = scanTypeLabel(result.scanType),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold
            )
            ShieldStatusChip(
                label = if (result.threatsFound > 0) "Угроз: ${result.threatsFound}" else "Чисто",
                icon = if (result.threatsFound > 0) Icons.Filled.Warning else Icons.Filled.Security,
                color = accent
            )
        }
        Text(
            text = "${result.totalScanned} пакетов",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = formatHistoryTime(result.completedAt),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private fun formatHistoryTime(timestamp: Long): String =
    SimpleDateFormat("dd MMM yyyy, HH:mm", Locale("ru")).format(Date(timestamp))

private fun scanTypeLabel(scanType: String): String = when (scanType.uppercase()) {
    "QUICK" -> "Быстрая проверка"
    "FULL" -> "Глубокая проверка"
    "SELECTIVE" -> "Выборочная проверка"
    else -> scanType
}
