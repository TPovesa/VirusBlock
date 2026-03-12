package com.shield.antivirus.navigation

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import androidx.navigation.navDeepLink
import com.shield.antivirus.data.datastore.PendingAuthFlow
import com.shield.antivirus.data.datastore.UserPreferences
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldLoadingState
import com.shield.antivirus.ui.screens.HistoryScreen
import com.shield.antivirus.ui.screens.HomeScreen
import com.shield.antivirus.ui.screens.LoginScreen
import com.shield.antivirus.ui.screens.RegisterScreen
import com.shield.antivirus.ui.screens.ResetPasswordScreen
import com.shield.antivirus.ui.screens.ScanResultsScreen
import com.shield.antivirus.ui.screens.ScanScreen
import com.shield.antivirus.ui.screens.SettingsScreen
import com.shield.antivirus.ui.screens.WelcomeScreen
import com.shield.antivirus.util.ProtectionServiceController
import com.shield.antivirus.viewmodel.AuthViewModel
import com.shield.antivirus.viewmodel.HomeViewModel
import com.shield.antivirus.viewmodel.ScanViewModel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

@Composable
fun NavGraph(navController: NavHostController = rememberNavController()) {
    val context = LocalContext.current
    val prefs = UserPreferences(context)
    val scope = rememberCoroutineScope()
    var guestEntryPending by remember { mutableStateOf(false) }
    val sessionState by produceState<SessionGateState?>(initialValue = null, context) {
        combine(
            prefs.isLoggedIn,
            prefs.isGuest,
            prefs.guestScanUsed,
            prefs.pendingAuthFlow
        ) { isLoggedIn, isGuest, guestScanUsed, pendingAuthFlow ->
            SessionGateState(
                isLoggedIn = isLoggedIn,
                isGuest = isGuest,
                guestScanUsed = guestScanUsed,
                pendingAuthFlow = pendingAuthFlow
            )
        }.collect { value = it }
    }

    if (sessionState == null) {
        ShieldBackdrop {
            ShieldLoadingState(
                title = "Загружаем сессию",
                subtitle = "Проверяем режим доступа",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp)
            )
        }
        return
    }

    val gate = sessionState!!
    LaunchedEffect(gate.isGuest, gate.isLoggedIn) {
        if (gate.isGuest || gate.isLoggedIn) {
            guestEntryPending = false
        }
    }
    val startDestination = when {
        gate.isLoggedIn -> Screen.Home.route
        gate.isGuest -> Screen.Home.route
        gate.pendingAuthFlow == PendingAuthFlow.LOGIN -> Screen.Login.route
        gate.pendingAuthFlow == PendingAuthFlow.REGISTER -> Screen.Register.route
        else -> Screen.Welcome.route
    }

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Welcome.route) {
            WelcomeScreen(
                guestAvailable = true,
                onLoginClick = { navController.navigate(Screen.Login.route) },
                onRegisterClick = { navController.navigate(Screen.Register.route) },
                onGuestClick = {
                    guestEntryPending = true
                    scope.launch {
                        prefs.enterGuestMode()
                        ProtectionServiceController.stop(context)
                        navController.navigate(Screen.Home.route) {
                            popUpTo(Screen.Welcome.route) { inclusive = true }
                            launchSingleTop = true
                        }
                    }
                }
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
        composable(
            route = Screen.ResetPassword.route,
            arguments = listOf(
                navArgument("token") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("email") {
                    type = NavType.StringType
                    defaultValue = ""
                }
            ),
            deepLinks = listOf(
                navDeepLink {
                    uriPattern = "shieldsecurity://auth/reset-password?token={token}&email={email}"
                }
            )
        ) { backStack ->
            val vm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            ResetPasswordScreen(
                viewModel = vm,
                token = backStack.arguments?.getString("token").orEmpty(),
                email = backStack.arguments?.getString("email").orEmpty(),
                onBack = { navController.popBackStack() },
                onDone = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Welcome.route)
                        launchSingleTop = true
                    }
                }
            )
        }
        composable(Screen.Home.route) {
            val vm: HomeViewModel = viewModel(factory = HomeViewModel.Factory(context))
            HomeScreen(
                viewModel = vm,
                sessionGateIsGuest = gate.isGuest || guestEntryPending,
                onStartScan = { type, selectedPackage, apkUri ->
                    navController.navigate(Screen.Scan.createRoute(type, selectedPackage, apkUri))
                },
                onOpenActiveScan = { type ->
                    navController.navigate(Screen.Scan.createRoute(type))
                },
                onOpenHistory = { navController.navigate(Screen.History.route) },
                onOpenLatestReport = { id -> navController.navigate(Screen.Results.createRoute(id)) },
                onOpenSettings = { navController.navigate(Screen.Settings.route) },
                onOpenLogin = { navController.navigate(Screen.Login.route) },
                onOpenRegister = { navController.navigate(Screen.Register.route) }
            )
        }
        composable(
            route = Screen.Scan.route,
            arguments = listOf(
                navArgument("scanType") { type = NavType.StringType },
                navArgument("selectedPackage") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("apkUri") {
                    type = NavType.StringType
                    defaultValue = ""
                }
            )
        ) { backStack ->
            val scanType = backStack.arguments?.getString("scanType") ?: "QUICK"
            val selectedPackage = backStack.arguments
                ?.getString("selectedPackage")
                .orEmpty()
                .ifBlank { null }
            val apkUri = backStack.arguments
                ?.getString("apkUri")
                .orEmpty()
                .ifBlank { null }
            val vm: ScanViewModel = viewModel(factory = ScanViewModel.Factory(context))
            ScanScreen(
                viewModel = vm,
                scanType = scanType,
                selectedPackage = selectedPackage,
                apkUri = apkUri,
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
                    scope.launch {
                        val shouldExitGuestMode = vm.shouldExitGuestModeAfterResult()
                        if (shouldExitGuestMode) {
                            vm.exitGuestMode()
                            navController.navigate(Screen.Welcome.route) {
                                popUpTo(Screen.Home.route) { inclusive = true }
                                launchSingleTop = true
                            }
                        } else {
                            navController.navigate(Screen.Home.route) {
                                popUpTo(Screen.Home.route)
                                launchSingleTop = true
                            }
                        }
                    }
                }
            )
        }
        composable(Screen.History.route) {
            if (gate.isGuest) {
                LaunchedEffect(Unit) { navController.popBackStack() }
                return@composable
            }
            val vm: ScanViewModel = viewModel(factory = ScanViewModel.Factory(context))
            HistoryScreen(
                viewModel = vm,
                onBack = { navController.popBackStack() },
                onViewResult = { id -> navController.navigate(Screen.Results.createRoute(id)) }
            )
        }
        composable(Screen.Settings.route) {
            if (gate.isGuest) {
                LaunchedEffect(Unit) { navController.popBackStack() }
                return@composable
            }
            val authVm: AuthViewModel = viewModel(factory = AuthViewModel.Factory(context))
            SettingsScreen(
                viewModel = authVm,
                onBack = { navController.popBackStack() },
                onLogout = {
                    authVm.logout {
                        navController.navigate(Screen.Welcome.route) {
                            popUpTo(Screen.Home.route) { inclusive = true }
                            launchSingleTop = true
                        }
                    }
                }
            )
        }
    }
}

data class SessionGateState(
    val isLoggedIn: Boolean,
    val isGuest: Boolean,
    val guestScanUsed: Boolean,
    val pendingAuthFlow: PendingAuthFlow?
)
