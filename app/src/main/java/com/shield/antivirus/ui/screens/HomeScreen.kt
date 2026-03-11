package com.shield.antivirus.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shield.antivirus.ui.theme.*
import com.shield.antivirus.viewmodel.HomeViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onStartScan: (String) -> Unit,
    onOpenHistory: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Shield Antivirus", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 18.sp)
                        Text("Hello, ${state.userName.ifEmpty { "User" }}", fontSize = 12.sp, color = TextSecondary)
                    }
                },
                actions = {
                    IconButton(onClick = onOpenHistory) {
                        Icon(Icons.Filled.History, "History", tint = TextSecondary)
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, "Settings", tint = TextSecondary)
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
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Protection Status Circle
            ProtectionStatusCard(
                isActive = state.isProtectionActive,
                lastScanTime = state.lastScanTime
            )

            // Stats Row
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Apps Installed",
                    value = state.installedAppsCount.toString(),
                    icon = Icons.Filled.Apps,
                    color = ShieldGreen
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Threats Found",
                    value = state.totalThreatsEver.toString(),
                    icon = Icons.Filled.BugReport,
                    color = if (state.totalThreatsEver > 0) ShieldRed else ShieldGreen
                )
            }

            // Scan Buttons
            Text("Run a Scan", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = TextPrimary)

            ScanTypeButton(
                title = "⚡ Quick Scan",
                subtitle = "Scans user-installed apps (~30 most recent)",
                color = ShieldGreen,
                onClick = { onStartScan("QUICK") }
            )
            ScanTypeButton(
                title = "🔍 Full Scan",
                subtitle = "Scans all apps including system apps",
                color = ShieldOrange,
                onClick = { onStartScan("FULL") }
            )
            ScanTypeButton(
                title = "🎯 Selective Scan",
                subtitle = "Choose which apps to scan",
                color = Color(0xFF7B61FF),
                onClick = { onStartScan("SELECTIVE") }
            )

            // Recent History
            if (state.recentResults.isNotEmpty()) {
                Text("Recent Scans", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = TextPrimary)
                state.recentResults.take(3).forEach { result ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = DarkCard),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(
                            Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Filled.Shield,
                                null,
                                tint = if (result.threatsFound > 0) ShieldRed else ShieldGreen,
                                modifier = Modifier.size(32.dp)
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("${result.scanType} Scan", fontWeight = FontWeight.Medium, color = TextPrimary, fontSize = 14.sp)
                                Text(
                                    formatTime(result.completedAt),
                                    fontSize = 12.sp, color = TextSecondary
                                )
                            }
                            Text(
                                if (result.threatsFound > 0) "${result.threatsFound} threats" else "Clean",
                                color = if (result.threatsFound > 0) ShieldRed else ShieldGreen,
                                fontSize = 13.sp, fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ProtectionStatusCard(isActive: Boolean, lastScanTime: Long) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = DarkCard),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .clip(CircleShape)
                    .background(
                        if (isActive) ShieldGreen.copy(alpha = 0.15f)
                        else ShieldRed.copy(alpha = 0.15f)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Filled.Security,
                    null,
                    tint = if (isActive) ShieldGreen else ShieldRed,
                    modifier = Modifier.size(60.dp)
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(
                if (isActive) "Protected" else "Unprotected",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = if (isActive) ShieldGreen else ShieldRed
            )
            Text(
                if (isActive) "Real-time protection is active" else "Enable protection in Settings",
                fontSize = 13.sp,
                color = TextSecondary
            )
            if (lastScanTime > 0) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Last scan: ${formatTime(lastScanTime)}",
                    fontSize = 12.sp, color = TextSecondary
                )
            }
        }
    }
}

@Composable
private fun StatCard(
    modifier: Modifier,
    label: String,
    value: String,
    icon: ImageVector,
    color: Color
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = DarkCard),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = color, modifier = Modifier.size(28.dp))
            Spacer(Modifier.height(8.dp))
            Text(value, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = color)
            Text(label, fontSize = 12.sp, color = TextSecondary)
        }
    }
}

@Composable
private fun ScanTypeButton(title: String, subtitle: String, color: Color, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.1f)),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.3f))
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Filled.PlayArrow, null, tint = color, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 15.sp)
                Text(subtitle, fontSize = 12.sp, color = TextSecondary)
            }
            Icon(Icons.Filled.ChevronRight, null, tint = color.copy(alpha = 0.6f))
        }
    }
}

private fun formatTime(millis: Long): String {
    if (millis == 0L) return "Never"
    return SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault()).format(Date(millis))
}
