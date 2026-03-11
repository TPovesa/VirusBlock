package com.shield.antivirus.ui.screens

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.ui.theme.*
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

    LaunchedEffect(Unit) {
        viewModel.startScan(scanType)
    }

    LaunchedEffect(progress?.isComplete) {
        if (progress?.isComplete == true) {
            onScanComplete(progress!!.savedId)
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "scan")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2000, easing = LinearEasing)),
        label = "rotation"
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("$scanType Scan", fontWeight = FontWeight.Bold, color = TextPrimary) },
                navigationIcon = {
                    IconButton(onClick = {
                        viewModel.cancelScan()
                        onCancel()
                    }) {
                        Icon(Icons.Filled.Close, "Cancel", tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface)
            )
        },
        containerColor = DarkBg
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(24.dp))

            // Spinning shield
            Box(
                modifier = Modifier
                    .size(140.dp)
                    .rotate(rotation),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Filled.Security,
                    null,
                    tint = ShieldGreen,
                    modifier = Modifier.size(100.dp)
                )
            }

            Spacer(Modifier.height(24.dp))

            val p = progress
            if (p != null && p.totalCount > 0) {
                val pct = (p.scannedCount.toFloat() / p.totalCount.coerceAtLeast(1)) * 100
                Text("${pct.toInt()}%", fontSize = 36.sp, fontWeight = FontWeight.Bold, color = ShieldGreen)
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { pct / 100f },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    color = ShieldGreen,
                    trackColor = DarkCard
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "${p.scannedCount} / ${p.totalCount} apps scanned",
                    color = TextSecondary, fontSize = 13.sp
                )
                if (p.currentApp.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Checking: ${p.currentApp}",
                        color = TextSecondary, fontSize = 12.sp
                    )
                }

                if (p.threats.isNotEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    Card(
                        colors = CardDefaults.cardColors(containerColor = ShieldRed.copy(alpha = 0.1f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Warning, null, tint = ShieldRed, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("${p.threats.size} threat(s) detected so far", color = ShieldRed, fontWeight = FontWeight.Medium)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    LazyColumn(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(p.threats) { threat ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = DarkCard),
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.BugReport, null,
                                        tint = when(threat.severity) {
                                            ThreatSeverity.CRITICAL -> ShieldRed
                                            ThreatSeverity.HIGH -> ShieldOrange
                                            ThreatSeverity.MEDIUM -> ShieldYellow
                                            ThreatSeverity.LOW -> Color(0xFF90CAF9)
                                        },
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Column {
                                        Text(threat.appName, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                        Text(threat.threatName, color = ShieldRed, fontSize = 11.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                Text("Initializing scan...", color = TextSecondary, fontSize = 14.sp)
            }

            Spacer(Modifier.weight(1f))

            OutlinedButton(
                onClick = { viewModel.cancelScan(); onCancel() },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = ShieldRed),
                border = androidx.compose.foundation.BorderStroke(1.dp, ShieldRed.copy(alpha = 0.5f)),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Cancel Scan", fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
