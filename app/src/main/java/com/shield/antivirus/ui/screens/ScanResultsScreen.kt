package com.shield.antivirus.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shield.antivirus.data.model.ThreatInfo
import com.shield.antivirus.data.model.ThreatSeverity
import com.shield.antivirus.ui.theme.*
import com.shield.antivirus.viewmodel.ScanViewModel
import java.text.SimpleDateFormat
import java.util.*

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

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scan Results", fontWeight = FontWeight.Bold, color = TextPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, null, tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface)
            )
        },
        containerColor = DarkBg
    ) { padding ->
        result?.let { r ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Summary Card
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = if (r.threatsFound == 0) ShieldGreen.copy(alpha = 0.1f)
                            else ShieldRed.copy(alpha = 0.1f)
                        ),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Column(
                            Modifier.padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(
                                if (r.threatsFound == 0) Icons.Filled.CheckCircle else Icons.Filled.Cancel,
                                null,
                                tint = if (r.threatsFound == 0) ShieldGreen else ShieldRed,
                                modifier = Modifier.size(64.dp)
                            )
                            Spacer(Modifier.height(12.dp))
                            Text(
                                if (r.threatsFound == 0) "Device is Clean!" else "${r.threatsFound} Threat(s) Found",
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (r.threatsFound == 0) ShieldGreen else ShieldRed
                            )
                            Text(
                                "${r.totalScanned} apps scanned • ${r.scanType} Scan",
                                fontSize = 13.sp, color = TextSecondary
                            )
                            Text(
                                SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())
                                    .format(Date(r.completedAt)),
                                fontSize = 12.sp, color = TextSecondary
                            )
                        }
                    }
                }

                if (r.threats.isEmpty()) {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = DarkCard),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Shield, null, tint = ShieldGreen, modifier = Modifier.size(32.dp))
                                Spacer(Modifier.width(16.dp))
                                Column {
                                    Text("All Clear!", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                                    Text("No malware detected on your device.", fontSize = 13.sp, color = TextSecondary)
                                }
                            }
                        }
                    }
                } else {
                    item {
                        Text("Detected Threats", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = TextPrimary)
                    }
                    items(r.threats) { threat ->
                        ThreatCard(threat)
                    }
                }
            }
        } ?: Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = ShieldGreen)
        }
    }
}

@Composable
private fun ThreatCard(threat: ThreatInfo) {
    val sevColor = when (threat.severity) {
        ThreatSeverity.CRITICAL -> ShieldRed
        ThreatSeverity.HIGH -> ShieldOrange
        ThreatSeverity.MEDIUM -> ShieldYellow
        ThreatSeverity.LOW -> Color(0xFF90CAF9)
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = DarkCard),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(sevColor)
                )
                Spacer(Modifier.width(8.dp))
                Text(threat.severity.name, color = sevColor, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            Text(threat.appName, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 15.sp)
            Text(threat.packageName, fontSize = 11.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Divider(color = DarkCardAlt)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Threat", fontSize = 11.sp, color = TextSecondary)
                    Text(threat.threatName, color = ShieldRed, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("Engines", fontSize = 11.sp, color = TextSecondary)
                    Text("${threat.detectionCount}/${threat.totalEngines}", color = ShieldOrange, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {},
                    modifier = Modifier.weight(1f).height(40.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = ShieldRed),
                    border = androidx.compose.foundation.BorderStroke(1.dp, ShieldRed.copy(alpha = 0.5f)),
                    shape = RoundedCornerShape(8.dp)
                ) { Text("Uninstall", fontSize = 13.sp) }
                OutlinedButton(
                    onClick = {},
                    modifier = Modifier.weight(1f).height(40.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF2A3D5E)),
                    shape = RoundedCornerShape(8.dp)
                ) { Text("Ignore", fontSize = 13.sp) }
            }
        }
    }
}
