package com.shield.antivirus.data.model

import com.google.gson.annotations.SerializedName

data class VTFileResponse(
    val data: VTFileData?
)

data class VTFileData(
    val id: String?,
    val type: String?,
    val attributes: VTFileAttributes?
)

data class VTFileAttributes(
    val name: String?,
    val sha256: String?,
    val md5: String?,
    @SerializedName("last_analysis_stats") val lastAnalysisStats: VTAnalysisStats?,
    @SerializedName("last_analysis_results") val lastAnalysisResults: Map<String, VTEngineResult>?,
    @SerializedName("meaningful_name") val meaningfulName: String?
)

data class VTAnalysisStats(
    val malicious: Int = 0,
    val suspicious: Int = 0,
    val undetected: Int = 0,
    val harmless: Int = 0,
    val timeout: Int = 0
)

data class VTEngineResult(
    val category: String?,
    val result: String?,
    @SerializedName("engine_name") val engineName: String?
)

data class VTUploadResponse(
    val data: VTUploadData?
)

data class VTUploadData(
    val id: String?,
    val type: String?
)
