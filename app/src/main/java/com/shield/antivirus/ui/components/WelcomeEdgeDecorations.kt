package com.shield.antivirus.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.LoadingIndicatorDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun WelcomeEdgeDecorations(
    modifier: Modifier = Modifier,
    parallaxX: Float = 0f,
    parallaxY: Float = 0f
) {
    val transition = rememberInfiniteTransition(label = "welcome_shapes")

    Box(modifier = modifier.fillMaxSize()) {
        WelcomeShapeSpecs.forEachIndexed { index, spec ->
            val driftX by transition.animateFloat(
                initialValue = -spec.oscillationX,
                targetValue = spec.oscillationX,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = spec.durationMs,
                        easing = FastOutSlowInEasing
                    ),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "shape_drift_x_$index"
            )
            val driftY by transition.animateFloat(
                initialValue = -spec.oscillationY,
                targetValue = spec.oscillationY,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = spec.durationMs + 1300,
                        easing = FastOutSlowInEasing
                    ),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "shape_drift_y_$index"
            )
            val rotation by transition.animateFloat(
                initialValue = 0f,
                targetValue = 360f * spec.spinDirection,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = spec.durationMs * 2,
                        easing = LinearEasing
                    ),
                    repeatMode = RepeatMode.Restart
                ),
                label = "shape_rotation_$index"
            )

            var dragX by remember(index) { mutableFloatStateOf(0f) }
            var dragY by remember(index) { mutableFloatStateOf(0f) }
            var manualRotation by remember(index) { mutableFloatStateOf(0f) }
            var useContainedPolygons by rememberSaveable(index) { mutableStateOf(spec.useContainedPolygons) }

            val color = when (spec.colorSlot % 4) {
                0 -> MaterialTheme.colorScheme.primary.copy(alpha = 0.62f)
                1 -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.58f)
                2 -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.6f)
                else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            }

            Box(
                modifier = Modifier
                    .align(spec.alignment)
                    .offset(x = spec.offsetX, y = spec.offsetY)
                    .size(spec.size)
                    .clickable {
                        useContainedPolygons = !useContainedPolygons
                        manualRotation += 24f
                    }
                    .pointerInput(index) {
                        detectDragGestures { change, dragAmount ->
                            change.consume()
                            dragX += dragAmount.x
                            dragY += dragAmount.y
                            manualRotation += dragAmount.x * 0.08f
                        }
                    }
                    .graphicsLayer {
                        translationX = dragX + driftX + parallaxX.coerceIn(-1f, 1f) * (spec.parallaxFactor * 26f)
                        translationY = dragY + driftY + parallaxY.coerceIn(-1f, 1f) * (spec.parallaxFactor * 20f)
                        rotationZ = rotation + manualRotation
                    }
            ) {
                LoadingIndicator(
                    modifier = Modifier.fillMaxSize(),
                    color = color,
                    polygons = if (useContainedPolygons) {
                        LoadingIndicatorDefaults.ContainedIndicatorPolygons
                    } else {
                        LoadingIndicatorDefaults.IndeterminateIndicatorPolygons
                    }
                )
            }
        }
    }
}

private data class WelcomeShapeSpec(
    val alignment: Alignment,
    val size: Dp,
    val offsetX: Dp = 0.dp,
    val offsetY: Dp = 0.dp,
    val durationMs: Int,
    val spinDirection: Float,
    val colorSlot: Int,
    val parallaxFactor: Float,
    val oscillationX: Float,
    val oscillationY: Float,
    val useContainedPolygons: Boolean
)

private val WelcomeShapeSpecs = listOf(
    WelcomeShapeSpec(Alignment.TopStart, 58.dp, (-20).dp, 20.dp, 12000, 1f, 0, 1.0f, 20f, 16f, false),
    WelcomeShapeSpec(Alignment.TopEnd, 64.dp, 18.dp, 40.dp, 13800, -1f, 1, 0.9f, 18f, 14f, true),
    WelcomeShapeSpec(Alignment.CenterStart, 54.dp, (-18).dp, (-26).dp, 13200, 1f, 2, 0.8f, 16f, 20f, true),
    WelcomeShapeSpec(Alignment.CenterEnd, 70.dp, 16.dp, 12.dp, 14500, -1f, 3, 1.05f, 20f, 18f, false),
    WelcomeShapeSpec(Alignment.Center, 48.dp, 0.dp, (-148).dp, 15800, 1f, 0, 0.55f, 12f, 10f, false),
    WelcomeShapeSpec(Alignment.BottomStart, 68.dp, (-14).dp, (-38).dp, 14100, -1f, 1, 0.95f, 22f, 14f, true),
    WelcomeShapeSpec(Alignment.BottomEnd, 62.dp, 24.dp, (-64).dp, 12600, 1f, 2, 1.1f, 18f, 20f, false),
    WelcomeShapeSpec(Alignment.BottomCenter, 52.dp, 0.dp, (-20).dp, 13400, -1f, 3, 0.7f, 16f, 12f, true)
)
