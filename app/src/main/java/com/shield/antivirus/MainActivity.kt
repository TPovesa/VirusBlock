package com.shield.antivirus

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import com.shield.antivirus.data.datastore.ThemeMode
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.navigation.NavGraph
import com.shield.antivirus.ui.theme.ShieldAntivirusTheme
import com.shield.antivirus.util.AppLogger
import com.shield.antivirus.util.ProtectionServiceController
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        AppLogger.log(tag = "main_activity", message = "MainActivity created")

        lifecycleScope.launch {
            ProtectionServiceController.sync(this@MainActivity)
        }
        requestNotificationPermissionIfNeeded()

        setContent {
            val userPreferences = remember { UserPreferences(applicationContext) }
            val themeMode by userPreferences.themeMode.collectAsState(initial = ThemeMode.SYSTEM)
            val dynamicColors by userPreferences.dynamicColorsEnabled.collectAsState(initial = true)

            ShieldAntivirusTheme(
                themeMode = themeMode,
                dynamicColor = dynamicColors
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color.Transparent
                ) {
                    val navController = rememberNavController()
                    NavGraph(navController = navController)
                }
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            AppLogger.log(tag = "permissions", message = "Requesting POST_NOTIFICATIONS")
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
