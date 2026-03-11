package com.shield.antivirus.data.local

import androidx.room.*
import com.shield.antivirus.data.model.ScanResultEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ScanResultDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(result: ScanResultEntity): Long

    @Query("SELECT * FROM scan_results ORDER BY startedAt DESC")
    fun getAllResults(): Flow<List<ScanResultEntity>>

    @Query("SELECT * FROM scan_results WHERE id = :id")
    suspend fun getById(id: Long): ScanResultEntity?

    @Query("DELETE FROM scan_results WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM scan_results")
    suspend fun deleteAll()

    @Query("SELECT * FROM scan_results ORDER BY startedAt DESC LIMIT 5")
    suspend fun getRecentResults(): List<ScanResultEntity>
}
