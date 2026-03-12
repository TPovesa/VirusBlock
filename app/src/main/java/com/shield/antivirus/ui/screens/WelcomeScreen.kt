package com.shield.antivirus.ui.screens

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.shield.antivirus.R
import com.shield.antivirus.ui.components.ShieldBackdrop
import com.shield.antivirus.ui.components.ShieldPrimaryButtonColors
import com.shield.antivirus.ui.components.WelcomeEdgeDecorations
import com.shield.antivirus.ui.components.shieldBottomInsets

@Composable
fun WelcomeScreen(
    guestAvailable: Boolean,
    onLoginClick: () -> Unit,
    onRegisterClick: () -> Unit,
    onGuestClick: () -> Unit
) {
    val context = LocalContext.current
    val (parallaxX, parallaxY) = rememberSensorParallax(context)
    ShieldBackdrop {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(horizontal = 20.dp, vertical = 20.dp)
        ) {
            WelcomeEdgeDecorations(
                modifier = Modifier.fillMaxSize(),
                parallaxX = parallaxX,
                parallaxY = parallaxY
            )
            Image(
                painter = painterResource(id = R.drawable.shield_logo_transparent),
                contentDescription = null,
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth(0.62f)
                    .graphicsLayer {
                        translationX = parallaxX * 22f
                        translationY = parallaxY * 16f
                        rotationZ = parallaxX * 2f
                    }
                    .alpha(0.96f),
                contentScale = ContentScale.Fit
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .shieldBottomInsets()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (!guestAvailable) {
                    Text(
                        text = "Гостевой режим закрыт",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                Button(
                    onClick = onLoginClick,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ShieldPrimaryButtonColors(),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Text("Войти")
                }
                OutlinedButton(
                    onClick = onRegisterClick,
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Text("Зарегистрироваться")
                }
                if (guestAvailable) {
                    OutlinedButton(
                        onClick = onGuestClick,
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium
                    ) {
                        Text("Войти как гость")
                    }
                }
            }
        }
    }
}

@Composable
private fun rememberSensorParallax(context: Context): Pair<Float, Float> {
    var x by remember { mutableFloatStateOf(0f) }
    var y by remember { mutableFloatStateOf(0f) }

    DisposableEffect(context) {
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        if (manager == null) {
            onDispose { }
        } else {
            val rotationSensor = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            val accelSensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            val sensor = rotationSensor ?: accelSensor
            if (sensor == null) {
                onDispose { }
            } else {
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        val next = if (event.sensor.type == Sensor.TYPE_ROTATION_VECTOR) {
                            val rotationMatrix = FloatArray(9)
                            val orientation = FloatArray(3)
                            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                            SensorManager.getOrientation(rotationMatrix, orientation)
                            val roll = orientation[2].coerceIn(-0.9f, 0.9f) / 0.9f
                            val pitch = orientation[1].coerceIn(-0.9f, 0.9f) / 0.9f
                            roll to pitch
                        } else {
                            val nx = (-event.values[0] / SensorManager.GRAVITY_EARTH).coerceIn(-1f, 1f)
                            val ny = (event.values[1] / SensorManager.GRAVITY_EARTH).coerceIn(-1f, 1f)
                            nx to ny
                        }
                        x = (x * 0.88f) + (next.first * 0.12f)
                        y = (y * 0.88f) + (next.second * 0.12f)
                    }

                    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
                }

                manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
                onDispose { manager.unregisterListener(listener) }
            }
        }
    }

    return x to y
}
