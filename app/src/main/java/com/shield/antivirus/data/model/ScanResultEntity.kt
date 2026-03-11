package com.shield.antivirus.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "scan_results")
data class ScanResultEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val scanType: String,
    val startedAt: Long,
    val completedAt: Long,
    val totalScanned: Int,
    val threatsFound: Int,
    val threatsJson: String,
    val status: String
)
