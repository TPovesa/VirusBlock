package com.shield.antivirus.data.model

data class ScanResult(
    val id: Long = 0,
    val scanType: String,
    val startedAt: Long,
    val completedAt: Long,
    val totalScanned: Int,
    val threatsFound: Int,
    val threats: List<ThreatInfo>,
    val status: String = "COMPLETED"
)

data class ThreatInfo(
    val packageName: String,
    val appName: String,
    val threatName: String,
    val severity: ThreatSeverity,
    val detectionEngine: String,
    val detectionCount: Int = 0,
    val totalEngines: Int = 0
)

enum class ThreatSeverity { LOW, MEDIUM, HIGH, CRITICAL }
