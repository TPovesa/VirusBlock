package com.shield.antivirus.ui.theme

import android.app.Activity
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary          = ShieldGreen,
    onPrimary        = Color(0xFF001A00),
    primaryContainer = ShieldGreenDark,
    onPrimaryContainer = ShieldGreenLight,
    secondary        = ShieldOrange,
    onSecondary      = Color(0xFF1A0A00),
    error            = ShieldRed,
    onError          = Color(0xFF1A0000),
    background       = DarkBg,
    onBackground     = TextPrimary,
    surface          = DarkSurface,
    onSurface        = TextPrimary,
    surfaceVariant   = DarkCard,
    onSurfaceVariant = TextSecondary,
    outline          = Color(0xFF2A3D5E),
)

@Composable
fun ShieldAntivirusTheme(content: @Composable () -> Unit) {
    val colorScheme = DarkColorScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = DarkBg.toArgb()
            window.navigationBarColor = DarkBg.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
