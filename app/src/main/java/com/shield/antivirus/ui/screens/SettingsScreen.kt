package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shield.antivirus.ui.theme.*
import com.shield.antivirus.viewmodel.AuthViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onLogout: () -> Unit
) {
    val userName by viewModel.userName.collectAsState()
    val userEmail by viewModel.userEmail.collectAsState()
    val vtApiKey by viewModel.vtApiKey.collectAsState()
    val realtimeProt by viewModel.realtimeProtection.collectAsState()
    val scanOnInstall by viewModel.scanOnInstall.collectAsState()

    var apiKeyInput by remember(vtApiKey) { mutableStateOf(vtApiKey) }
    var apiKeyVisible by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Sign Out") },
            text = { Text("Are you sure you want to sign out?") },
            confirmButton = {
                TextButton(onClick = { viewModel.logout(); onLogout() }) {
                    Text("Sign Out", color = ShieldRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") }
            },
            containerColor = DarkCard
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.Bold, color = TextPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, null, tint = TextSecondary) }
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
            // Account
            SettingsSection("Account") {
                SettingsInfoRow(Icons.Filled.Person, "Name", userName.ifEmpty { "—" })
                SettingsInfoRow(Icons.Filled.Email, "Email", userEmail.ifEmpty { "—" })
            }

            // VirusTotal API
            SettingsSection("VirusTotal API") {
                Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
                    Text(
                        "Enter your VirusTotal API key to enable real threat detection. Get a free key at virustotal.com",
                        fontSize = 12.sp, color = TextSecondary
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = apiKeyInput,
                        onValueChange = { apiKeyInput = it },
                        label = { Text("API Key") },
                        leadingIcon = { Icon(Icons.Filled.Key, null, tint = ShieldGreen) },
                        trailingIcon = {
                            IconButton(onClick = { apiKeyVisible = !apiKeyVisible }) {
                                Icon(if (apiKeyVisible) Icons.Filled.Visibility else Icons.Filled.VisibilityOff, null, tint = TextSecondary)
                            }
                        },
                        visualTransformation = if (apiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = shieldTextFieldColors()
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { viewModel.saveVtApiKey(apiKeyInput.trim()) },
                        colors = ButtonDefaults.buttonColors(containerColor = ShieldGreen),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Save API Key", color = Color.Black, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            // Protection Settings
            SettingsSection("Protection") {
                SettingsToggleRow(
                    icon = Icons.Filled.Shield,
                    title = "Real-time Protection",
                    subtitle = "Monitor device 24/7",
                    checked = realtimeProt,
                    onToggle = viewModel::setRealtimeProtection
                )
                SettingsToggleRow(
                    icon = Icons.Filled.InstallMobile,
                    title = "Scan on App Install",
                    subtitle = "Check new apps automatically",
                    checked = scanOnInstall,
                    onToggle = viewModel::setScanOnInstall
                )
            }

            // About
            SettingsSection("About") {
                SettingsInfoRow(Icons.Filled.Info, "Version", "1.0.0")
                SettingsInfoRow(Icons.Filled.BugReport, "Database", "VirusTotal v3")
                SettingsInfoRow(Icons.Filled.CloudDone, "Engine", "AI-assisted + VT")
            }

            // Logout
            Button(
                onClick = { showLogoutDialog = true },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ShieldRed.copy(alpha = 0.15f)),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Filled.Logout, null, tint = ShieldRed)
                Spacer(Modifier.width(8.dp))
                Text("Sign Out", color = ShieldRed, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable () -> Unit) {
    Column {
        Text(title.uppercase(), fontSize = 11.sp, color = TextSecondary, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = DarkCard),
            shape = RoundedCornerShape(16.dp)
        ) {
            content()
        }
    }
}

@Composable
private fun SettingsInfoRow(icon: ImageVector, label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = ShieldGreen, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Text(label, color = TextSecondary, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = TextPrimary, fontSize = 14.sp)
    }
}

@Composable
private fun SettingsToggleRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onToggle: (Boolean) -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = ShieldGreen, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(subtitle, color = TextSecondary, fontSize = 12.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.Black,
                checkedTrackColor = ShieldGreen,
                uncheckedTrackColor = DarkCardAlt
            )
        )
    }
}
