package com.shield.antivirus.data.api

import com.shield.antivirus.data.model.VTFileResponse
import com.shield.antivirus.data.model.VTUploadResponse
import okhttp3.MultipartBody
import retrofit2.Response
import retrofit2.http.*

interface VirusTotalApi {
    @GET("files/{hash}")
    suspend fun getFileReport(
        @Header("x-apikey") apiKey: String,
        @Path("hash") hash: String
    ): Response<VTFileResponse>

    @Multipart
    @POST("files")
    suspend fun uploadFile(
        @Header("x-apikey") apiKey: String,
        @Part file: MultipartBody.Part
    ): Response<VTUploadResponse>

    @GET("analyses/{id}")
    suspend fun getAnalysis(
        @Header("x-apikey") apiKey: String,
        @Path("id") analysisId: String
    ): Response<VTFileResponse>
}
