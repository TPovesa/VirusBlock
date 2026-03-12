package com.shield.antivirus.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.shield.antivirus.R
import kotlin.random.Random

@Composable
fun WelcomeEdgeDecorations(
    modifier: Modifier = Modifier,
    parallaxX: Float = 0f,
    parallaxY: Float = 0f
) {
    val transition = rememberInfiniteTransition(label = "welcome_shapes")

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val specs = remember(maxWidth, maxHeight) {
            generateShapeSpecs(
                maxWidth = maxWidth,
                maxHeight = maxHeight,
                count = 16
            )
        }

        specs.forEachIndexed { index, spec ->
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
                        durationMillis = spec.durationMs + 1000,
                        easing = FastOutSlowInEasing
                    ),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "shape_drift_y_$index"
            )
            val rotation by transition.animateFloat(
                initialValue = -spec.rotationRange,
                targetValue = spec.rotationRange,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = spec.durationMs + 2600,
                        easing = FastOutSlowInEasing
                    ),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "shape_rotation_$index"
            )

            val color = tintForSlot(spec.colorSlot)

            Image(
                painter = painterResource(id = spec.drawableRes),
                contentDescription = null,
                modifier = Modifier
                    .offset(x = spec.baseX, y = spec.baseY)
                    .size(spec.size)
                    .graphicsLayer {
                        translationX = driftX + parallaxX.coerceIn(-1f, 1f) * (spec.parallaxFactor * 14f)
                        translationY = driftY + parallaxY.coerceIn(-1f, 1f) * (spec.parallaxFactor * 12f)
                        rotationZ = rotation
                        alpha = spec.alpha
                    },
                colorFilter = ColorFilter.tint(color)
            )
        }
    }
}

@Composable
private fun tintForSlot(colorSlot: Int): Color = when (colorSlot % 4) {
    0 -> MaterialTheme.colorScheme.primary.copy(alpha = shapeTintAlpha())
    1 -> MaterialTheme.colorScheme.secondary.copy(alpha = shapeTintAlpha() - 0.03f)
    2 -> MaterialTheme.colorScheme.tertiary.copy(alpha = shapeTintAlpha() - 0.02f)
    else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = shapeTintAlpha() - 0.05f)
}

@Composable
private fun shapeTintAlpha(): Float {
    val backgroundLuminance = MaterialTheme.colorScheme.background.luminance()
    return if (backgroundLuminance < 0.35f) 0.58f else 0.46f
}

private fun generateShapeSpecs(
    maxWidth: Dp,
    maxHeight: Dp,
    count: Int
): List<WelcomeShapeSpec> {
    val random = Random(0x5A17C0DE)
    val drawables = welcomeShapeDrawables
    val width = maxWidth.value
    val height = maxHeight.value
    if (width <= 0f || height <= 0f || count <= 0) return emptyList()

    return List(count) { index ->
        val size = random.nextInt(30, 70).dp
        val availableX = (width - size.value).coerceAtLeast(0f)
        val availableY = (height - size.value).coerceAtLeast(0f)
        WelcomeShapeSpec(
            drawableRes = drawables[index % drawables.size],
            size = size,
            baseX = (random.nextFloat() * availableX).dp,
            baseY = (random.nextFloat() * availableY).dp,
            durationMs = random.nextInt(12400, 21400),
            colorSlot = random.nextInt(0, 4),
            parallaxFactor = random.nextFloat() * 0.55f + 0.35f,
            oscillationX = random.nextFloat() * 7f + 3f,
            oscillationY = random.nextFloat() * 6f + 2f,
            rotationRange = random.nextFloat() * 10f + 5f,
            alpha = random.nextFloat() * 0.24f + 0.64f
        )
    }
}

private data class WelcomeShapeSpec(
    val drawableRes: Int,
    val size: Dp,
    val baseX: Dp,
    val baseY: Dp,
    val durationMs: Int,
    val colorSlot: Int,
    val parallaxFactor: Float,
    val oscillationX: Float,
    val oscillationY: Float,
    val rotationRange: Float,
    val alpha: Float
)

private val welcomeShapeDrawables = listOf(
    R.drawable.ic_welcome_shape_triangle,
    R.drawable.ic_welcome_shape_square,
    R.drawable.ic_welcome_shape_hexagon,
    R.drawable.ic_welcome_shape_pentagon,
    R.drawable.ic_welcome_shape_diamond
)
