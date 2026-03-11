package com.shield.antivirus.data.local

import android.content.Context
import androidx.room.*
import com.shield.antivirus.data.model.ScanResultEntity

@Database(
    entities = [ScanResultEntity::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun scanResultDao(): ScanResultDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "shield_antivirus.db"
                ).build().also { INSTANCE = it }
            }
        }
    }
}
