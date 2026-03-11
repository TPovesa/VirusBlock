package com.shield.antivirus.navigation

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import androidx.navigation.compose.*
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.ui.screens.*
import com.shield.antivirus.viewmodel.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

@Composable
fun NavGraph(navController: NavHostController) {
    val context = LocalContext.current
    val prefs = remember { UserPreferences(context) }
    val isLoggedIn = remember {
        runBlocking { prefs.isLoggedIn.first() }
    }

    NavHost(
        navController = navController,
        startDestination = if (isLoggedIn) Screen.Home.route else Screen.Login.route
    ) {
        composable(Screen.Login.route) {
            val vm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            LoginScreen(
                viewModel = vm,
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                onNavigateRegister = { navController.navigate(Screen.Register.route) }
            )
        }
        composable(Screen.Register.route) {
            val vm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            RegisterScreen(
                viewModel = vm,
                onRegisterSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                onNavigateLogin = { navController.popBackStack() }
            )
        }
        composable(Screen.Home.route) {
            val vm: HomeViewModel = viewModel(factory = HomeViewModel.Factory(context))
            HomeScreen(
                viewModel = vm,
                onStartScan = { type ->
                    navController.navigate(Screen.Scan.createRoute(type))
                },
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
                onBack = { navController.navigate(Screen.Home.route) { popUpTo(0) } }
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
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}
