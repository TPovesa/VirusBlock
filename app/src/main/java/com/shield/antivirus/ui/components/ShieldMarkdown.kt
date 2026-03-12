package com.shield.antivirus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shield.antivirus.ui.theme.signalTone

private sealed interface MarkdownLine {
    data class Paragraph(val text: AnnotatedString) : MarkdownLine
    data class Bullet(val text: AnnotatedString) : MarkdownLine
    data class Quote(val text: AnnotatedString) : MarkdownLine
    data class Code(val text: String) : MarkdownLine
}

private data class MarkdownSection(
    val title: String,
    val lines: List<MarkdownLine>
)

@Composable
fun ShieldMarkdownCards(
    markdown: String,
    modifier: Modifier = Modifier
) {
    val sections = parseMarkdownSections(markdown)
    if (sections.isEmpty()) {
        Text(
            text = markdown.trim(),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = modifier.fillMaxWidth()
        )
        return
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        sections.forEachIndexed { index, section ->
            val accent = if (index % 2 == 0) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.signalTone
            }
            ShieldPanel(accent = accent) {
                if (section.title.isNotBlank()) {
                    Text(
                        text = section.title,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                section.lines.forEach { line ->
                    when (line) {
                        is MarkdownLine.Paragraph -> {
                            Text(
                                text = line.text,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }

                        is MarkdownLine.Bullet -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = "•",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Text(
                                    text = line.text,
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }

                        is MarkdownLine.Quote -> {
                            Text(
                                text = line.text,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(
                                        MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f),
                                        RoundedCornerShape(12.dp)
                                    )
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            )
                        }

                        is MarkdownLine.Code -> {
                            Text(
                                text = line.text,
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(
                                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
                                        RoundedCornerShape(10.dp)
                                    )
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun parseMarkdownSections(markdown: String): List<MarkdownSection> {
    val lines = markdown
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .split('\n')

    val sections = mutableListOf<MarkdownSection>()
    var currentTitle = ""
    val currentLines = mutableListOf<MarkdownLine>()
    var inCodeBlock = false
    val codeBuffer = StringBuilder()

    fun flushSection() {
        if (currentTitle.isNotBlank() || currentLines.isNotEmpty()) {
            sections += MarkdownSection(currentTitle.trim(), currentLines.toList())
            currentTitle = ""
            currentLines.clear()
        }
    }

    lines.forEach { raw ->
        val line = raw.trim()
        if (line.startsWith("```")) {
            if (inCodeBlock) {
                val content = codeBuffer.toString().trim()
                if (content.isNotBlank()) {
                    currentLines += MarkdownLine.Code(content)
                }
                codeBuffer.clear()
            }
            inCodeBlock = !inCodeBlock
            return@forEach
        }

        if (inCodeBlock) {
            codeBuffer.appendLine(raw)
            return@forEach
        }

        if (line.isBlank()) {
            return@forEach
        }

        val heading = Regex("^#{1,3}\\s+(.+)$").find(line)?.groupValues?.getOrNull(1)
        if (!heading.isNullOrBlank()) {
            flushSection()
            currentTitle = heading
            return@forEach
        }

        val bullet = Regex("^[-*]\\s+(.+)$").find(line)?.groupValues?.getOrNull(1)
        if (!bullet.isNullOrBlank()) {
            currentLines += MarkdownLine.Bullet(parseInlineMarkdown(bullet))
            return@forEach
        }

        if (line.startsWith(">")) {
            currentLines += MarkdownLine.Quote(parseInlineMarkdown(line.removePrefix(">").trim()))
            return@forEach
        }

        currentLines += MarkdownLine.Paragraph(parseInlineMarkdown(line))
    }

    if (codeBuffer.isNotEmpty()) {
        currentLines += MarkdownLine.Code(codeBuffer.toString().trim())
    }
    flushSection()
    return sections
}

private fun parseInlineMarkdown(text: String): AnnotatedString {
    val builder = AnnotatedString.Builder()
    var index = 0

    while (index < text.length) {
        when {
            text.startsWith("**", index) -> {
                val end = text.indexOf("**", startIndex = index + 2)
                if (end > index + 2) {
                    builder.pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold))
                    builder.append(text.substring(index + 2, end))
                    builder.pop()
                    index = end + 2
                } else {
                    builder.append(text[index])
                    index++
                }
            }

            text.startsWith("*", index) -> {
                val end = text.indexOf("*", startIndex = index + 1)
                if (end > index + 1) {
                    builder.pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
                    builder.append(text.substring(index + 1, end))
                    builder.pop()
                    index = end + 1
                } else {
                    builder.append(text[index])
                    index++
                }
            }

            text.startsWith("`", index) -> {
                val end = text.indexOf("`", startIndex = index + 1)
                if (end > index + 1) {
                    builder.pushStyle(
                        SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            background = Color(0x334C5A67)
                        )
                    )
                    builder.append(text.substring(index + 1, end))
                    builder.pop()
                    index = end + 1
                } else {
                    builder.append(text[index])
                    index++
                }
            }

            else -> {
                builder.append(text[index])
                index++
            }
        }
    }

    return builder.toAnnotatedString()
}
