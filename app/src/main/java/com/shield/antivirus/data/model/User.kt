package com.shield.antivirus.data.model

data class User(
    val id: String,
    val name: String,
    val email: String,
    val createdAt: Long = System.currentTimeMillis()
)
