package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.VpnKey
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.collectAsState
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.components.shieldTextFieldColors
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.viewmodel.AuthViewModel

@Composable
fun SettingsScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onLogout: () -> Unit
) {
    val userName by viewModel.userName.collectAsState()
    val userEmail by viewModel.userEmail.collectAsState()
    val vtApiKey by viewModel.vtApiKey.collectAsState()
    val realtimeProtection by viewModel.realtimeProtection.collectAsState()
    val scanOnInstall by viewModel.scanOnInstall.collectAsState()

    var apiKeyInput by remember(vtApiKey) { mutableStateOf(vtApiKey) }
    var apiKeyVisible by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Sign out") },
            text = { Text("Clear the local encrypted session and return to the auth screen?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.logout()
                        showLogoutDialog = false
                        onLogout()
                    }
                ) {
                    Text("Sign out", color = MaterialTheme.colorScheme.criticalTone)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    ShieldBackdrop {
        ShieldScreenScaffold(
            title = "Control Settings",
            subtitle = "Protection and cloud intel",
            onBack = onBack
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                ShieldPanel(accent = MaterialTheme.colorScheme.primary) {
                    ShieldSectionHeader(
                        eyebrow = "Operator profile",
                        title = userName.ifBlank { "Unassigned operator" },
                        subtitle = userEmail.ifBlank { "No email synced" }
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ShieldStatusChip(
                            label = if (realtimeProtection) "REALTIME ON" else "REALTIME OFF",
                            icon = Icons.Filled.Security,
                            color = if (realtimeProtection) MaterialTheme.colorScheme.safeTone else MaterialTheme.colorScheme.criticalTone
                        )
                        ShieldStatusChip(
                            label = if (scanOnInstall) "INSTALL WATCH" else "MANUAL WATCH",
                            icon = Icons.Filled.Tune,
                            color = MaterialTheme.colorScheme.signalTone
                        )
                    }
                }

                ShieldPanel(accent = MaterialTheme.colorScheme.secondary) {
                    Text(
                        text = "Account",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    SettingsInfoRow(icon = Icons.Filled.Person, label = "Name", value = userName.ifBlank { "Not set" })
                    SettingsInfoRow(icon = Icons.Filled.Email, label = "Email", value = userEmail.ifBlank { "Not set" })
                }

                ShieldPanel(accent = MaterialTheme.colorScheme.tertiary) {
                    Text(
                        text = "Cloud intel",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "Optional VirusTotal key. Local heuristics still run without it.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = apiKeyInput,
                        onValueChange = { apiKeyInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("VirusTotal API key") },
                        leadingIcon = { Icon(Icons.Filled.VpnKey, contentDescription = null) },
                        trailingIcon = {
                            TextButton(onClick = { apiKeyVisible = !apiKeyVisible }) {
                                Text(if (apiKeyVisible) "Hide" else "Show")
                            }
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        visualTransformation = if (apiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        singleLine = true,
                        colors = shieldTextFieldColors()
                    )
                    Button(
                        onClick = { viewModel.saveVtApiKey(apiKeyInput.trim()) },
                        modifier = Modifier.height(50.dp),
                        colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.tertiary),
                        shape = MaterialTheme.shapes.medium
                    ) {
                        Text("Save cloud intel key")
                    }
                }

                ShieldPanel(accent = MaterialTheme.colorScheme.primary) {
                    Text(
                        text = "Protection switches",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    SettingsToggleRow(
                        icon = Icons.Filled.Security,
                        title = "Realtime protection",
                        subtitle = "Keep continuous local monitoring active.",
                        checked = realtimeProtection,
                        onToggle = viewModel::setRealtimeProtection
                    )
                    SettingsToggleRow(
                        icon = Icons.Filled.Tune,
                        title = "Scan on install",
                        subtitle = "Inspect new packages immediately after install.",
                        checked = scanOnInstall,
                        onToggle = viewModel::setScanOnInstall
                    )
                }

                ShieldPanel(accent = MaterialTheme.colorScheme.signalTone) {
                    Text(
                        text = "Build info",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    SettingsInfoRow(icon = Icons.Filled.Tune, label = "UI system", value = "Material 3 Expressive")
                    SettingsInfoRow(icon = Icons.Filled.Security, label = "Session store", value = "EncryptedSharedPreferences")
                    SettingsInfoRow(icon = Icons.Filled.VpnKey, label = "Backend", value = "sosiskibot.ru")
                }

                Button(
                    onClick = { showLogoutDialog = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
                    colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.criticalTone),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Icon(Icons.Filled.ExitToApp, contentDescription = null)
                    Text("  Sign out and clear session")
                }
            }
        }
    }
}

@Composable
private fun SettingsInfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column {
                Text(label, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SettingsToggleRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onToggle: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onToggle,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
                uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant
            )
        )
    }
}
