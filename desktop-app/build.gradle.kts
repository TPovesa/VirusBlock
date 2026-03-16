import org.gradle.api.file.DuplicatesStrategy
import org.gradle.jvm.tasks.Jar

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.desktop)
}

val neuralvVersion = providers.gradleProperty("neuralv.version").get()

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":desktop-core"))
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation(compose.foundation)
    implementation(compose.materialIconsExtended)
    implementation(libs.kotlinx.coroutines.swing)
}

compose.desktop {
    application {
        mainClass = "com.neuralv.desktop.app.MainKt"

        nativeDistributions {
            packageName = "NeuralV"
            packageVersion = neuralvVersion
            description = "NeuralV desktop security client"
            vendor = "NeuralV"
            val windowsIcon = rootProject.file("branding/generated/neuralv.ico")
            if (windowsIcon.exists()) {
                iconFile.set(windowsIcon)
            }
        }
    }
}

tasks.register<Jar>("portableDesktopJar") {
    group = "distribution"
    description = "Builds a portable fat jar for NeuralV desktop."
    archiveBaseName.set("neuralv-desktop")
    archiveClassifier.set("portable")
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE

    manifest {
        attributes["Main-Class"] = "com.neuralv.desktop.app.MainKt"
    }

    from(sourceSets.main.get().output)
    dependsOn(tasks.named("compileKotlin"), tasks.named("processResources"))
    from({
        configurations.runtimeClasspath.get()
            .filter { it.exists() }
            .map { if (it.isDirectory) it else zipTree(it) }
    })

    exclude(
        "META-INF/*.RSA",
        "META-INF/*.SF",
        "META-INF/*.DSA"
    )
}
