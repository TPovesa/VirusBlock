package com.shield.antivirus.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

@Composable
fun WelcomeEdgeDecorations(modifier: Modifier = Modifier) {
    val seed = remember { (System.nanoTime() and 0x7FFFFFFF).toInt() }
    val initialState = remember(seed) {
        val random = Random(seed)
        EdgeDecorSpecs.map {
            ShapeInitialState(
                type = WelcomeShapeType.entries[random.nextInt(WelcomeShapeType.entries.size)],
                rotation = random.nextFloat() * 360f
            )
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        EdgeDecorSpecs.forEachIndexed { index, spec ->
            EdgeDecorativeShape(
                spec = spec,
                initial = initialState[index],
                modifier = Modifier
                    .align(spec.alignment)
                    .offset(x = spec.offsetX, y = spec.offsetY)
            )
        }
    }
}

@Composable
private fun EdgeDecorativeShape(
    spec: EdgeDecorSpec,
    initial: ShapeInitialState,
    modifier: Modifier = Modifier
) {
    val colors = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var currentType by remember { mutableStateOf(initial.type) }
    val manualRotation = remember { Animatable(initial.rotation) }

    val autoTransition = rememberInfiniteTransition(label = "edgeDecorAuto")
    val autoRotation by autoTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f * spec.spinDirection,
        animationSpec = infiniteRepeatable(
            animation = tween(spec.spinDurationMillis, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "edgeDecorAutoRotation"
    )

    val baseColor = when (spec.colorSlot % 4) {
        0 -> colors.primaryContainer
        1 -> colors.secondaryContainer
        2 -> colors.tertiaryContainer
        else -> colors.surfaceContainerHighest
    }
    val outlineColor = colors.outlineVariant.copy(alpha = 0.45f)

    Box(
        modifier = modifier
            .size(spec.size)
            .graphicsLayer {
                rotationZ = autoRotation + manualRotation.value
            }
            .clip(currentType.toShape())
            .background(
                Brush.linearGradient(
                    colors = listOf(
                        baseColor.copy(alpha = 0.86f),
                        baseColor.copy(alpha = 0.56f),
                        colors.surface.copy(alpha = 0.3f)
                    )
                )
            )
            .border(width = 1.dp, color = outlineColor, shape = currentType.toShape())
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = {
                        currentType = currentType.next()
                    }
                )
            }
            .pointerInput(Unit) {
                var tracker = VelocityTracker()
                detectDragGestures(
                    onDragStart = {
                        tracker = VelocityTracker()
                        scope.launch { manualRotation.stop() }
                    },
                    onDragCancel = {
                        scope.launch { manualRotation.stop() }
                    },
                    onDragEnd = {
                        val velocity = tracker.calculateVelocity()
                        val spinVelocity = ((velocity.x + velocity.y * 0.35f) * 0.02f)
                            .coerceIn(-960f, 960f)
                        scope.launch {
                            manualRotation.animateDecay(
                                initialVelocity = spinVelocity,
                                animationSpec = exponentialDecay(frictionMultiplier = 2.1f)
                            )
                        }
                    },
                    onDrag = { change, dragAmount ->
                        tracker.addPosition(change.uptimeMillis, change.position)
                        change.consume()
                        val deltaRotation = (dragAmount.x + dragAmount.y * 0.35f) * 0.5f
                        scope.launch {
                            manualRotation.snapTo(manualRotation.value + deltaRotation)
                        }
                    }
                )
            }
    )
}

private data class EdgeDecorSpec(
    val alignment: Alignment,
    val size: Dp,
    val offsetX: Dp = 0.dp,
    val offsetY: Dp = 0.dp,
    val spinDurationMillis: Int,
    val spinDirection: Float,
    val colorSlot: Int
)

private data class ShapeInitialState(
    val type: WelcomeShapeType,
    val rotation: Float
)

private enum class WelcomeShapeType {
    Circle,
    Square,
    Diamond,
    Star;

    fun next(): WelcomeShapeType = when (this) {
        Circle -> Square
        Square -> Diamond
        Diamond -> Star
        Star -> Circle
    }
}

private fun WelcomeShapeType.toShape(): Shape = when (this) {
    WelcomeShapeType.Circle -> CircleShape
    WelcomeShapeType.Square -> RoundedCornerShape(16.dp)
    WelcomeShapeType.Diamond -> DiamondShape
    WelcomeShapeType.Star -> StarShape
}

private val DiamondShape = androidx.compose.foundation.shape.GenericShape { size, _ ->
    moveTo(size.width * 0.5f, 0f)
    lineTo(size.width, size.height * 0.5f)
    lineTo(size.width * 0.5f, size.height)
    lineTo(0f, size.height * 0.5f)
    close()
}

private val StarShape = androidx.compose.foundation.shape.GenericShape { size, _ ->
    val outerRadius = min(size.width, size.height) * 0.5f
    val innerRadius = outerRadius * 0.46f
    val centerX = size.width * 0.5f
    val centerY = size.height * 0.5f

    for (point in 0 until 10) {
        val radius = if (point % 2 == 0) outerRadius else innerRadius
        val angle = Math.toRadians((-90.0 + point * 36.0))
        val x = centerX + cos(angle).toFloat() * radius
        val y = centerY + sin(angle).toFloat() * radius
        if (point == 0) {
            moveTo(x, y)
        } else {
            lineTo(x, y)
        }
    }
    close()
}

private val EdgeDecorSpecs = listOf(
    EdgeDecorSpec(Alignment.TopStart, size = 68.dp, offsetX = (-26).dp, offsetY = 30.dp, spinDurationMillis = 26000, spinDirection = 1f, colorSlot = 0),
    EdgeDecorSpec(Alignment.TopStart, size = 44.dp, offsetX = 42.dp, offsetY = 8.dp, spinDurationMillis = 32000, spinDirection = -1f, colorSlot = 3),
    EdgeDecorSpec(Alignment.TopEnd, size = 82.dp, offsetX = 26.dp, offsetY = 16.dp, spinDurationMillis = 29000, spinDirection = -1f, colorSlot = 1),
    EdgeDecorSpec(Alignment.TopEnd, size = 52.dp, offsetX = (-42).dp, offsetY = 64.dp, spinDurationMillis = 34000, spinDirection = 1f, colorSlot = 2),
    EdgeDecorSpec(Alignment.CenterStart, size = 56.dp, offsetX = (-24).dp, offsetY = (-22).dp, spinDurationMillis = 28000, spinDirection = 1f, colorSlot = 2),
    EdgeDecorSpec(Alignment.CenterStart, size = 40.dp, offsetX = 18.dp, offsetY = 82.dp, spinDurationMillis = 36000, spinDirection = -1f, colorSlot = 0),
    EdgeDecorSpec(Alignment.CenterEnd, size = 72.dp, offsetX = 24.dp, offsetY = (-16).dp, spinDurationMillis = 27000, spinDirection = -1f, colorSlot = 1),
    EdgeDecorSpec(Alignment.CenterEnd, size = 48.dp, offsetX = (-18).dp, offsetY = 110.dp, spinDurationMillis = 35000, spinDirection = 1f, colorSlot = 3),
    EdgeDecorSpec(Alignment.BottomStart, size = 80.dp, offsetX = (-22).dp, offsetY = (-46).dp, spinDurationMillis = 25000, spinDirection = 1f, colorSlot = 1),
    EdgeDecorSpec(Alignment.BottomStart, size = 46.dp, offsetX = 54.dp, offsetY = (-14).dp, spinDurationMillis = 33000, spinDirection = -1f, colorSlot = 2),
    EdgeDecorSpec(Alignment.BottomEnd, size = 64.dp, offsetX = 22.dp, offsetY = (-64).dp, spinDurationMillis = 30000, spinDirection = -1f, colorSlot = 0),
    EdgeDecorSpec(Alignment.BottomEnd, size = 42.dp, offsetX = (-48).dp, offsetY = (-18).dp, spinDurationMillis = 37000, spinDirection = 1f, colorSlot = 3)
)
