package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import com.shield.antivirus.data.datastore.PendingAuthFlow
import com.shield.antivirus.ui.components.ShieldBottomFormPanel
import com.shield.antivirus.ui.components.ShieldCalmBackdrop
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.ShieldSectionHeader
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.shieldTextFieldColors
import com.shield.antivirus.ui.components.shieldBottomInsets
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.viewmodel.AuthViewModel

@Composable
fun LoginScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onLoginSuccess: () -> Unit,
    onNavigateRegister: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var showResetDialog by remember { mutableStateOf(false) }
    var resetEmail by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        viewModel.restorePending(PendingAuthFlow.LOGIN)
    }

    LaunchedEffect(uiState.success) {
        if (uiState.success) onLoginSuccess()
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = {
                showResetDialog = false
                viewModel.clearError()
                viewModel.clearInfo()
            },
            title = { Text("Сброс пароля") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = resetEmail,
                        onValueChange = { resetEmail = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Почта") },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Done
                        ),
                        colors = shieldTextFieldColors()
                    )
                    if (!uiState.error.isNullOrBlank()) {
                        Text(
                            text = uiState.error.orEmpty(),
                            color = MaterialTheme.colorScheme.criticalTone,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    if (!uiState.infoMessage.isNullOrBlank()) {
                        Text(
                            text = uiState.infoMessage.orEmpty(),
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { viewModel.requestPasswordReset(resetEmail.trim()) },
                    enabled = !uiState.isLoading
                ) {
                    Text(if (uiState.isLoading) "Отправить" else "Отправить")
                }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) {
                    Text("Закрыть")
                }
            }
        )
    }

    ShieldCalmBackdrop {
        ShieldScreenScaffold(
            title = "Вход",
            onBack = onBack
        ) { padding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 20.dp, vertical = 12.dp)
            ) {
                ShieldSectionHeader(
                    eyebrow = "Аккаунт",
                    title = if (uiState.requiresCode) "Подтвердите вход" else "Вход",
                    subtitle = if (uiState.requiresCode) {
                        "Код отправлен на ${uiState.pendingEmail}"
                    } else {
                        ""
                    },
                    modifier = Modifier.align(Alignment.TopStart)
                )

                ShieldBottomFormPanel(
                    accent = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .shieldBottomInsets()
                        .imePadding()
                ) {
                    if (!uiState.infoMessage.isNullOrBlank()) {
                        Text(
                            text = uiState.infoMessage.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    if (uiState.requiresCode) {
                        OutlinedTextField(
                            value = code,
                            onValueChange = { code = it.filter(Char::isDigit).take(6) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Код из письма") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    if (!uiState.isLoading && code.length >= 6) {
                                        viewModel.verifyCode(PendingAuthFlow.LOGIN, code)
                                    }
                                }
                            ),
                            colors = shieldTextFieldColors()
                        )
                    } else {
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Почта") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email,
                                imeAction = ImeAction.Next
                            ),
                            colors = shieldTextFieldColors()
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Пароль") },
                            singleLine = true,
                            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    if (!uiState.isLoading && email.isNotBlank() && password.isNotBlank()) {
                                        viewModel.login(email.trim(), password)
                                    }
                                }
                            ),
                            trailingIcon = {
                                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                    Icon(
                                        imageVector = if (passwordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                        contentDescription = if (passwordVisible) "Скрыть пароль" else "Показать пароль"
                                    )
                                }
                            },
                            colors = shieldTextFieldColors()
                        )
                    }

                    if (!uiState.error.isNullOrBlank()) {
                        Text(
                            text = uiState.error.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.criticalTone
                        )
                    }

                    Button(
                        onClick = {
                            viewModel.clearError()
                            if (uiState.requiresCode) {
                                viewModel.verifyCode(PendingAuthFlow.LOGIN, code)
                            } else {
                                viewModel.login(email.trim(), password)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.isLoading && if (uiState.requiresCode) code.length >= 6 else email.isNotBlank() && password.isNotBlank(),
                        colors = ShieldPrimaryButtonColors(),
                        shape = MaterialTheme.shapes.medium
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.padding(vertical = 2.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text(if (uiState.requiresCode) "Подтвердить" else "Получить код")
                        }
                    }

                    if (uiState.requiresCode) {
                        TextButton(
                            onClick = {
                                code = ""
                                viewModel.clearPending(PendingAuthFlow.LOGIN)
                            },
                            modifier = Modifier.align(Alignment.End)
                        ) {
                            Text("Ввести заново")
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            TextButton(onClick = onNavigateRegister) {
                                Text("Регистрация")
                            }
                            TextButton(onClick = {
                                resetEmail = email.trim()
                                viewModel.clearError()
                                viewModel.clearInfo()
                                showResetDialog = true
                            }) {
                                Text("Забыли пароль?")
                            }
                        }
                    }
                }
            }
        }
    }
}
