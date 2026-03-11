package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.VpnKey
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldStatusChip
import com.shield.antivirus.ui.components.shieldTextFieldColors
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.ui.theme.safeTone
import com.shield.antivirus.ui.theme.signalTone
import com.shield.antivirus.viewmodel.AuthViewModel
import androidx.compose.runtime.collectAsState

@Composable
fun LoginScreen(
    viewModel: AuthViewModel,
    onLoginSuccess: () -> Unit,
    onNavigateRegister: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.success) {
        if (uiState.success) onLoginSuccess()
    }

    ShieldBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            Spacer(Modifier.height(24.dp))
            ShieldSectionHeader(
                eyebrow = "Material 3 expressive",
                title = "Secure the device",
                subtitle = "Sign in to sync your scan timeline with the pinned backend at sosiskibot.ru."
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ShieldStatusChip(
                    label = "SSL PINNED",
                    icon = Icons.Filled.Security,
                    color = MaterialTheme.colorScheme.safeTone
                )
                ShieldStatusChip(
                    label = "LOCAL-FIRST",
                    icon = Icons.Filled.VpnKey,
                    color = MaterialTheme.colorScheme.signalTone
                )
            }
            ShieldPanel(accent = MaterialTheme.colorScheme.primary) {
                Text(
                    text = "Operator login",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Email") },
                    leadingIcon = { Icon(Icons.Filled.Email, contentDescription = null) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    colors = shieldTextFieldColors()
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Password") },
                    leadingIcon = { Icon(Icons.Filled.Lock, contentDescription = null) },
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                imageVector = if (passwordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (passwordVisible) "Hide password" else "Show password"
                            )
                        }
                    },
                    singleLine = true,
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    colors = shieldTextFieldColors()
                )
                if (uiState.error != null) {
                    ShieldPanel(accent = MaterialTheme.colorScheme.criticalTone) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(
                                imageVector = Icons.Filled.Warning,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.criticalTone
                            )
                            Text(
                                text = uiState.error.orEmpty(),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }
                Button(
                    onClick = {
                        viewModel.clearError()
                        viewModel.login(email.trim(), password)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
                    enabled = !uiState.isLoading && email.isNotBlank() && password.isNotBlank(),
                    colors = ShieldPrimaryButtonColors(),
                    shape = MaterialTheme.shapes.medium
                ) {
                    if (uiState.isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.height(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Sign in to cockpit", style = MaterialTheme.typography.titleMedium)
                    }
                }
                Text(
                    text = "Sessions are stored in encrypted preferences and refreshed with rotating tokens.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "No operator account yet?",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = onNavigateRegister) {
                    Text("Create one")
                }
            }
        }
    }
}
