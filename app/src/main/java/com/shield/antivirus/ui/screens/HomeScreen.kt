package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.ui.components.ShieldActionCard
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldMetricTile
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.runtime.collectAsState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onStartScan: (String) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val protectionScore = calculateProtectionScore(state)
    val statusColor = when {
        !state.isProtectionActive -> MaterialTheme.colorScheme.criticalTone
        state.totalThreatsEver > 0 -> MaterialTheme.colorScheme.warningTone
        else -> MaterialTheme.colorScheme.safeTone
    }
    val statusLabel = when {
        !state.isProtectionActive -> "Protection offline"
        state.totalThreatsEver > 0 -> "Threats require review"
        else -> "Protected locally"
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = "Shield Control",
            subtitle = state.userName.ifBlank { "Operator" },
            actions = {
                IconButton(onClick = onOpenHistory) {
                    Icon(Icons.Filled.History, contentDescription = "History")
                }
                IconButton(onClick = onOpenSettings) {
                    Icon(Icons.Filled.Settings, contentDescription = "Settings")
                }
            }
        ) { padding ->
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 8.dp,
                    bottom = 28.dp
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    ShieldPanel(accent = statusColor) {
                        ShieldSectionHeader(
                            eyebrow = "Security cockpit",
                            title = statusLabel,
                            subtitle = "Local-first scanning, encrypted auth, and cloud lookup only when confidence is low."
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ShieldStatusChip(
                                label = if (state.isProtectionActive) "REALTIME ON" else "REALTIME OFF",
                                icon = Icons.Filled.Security,
                                color = statusColor
                            )
                            ShieldStatusChip(
                                label = "SCORE $protectionScore",
                                icon = Icons.Filled.TrackChanges,
                                color = MaterialTheme.colorScheme.signalTone
                            )
                        }
                        Text(
                            text = protectionScore.toString(),
                            style = MaterialTheme.typography.displayLarge,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Last sweep ${formatTime(state.lastScanTime)}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
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
                            title = "Apps monitored",
                            value = state.installedAppsCount.toString(),
                            support = "User-installed packages in scope",
                            icon = Icons.Filled.Security,
                            accent = MaterialTheme.colorScheme.primary
                        )
                        ShieldMetricTile(
                            modifier = Modifier.weight(1f),
                            title = "Threats logged",
                            value = state.totalThreatsEver.toString(),
                            support = if (state.totalThreatsEver == 0) "No malicious hits recorded" else "Review results and remove flagged apps",
                            icon = Icons.Filled.BugReport,
                            accent = if (state.totalThreatsEver == 0) MaterialTheme.colorScheme.safeTone else MaterialTheme.colorScheme.warningTone
                        )
                    }
                }

                item {
                    ShieldMetricTile(
                        modifier = Modifier.fillMaxWidth(),
                        title = "Completed scans",
                        value = state.totalScans.toString(),
                        support = if (state.totalScans == 0) "Run the first sweep to establish a baseline" else "Historical results stay available offline",
                        icon = Icons.Filled.History,
                        accent = MaterialTheme.colorScheme.signalTone
                    )
                }

                item {
                    ShieldSectionHeader(
                        eyebrow = "Actions",
                        title = "Start a new sweep",
                        subtitle = "Choose the scan depth that matches the incident you are investigating."
                    )
                }

                item {
                    ShieldActionCard(
                        title = "Quick scan",
                        subtitle = "Prioritises recent user apps and finishes fast.",
                        meta = "30 most recent packages",
                        icon = Icons.Filled.FlashOn,
                        accent = MaterialTheme.colorScheme.primary,
                        onClick = { onStartScan("QUICK") }
                    )
                }
                item {
                    ShieldActionCard(
                        title = "Full scan",
                        subtitle = "Sweeps system and user packages for broad compromise detection.",
                        meta = "Full package inventory",
                        icon = Icons.Filled.Security,
                        accent = MaterialTheme.colorScheme.tertiary,
                        onClick = { onStartScan("FULL") }
                    )
                }
                item {
                    ShieldActionCard(
                        title = "Selective scan",
                        subtitle = "Use when you only need to inspect suspicious installs or side-loads.",
                        meta = "Focused package list",
                        icon = Icons.Filled.Tune,
                        accent = MaterialTheme.colorScheme.signalTone,
                        onClick = { onStartScan("SELECTIVE") }
                    )
                }

                item {
                    ShieldSectionHeader(
                        eyebrow = "Activity",
                        title = "Recent sweeps",
                        subtitle = if (state.recentResults.isEmpty()) {
                            "No completed scans yet."
                        } else {
                            "Latest results from the local scan database."
                        }
                    )
                }

                if (state.recentResults.isEmpty()) {
                    item {
                        ShieldPanel(accent = MaterialTheme.colorScheme.surfaceVariant) {
                            Text(
                                text = "No sweep history yet",
                                style = MaterialTheme.typography.titleLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "Run a quick scan to populate your security timeline.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                } else {
                    items(state.recentResults, key = { it.id }) { result ->
                        val accent = if (result.threatsFound > 0) MaterialTheme.colorScheme.warningTone else MaterialTheme.colorScheme.safeTone
                        ShieldPanel(accent = accent) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "${result.scanType} scan",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold
                                )
                                ShieldStatusChip(
                                    label = if (result.threatsFound > 0) "${result.threatsFound} THREATS" else "CLEAN",
                                    icon = if (result.threatsFound > 0) Icons.Filled.BugReport else Icons.Filled.Security,
                                    color = accent
                                )
                            }
                            Text(
                                text = "${result.totalScanned} packages checked on ${formatAbsoluteTime(result.completedAt)}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
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
    if (timestamp == 0L) return "has not completed yet"
    val delta = System.currentTimeMillis() - timestamp
    return when {
        delta < 60_000L -> "just now"
        delta < 3_600_000L -> "${delta / 60_000L} min ago"
        delta < 86_400_000L -> "${delta / 3_600_000L} h ago"
        else -> SimpleDateFormat("dd MMM", Locale.getDefault()).format(Date(timestamp))
    }
}

private fun formatAbsoluteTime(timestamp: Long): String =
    SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault()).format(Date(timestamp))
