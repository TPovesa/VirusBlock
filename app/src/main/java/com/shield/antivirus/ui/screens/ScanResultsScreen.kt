package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateBottomPadding
import androidx.compose.foundation.layout.calculateTopPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.collectAsState
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

    LaunchedEffect(scanId) {
        viewModel.loadResult(scanId)
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = "Scan report",
            subtitle = "Local result #$scanId",
            onBack = onBack
        ) { padding ->
            val current = result
            if (current == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                return@ShieldScreenScaffold
            }

            val accent = if (current.threatsFound > 0) MaterialTheme.colorScheme.warningTone else MaterialTheme.colorScheme.safeTone
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
                            eyebrow = "Summary",
                            title = if (current.threatsFound == 0) "Device baseline is clean" else "Threats require manual action",
                            subtitle = "${current.totalScanned} packages checked during the ${current.scanType.lowercase()} scan."
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ShieldStatusChip(
                                label = if (current.threatsFound == 0) "CLEAN" else "${current.threatsFound} THREATS",
                                icon = if (current.threatsFound == 0) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                                color = accent
                            )
                            ShieldStatusChip(
                                label = formatResultsTime(current.completedAt),
                                icon = Icons.Filled.Security,
                                color = MaterialTheme.colorScheme.signalTone
                            )
                        }
                    }
                }

                if (current.threats.isEmpty()) {
                    item {
                        ShieldEmptyState(
                            icon = Icons.Filled.Security,
                            title = "No malicious packages detected",
                            subtitle = "Keep realtime protection enabled and re-run a quick sweep after installing new apps."
                        )
                    }
                } else {
                    item {
                        ShieldSectionHeader(
                            eyebrow = "Findings",
                            title = "Detected packages",
                            subtitle = "Review severity and uninstall suspicious apps from system settings if confirmed."
                        )
                    }
                    items(current.threats, key = { it.packageName + it.threatName }) { threat ->
                        ThreatCard(threat)
                    }
                    item {
                        ShieldPanel(accent = MaterialTheme.colorScheme.secondary) {
                            Text(
                                text = "Recommended next step",
                                style = MaterialTheme.typography.titleLarge,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Verify package source, remove side-loaded apps first, then rerun a full scan to confirm the device state.",
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
                label = threat.severity.name,
                icon = if (threat.severity == ThreatSeverity.CRITICAL) Icons.Filled.Error else Icons.Filled.Warning,
                color = accent
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
        Text(
            text = "${threat.detectionCount}/${threat.totalEngines} engines flagged this package via ${threat.detectionEngine}.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private fun formatResultsTime(timestamp: Long): String =
    SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault()).format(Date(timestamp))
