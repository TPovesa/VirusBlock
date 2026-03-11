package com.shield.antivirus.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldBrandMark
import com.shield.antivirus.ui.screens.HistoryScreen
import com.shield.antivirus.ui.screens.HomeScreen
import com.shield.antivirus.ui.screens.LoginScreen
import com.shield.antivirus.ui.screens.RegisterScreen
import com.shield.antivirus.ui.screens.ScanResultsScreen
import com.shield.antivirus.ui.screens.ScanScreen
import com.shield.antivirus.ui.screens.SettingsScreen
import com.shield.antivirus.ui.screens.WelcomeScreen
import com.shield.antivirus.viewmodel.AuthViewModel
import com.shield.antivirus.viewmodel.HomeViewModel
import com.shield.antivirus.viewmodel.ScanViewModel
import kotlinx.coroutines.flow.first

@Composable
fun NavGraph(navController: NavHostController = rememberNavController()) {
    val context = LocalContext.current
    val prefs = UserPreferences(context)
    val isLoggedIn by produceState<Boolean?>(initialValue = null, context) {
        value = prefs.isLoggedIn.first()
    }

    if (isLoggedIn == null) {
        ShieldBackdrop {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.padding(24.dp)
                ) {
                    ShieldBrandMark()
                    CircularProgressIndicator()
                    Text(
                        text = "Проверка сессии",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                }
            }
        }
        return
    }

    NavHost(
        navController = navController,
        startDestination = if (isLoggedIn == true) Screen.Home.route else Screen.Welcome.route
    ) {
        composable(Screen.Welcome.route) {
            WelcomeScreen(
                onLoginClick = { navController.navigate(Screen.Login.route) },
                onRegisterClick = { navController.navigate(Screen.Register.route) }
            )
        }
        composable(Screen.Login.route) {
            val vm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            LoginScreen(
                viewModel = vm,
                onBack = { navController.popBackStack() },
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Welcome.route) { inclusive = true }
                        launchSingleTop = true
                    }
                },
                onNavigateRegister = { navController.navigate(Screen.Register.route) }
            )
        }
        composable(Screen.Register.route) {
            val vm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            RegisterScreen(
                viewModel = vm,
                onBack = { navController.popBackStack() },
                onRegisterSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Welcome.route) { inclusive = true }
                        launchSingleTop = true
                    }
                },
                onNavigateLogin = { navController.navigate(Screen.Login.route) }
            )
        }
        composable(Screen.Home.route) {
            val vm: HomeViewModel = viewModel(factory = HomeViewModel.Factory(context))
            HomeScreen(
                viewModel = vm,
                onStartScan = { type -> navController.navigate(Screen.Scan.createRoute(type)) },
                onOpenHistory = { navController.navigate(Screen.History.route) },
                onOpenSettings = { navController.navigate(Screen.Settings.route) }
            )
        }
        composable(
            route = Screen.Scan.route,
            arguments = listOf(navArgument("scanType") { type = NavType.StringType })
        ) { backStack ->
            val scanType = backStack.arguments?.getString("scanType") ?: "QUICK"
            val vm: ScanViewModel = viewModel(factory = ScanViewModel.Factory(context))
            ScanScreen(
                viewModel = vm,
                scanType = scanType,
                onScanComplete = { scanId ->
                    navController.navigate(Screen.Results.createRoute(scanId)) {
                        popUpTo(Screen.Scan.route) { inclusive = true }
                    }
                },
                onCancel = { navController.popBackStack() }
            )
        }
        composable(
            route = Screen.Results.route,
            arguments = listOf(navArgument("scanId") { type = NavType.LongType })
        ) { backStack ->
            val scanId = backStack.arguments?.getLong("scanId") ?: 0L
            val vm: ScanViewModel = viewModel(factory = ScanViewModel.Factory(context))
            ScanResultsScreen(
                viewModel = vm,
                scanId = scanId,
                onBack = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Home.route)
                        launchSingleTop = true
                    }
                }
            )
        }
        composable(Screen.History.route) {
            val vm: ScanViewModel = viewModel(factory = ScanViewModel.Factory(context))
            HistoryScreen(
                viewModel = vm,
                onBack = { navController.popBackStack() },
                onViewResult = { id -> navController.navigate(Screen.Results.createRoute(id)) }
            )
        }
        composable(Screen.Settings.route) {
            val authVm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            SettingsScreen(
                viewModel = authVm,
                onBack = { navController.popBackStack() },
                onLogout = {
                    navController.navigate(Screen.Welcome.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            )
        }
    }
}
