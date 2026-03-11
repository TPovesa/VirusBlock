package com.shield.antivirus.navigation

sealed class Screen(val route: String) {
    object Login    : Screen("login")
    object Register : Screen("register")
    object Home     : Screen("home")
    object Scan     : Screen("scan/{scanType}") {
        fun createRoute(scanType: String) = "scan/$scanType"
    }
    object Results  : Screen("results/{scanId}") {
        fun createRoute(scanId: Long) = "results/$scanId"
    }
    object History  : Screen("history")
    object Settings : Screen("settings")
}
