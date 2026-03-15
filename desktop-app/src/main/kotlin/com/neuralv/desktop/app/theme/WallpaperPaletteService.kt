package com.neuralv.desktop.app.theme

import androidx.compose.ui.graphics.Color
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO

object WallpaperPaletteService {
    fun load(): NeuralVPalette {
        val accent = resolveDominantAccent() ?: return NeuralVPalettes.fallback
        return NeuralVPalette(
            primary = accent,
            primaryContainer = accent.mix(Color.White, 0.78f),
            secondary = accent.rotateWarm().mix(NeuralVPalettes.fallback.secondary, 0.45f),
            tertiary = accent.rotateWarm(),
            background = NeuralVPalettes.fallback.background,
            surface = NeuralVPalettes.fallback.surface,
            surfaceVariant = accent.mix(NeuralVPalettes.fallback.surfaceVariant, 0.72f),
            outline = accent.mix(NeuralVPalettes.fallback.outline, 0.58f),
            danger = NeuralVPalettes.fallback.danger,
            success = NeuralVPalettes.fallback.success,
            source = "wallpaper"
        )
    }

    fun resolveDominantAccent(): Color? {
        val wallpaper = resolveWallpaperPath() ?: return null
        val image = runCatching { ImageIO.read(File(wallpaper)) }.getOrNull() ?: return null
        return sampleDominant(image)
    }

    private fun resolveWallpaperPath(): String? {
        val osName = System.getProperty("os.name", "").lowercase()
        return when {
            osName.contains("win") -> runCommand(
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-ItemProperty 'HKCU:\\Control Panel\\Desktop').WallPaper"
            )
            osName.contains("linux") -> resolveLinuxWallpaper()
            else -> null
        }?.trim()?.removePrefix("file://")?.takeIf { it.isNotBlank() }
    }

    private fun resolveLinuxWallpaper(): String? {
        val gnome = runCommand(
            "sh",
            "-lc",
            "gsettings get org.gnome.desktop.background picture-uri 2>/dev/null | tr -d \"'\""
        )?.trim()
        if (!gnome.isNullOrBlank()) return gnome

        val kdeConfig = File(System.getProperty("user.home"), ".config/plasma-org.kde.plasma.desktop-appletsrc")
        if (kdeConfig.exists()) {
            val line = kdeConfig.readLines().firstOrNull { it.contains("Image=") }
            val imagePath = line?.substringAfter("Image=")?.trim()?.removePrefix("file://")
            if (!imagePath.isNullOrBlank()) return imagePath
        }
        return null
    }

    private fun runCommand(vararg command: String): String? = runCatching {
        ProcessBuilder(*command)
            .redirectErrorStream(true)
            .start()
            .inputStream
            .bufferedReader()
            .use { it.readText() }
    }.getOrNull()

    private fun sampleDominant(image: BufferedImage): Color {
        val stepX = (image.width / 32).coerceAtLeast(1)
        val stepY = (image.height / 32).coerceAtLeast(1)
        var red = 0L
        var green = 0L
        var blue = 0L
        var count = 0L
        var x = 0
        while (x < image.width) {
            var y = 0
            while (y < image.height) {
                val argb = image.getRGB(x, y)
                red += (argb shr 16) and 0xFF
                green += (argb shr 8) and 0xFF
                blue += argb and 0xFF
                count++
                y += stepY
            }
            x += stepX
        }
        if (count == 0L) return NeuralVPrimary
        return Color(
            red = ((red / count).toInt().coerceIn(0, 255)) / 255f,
            green = ((green / count).toInt().coerceIn(0, 255)) / 255f,
            blue = ((blue / count).toInt().coerceIn(0, 255)) / 255f,
            alpha = 1f
        )
    }
}
