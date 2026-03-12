package com.shield.antivirus.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ContainedLoadingIndicator
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.LoadingIndicatorDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.input.pointer.consume
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

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

            val scope = rememberCoroutineScope()
            val manualRotation = remember(index) { Animatable(0f) }
            var figureStyle by rememberSaveable(index) {
                mutableStateOf(
                    if (spec.useContainedPolygons) {
                        WelcomeFigureStyle.Contained
                    } else {
                        WelcomeFigureStyle.Indeterminate
                    }
                )
            }
            var sizeIndex by rememberSaveable(index) { mutableIntStateOf(index % spec.sizeVariants.size) }

            LaunchedEffect(sizeIndex) {
                if (sizeIndex < 0 || sizeIndex >= spec.sizeVariants.size) {
                    sizeIndex = 0
                }
            }

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
                    .size(spec.sizeVariants[sizeIndex])
                    .pointerInput(index) {
                        detectTapGestures {
                            figureStyle = figureStyle.next()
                            sizeIndex = (sizeIndex + 1) % spec.sizeVariants.size
                            scope.launch {
                                manualRotation.snapTo(manualRotation.value + 16f)
                            }
                        }
                    }
                    .pointerInput(index) {
                        var tracker = VelocityTracker()
                        detectDragGestures(
                            onDragStart = {
                                tracker = VelocityTracker()
                                scope.launch { manualRotation.stop() }
                            },
                            onDragEnd = {
                                val velocity = tracker.calculateVelocity()
                                val spinVelocity =
                                    ((velocity.x + (velocity.y * 0.35f)) * 0.02f).coerceIn(-980f, 980f)
                                scope.launch {
                                    manualRotation.animateDecay(
                                        initialVelocity = spinVelocity,
                                        animationSpec = exponentialDecay(frictionMultiplier = 2.25f)
                                    )
                                }
                            },
                            onDragCancel = { scope.launch { manualRotation.stop() } },
                            onDrag = { change, dragAmount ->
                                tracker.addPosition(change.uptimeMillis, change.position)
                                change.consume()
                                scope.launch {
                                    manualRotation.snapTo(
                                        manualRotation.value + ((dragAmount.x + dragAmount.y * 0.35f) * 0.52f)
                                    )
                                }
                            }
                        )
                    }
                    .graphicsLayer {
                        translationX = driftX + parallaxX.coerceIn(-1f, 1f) * (spec.parallaxFactor * 26f)
                        translationY = driftY + parallaxY.coerceIn(-1f, 1f) * (spec.parallaxFactor * 20f)
                        rotationZ = rotation + manualRotation.value
                    }
            ) {
                when (figureStyle) {
                    WelcomeFigureStyle.Indeterminate -> {
                        LoadingIndicator(
                            modifier = Modifier.fillMaxSize(),
                            color = color,
                            polygons = LoadingIndicatorDefaults.IndeterminateIndicatorPolygons
                        )
                    }
                    WelcomeFigureStyle.Contained -> {
                        LoadingIndicator(
                            modifier = Modifier.fillMaxSize(),
                            color = color,
                            polygons = LoadingIndicatorDefaults.ContainedIndicatorPolygons
                        )
                    }
                    WelcomeFigureStyle.ContainerIndeterminate -> {
                        ContainedLoadingIndicator(
                            modifier = Modifier.fillMaxSize(),
                            containerColor = color.copy(alpha = 0.22f),
                            indicatorColor = color,
                            polygons = LoadingIndicatorDefaults.IndeterminateIndicatorPolygons
                        )
                    }
                    WelcomeFigureStyle.ContainerContained -> {
                        ContainedLoadingIndicator(
                            modifier = Modifier.fillMaxSize(),
                            containerColor = color.copy(alpha = 0.22f),
                            indicatorColor = color,
                            polygons = LoadingIndicatorDefaults.ContainedIndicatorPolygons
                        )
                    }
                }
            }
        }
    }
}

private enum class WelcomeFigureStyle {
    Indeterminate,
    Contained,
    ContainerIndeterminate,
    ContainerContained;

    fun next(): WelcomeFigureStyle = when (this) {
        Indeterminate -> Contained
        Contained -> ContainerIndeterminate
        ContainerIndeterminate -> ContainerContained
        ContainerContained -> Indeterminate
    }
}

private data class WelcomeShapeSpec(
    val alignment: Alignment,
    val sizeVariants: List<Dp>,
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
    WelcomeShapeSpec(
        Alignment.TopStart,
        sizeVariants = listOf(50.dp, 58.dp, 66.dp),
        offsetX = (-20).dp,
        offsetY = 20.dp,
        durationMs = 12000,
        spinDirection = 1f,
        colorSlot = 0,
        parallaxFactor = 1.0f,
        oscillationX = 20f,
        oscillationY = 16f,
        useContainedPolygons = false
    ),
    WelcomeShapeSpec(
        Alignment.TopEnd,
        sizeVariants = listOf(56.dp, 64.dp, 74.dp),
        offsetX = 18.dp,
        offsetY = 40.dp,
        durationMs = 13800,
        spinDirection = -1f,
        colorSlot = 1,
        parallaxFactor = 0.9f,
        oscillationX = 18f,
        oscillationY = 14f,
        useContainedPolygons = true
    ),
    WelcomeShapeSpec(
        Alignment.CenterStart,
        sizeVariants = listOf(44.dp, 54.dp, 62.dp),
        offsetX = (-18).dp,
        offsetY = (-26).dp,
        durationMs = 13200,
        spinDirection = 1f,
        colorSlot = 2,
        parallaxFactor = 0.8f,
        oscillationX = 16f,
        oscillationY = 20f,
        useContainedPolygons = true
    ),
    WelcomeShapeSpec(
        Alignment.CenterEnd,
        sizeVariants = listOf(58.dp, 70.dp, 80.dp),
        offsetX = 16.dp,
        offsetY = 12.dp,
        durationMs = 14500,
        spinDirection = -1f,
        colorSlot = 3,
        parallaxFactor = 1.05f,
        oscillationX = 20f,
        oscillationY = 18f,
        useContainedPolygons = false
    ),
    WelcomeShapeSpec(
        Alignment.Center,
        sizeVariants = listOf(40.dp, 48.dp, 56.dp),
        offsetX = 0.dp,
        offsetY = (-148).dp,
        durationMs = 15800,
        spinDirection = 1f,
        colorSlot = 0,
        parallaxFactor = 0.55f,
        oscillationX = 12f,
        oscillationY = 10f,
        useContainedPolygons = false
    ),
    WelcomeShapeSpec(
        Alignment.BottomStart,
        sizeVariants = listOf(58.dp, 68.dp, 78.dp),
        offsetX = (-14).dp,
        offsetY = (-38).dp,
        durationMs = 14100,
        spinDirection = -1f,
        colorSlot = 1,
        parallaxFactor = 0.95f,
        oscillationX = 22f,
        oscillationY = 14f,
        useContainedPolygons = true
    ),
    WelcomeShapeSpec(
        Alignment.BottomEnd,
        sizeVariants = listOf(54.dp, 62.dp, 72.dp),
        offsetX = 24.dp,
        offsetY = (-64).dp,
        durationMs = 12600,
        spinDirection = 1f,
        colorSlot = 2,
        parallaxFactor = 1.1f,
        oscillationX = 18f,
        oscillationY = 20f,
        useContainedPolygons = false
    ),
    WelcomeShapeSpec(
        Alignment.BottomCenter,
        sizeVariants = listOf(46.dp, 52.dp, 60.dp),
        offsetX = 0.dp,
        offsetY = (-20).dp,
        durationMs = 13400,
        spinDirection = -1f,
        colorSlot = 3,
        parallaxFactor = 0.7f,
        oscillationX = 16f,
        oscillationY = 12f,
        useContainedPolygons = true
    )
)
