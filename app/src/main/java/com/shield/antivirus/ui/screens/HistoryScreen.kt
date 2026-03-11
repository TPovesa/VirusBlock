package com.shield.antivirus.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shield.antivirus.ui.theme.*
import com.shield.antivirus.viewmodel.ScanViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    viewModel: ScanViewModel,
    onBack: () -> Unit,
    onViewResult: (Long) -> Unit
) {
    val results by viewModel.allResults.collectAsState()
    var showClearDialog by remember { mutableStateOf(false) }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("Clear History") },
            text = { Text("Delete all scan history? This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = { viewModel.clearHistory(); showClearDialog = false }) {
                    Text("Delete", color = ShieldRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) {
                    Text("Cancel")
                }
            },
            containerColor = DarkCard
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scan History", fontWeight = FontWeight.Bold, color = TextPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, null, tint = TextSecondary) }
                },
                actions = {
                    if (results.isNotEmpty()) {
                        IconButton(onClick = { showClearDialog = true }) {
                            Icon(Icons.Filled.Delete, "Clear", tint = ShieldRed)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface)
            )
        },
        containerColor = DarkBg
    ) { padding ->
        if (results.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.History, null, tint = TextSecondary, modifier = Modifier.size(64.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("No scan history yet", color = TextSecondary, fontSize = 16.sp)
                    Text("Run a scan to see results here", color = TextSecondary, fontSize = 13.sp)
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(results) { result ->
                    Card(
                        modifier = Modifier.fillMaxWidth().clickable { onViewResult(result.id) },
                        colors = CardDefaults.cardColors(containerColor = DarkCard),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(48.dp)
                                    .background(
                                        if (result.threatsFound > 0) ShieldRed.copy(alpha = 0.15f)
                                        else ShieldGreen.copy(alpha = 0.15f),
                                        RoundedCornerShape(12.dp)
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    if (result.threatsFound > 0) Icons.Filled.Warning else Icons.Filled.CheckCircle,
                                    null,
                                    tint = if (result.threatsFound > 0) ShieldRed else ShieldGreen,
                                    modifier = Modifier.size(28.dp)
                                )
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text("${result.scanType} Scan", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 15.sp)
                                Text(
                                    SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())
                                        .format(Date(result.completedAt)),
                                    fontSize = 12.sp, color = TextSecondary
                                )
                                Text("${result.totalScanned} apps scanned", fontSize = 12.sp, color = TextSecondary)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(
                                    if (result.threatsFound > 0) "${result.threatsFound} threats" else "Clean",
                                    color = if (result.threatsFound > 0) ShieldRed else ShieldGreen,
                                    fontSize = 13.sp, fontWeight = FontWeight.Medium
                                )
                                Icon(Icons.Filled.ChevronRight, null, tint = TextSecondary, modifier = Modifier.size(20.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
