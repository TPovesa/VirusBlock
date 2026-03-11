package com.shield.antivirus.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateBottomPadding
import androidx.compose.foundation.layout.calculateTopPadding
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.collectAsState
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
        label = "scan-progress"
    )
    val threatCount = progress?.threats?.size ?: 0
    val accent = when {
        threatCount > 0 -> MaterialTheme.colorScheme.warningTone
        else -> MaterialTheme.colorScheme.primary
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = "$scanType scan",
            subtitle = scanPhase(progress),
            onBack = {
                viewModel.cancelScan()
                onCancel()
            }
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = padding.calculateTopPadding() + 8.dp,
                    bottom = padding.calculateBottomPadding() + 24.dp
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    ShieldPanel(accent = accent) {
                        ShieldSectionHeader(
                            eyebrow = "Runtime",
                            title = if (progress?.isComplete == true) "Sweep complete" else "Scanning now",
                            subtitle = scanPhase(progress)
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ShieldStatusChip(
                                label = "${(animatedProgress * 100).toInt()}%",
                                icon = Icons.Filled.TrackChanges,
                                color = MaterialTheme.colorScheme.signalTone
                            )
                            ShieldStatusChip(
                                label = if (threatCount > 0) "$threatCount THREATS" else "NO HITS",
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
                                text = "Current package: ${progress?.currentApp}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                if (threatCount > 0) {
                    item {
                        ShieldSectionHeader(
                            eyebrow = "Detections",
                            title = "Suspicious packages",
                            subtitle = "Current findings before the final report is saved."
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
                                    label = threat.severity.name,
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
                                text = "${threat.detectionCount}/${threat.totalEngines} engines • ${threat.packageName}",
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
                        Text("  Cancel scan")
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
    if (progress == null) return "Preparing package inventory"
    if (progress.isComplete) return "All packages checked and local results saved"
    return when (progressFraction(progress)) {
        in 0f..0.15f -> "Collecting packages and warm-starting heuristics"
        in 0.15f..0.45f -> "Hashing APKs and matching local signatures"
        in 0.45f..0.75f -> "Evaluating heuristics and suspicious permissions"
        else -> "Finalising results and persisting the report"
    }
}

private fun progressSummary(progress: ScanProgress?): String {
    if (progress == null) return "Initializing scan engine"
    return "${progress.scannedCount} of ${progress.totalCount.coerceAtLeast(0)} packages checked"
}
