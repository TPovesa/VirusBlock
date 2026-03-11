package com.shield.antivirus.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
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
import com.shield.antivirus.data.datastore.PendingAuthFlow
import com.shield.antivirus.ui.components.ShieldCalmBackdrop
import com.shield.antivirus.ui.components.ShieldFormScreenContent
import com.shield.antivirus.ui.components.ShieldPanel
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.ShieldScreenScaffold
import com.shield.antivirus.ui.components.bringIntoViewOnFocus
import com.shield.antivirus.ui.components.shieldTextFieldColors
import com.shield.antivirus.ui.theme.criticalTone
import com.shield.antivirus.viewmodel.AuthViewModel

@Composable
fun RegisterScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onRegisterSuccess: () -> Unit,
    onNavigateLogin: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.restorePending(PendingAuthFlow.REGISTER)
    }

    LaunchedEffect(uiState.success) {
        if (uiState.success) onRegisterSuccess()
    }

    ShieldCalmBackdrop {
        ShieldScreenScaffold(
            title = if (uiState.requiresCode) "Код из почты" else "Регистрация",
            onBack = onBack
        ) { padding ->
            ShieldFormScreenContent(padding = padding) {
                ShieldPanel(accent = MaterialTheme.colorScheme.tertiary) {
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
                            modifier = Modifier
                                .fillMaxWidth()
                                .bringIntoViewOnFocus(),
                            label = { Text("Код из письма") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    if (!uiState.isLoading && code.length >= 6) {
                                        viewModel.verifyCode(PendingAuthFlow.REGISTER, code)
                                    }
                                }
                            ),
                            colors = shieldTextFieldColors()
                        )
                    } else {
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it },
                            modifier = Modifier
                                .fillMaxWidth()
                                .bringIntoViewOnFocus(),
                            label = { Text("Имя") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            colors = shieldTextFieldColors()
                        )
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            modifier = Modifier
                                .fillMaxWidth()
                                .bringIntoViewOnFocus(),
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
                            modifier = Modifier
                                .fillMaxWidth()
                                .bringIntoViewOnFocus(),
                            label = { Text("Пароль") },
                            singleLine = true,
                            visualTransformation = if (passwordVisible) {
                                VisualTransformation.None
                            } else {
                                PasswordVisualTransformation()
                            },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Next
                            ),
                            trailingIcon = {
                                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                    Icon(
                                        imageVector = if (passwordVisible) {
                                            Icons.Filled.VisibilityOff
                                        } else {
                                            Icons.Filled.Visibility
                                        },
                                        contentDescription = if (passwordVisible) "Скрыть пароль" else "Показать пароль"
                                    )
                                }
                            },
                            colors = shieldTextFieldColors()
                        )
                        OutlinedTextField(
                            value = confirmPassword,
                            onValueChange = { confirmPassword = it },
                            modifier = Modifier
                                .fillMaxWidth()
                                .bringIntoViewOnFocus(),
                            label = { Text("Повтор пароля") },
                            singleLine = true,
                            isError = confirmPassword.isNotBlank() && confirmPassword != password,
                            visualTransformation = if (passwordVisible) {
                                VisualTransformation.None
                            } else {
                                PasswordVisualTransformation()
                            },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(
                                onDone = {
                                    if (!uiState.isLoading && password == confirmPassword) {
                                        viewModel.register(name.trim(), email.trim(), password)
                                    }
                                }
                            ),
                            colors = shieldTextFieldColors()
                        )
                    }

                    if (!uiState.requiresCode && confirmPassword.isNotBlank() && confirmPassword != password) {
                        Text(
                            text = "Пароли не совпадают",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.criticalTone
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
                                viewModel.verifyCode(PendingAuthFlow.REGISTER, code)
                            } else if (password == confirmPassword) {
                                viewModel.register(name.trim(), email.trim(), password)
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .bringIntoViewOnFocus(),
                        enabled = !uiState.isLoading && if (uiState.requiresCode) {
                            code.length >= 6
                        } else {
                            name.isNotBlank() &&
                                email.isNotBlank() &&
                                password.length >= 6 &&
                                password == confirmPassword
                        },
                        colors = ShieldPrimaryButtonColors(MaterialTheme.colorScheme.tertiary),
                        shape = MaterialTheme.shapes.medium
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                color = MaterialTheme.colorScheme.onTertiary,
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
                                viewModel.clearPending(PendingAuthFlow.REGISTER)
                            },
                            modifier = Modifier.align(Alignment.End)
                        ) {
                            Text("Ввести заново")
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            TextButton(onClick = onNavigateLogin) {
                                Text("Есть аккаунт?")
                            }
                        }
                    }
                }
            }
        }
    }
}
