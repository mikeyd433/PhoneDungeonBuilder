// The story engine, with no Android in it: a port of src/features/playtest/engine.ts.
// Pure JVM so the golden sessions recorded from the TypeScript engine run as plain
// unit tests (GoldenSessionsTest), with no emulator.
plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    testImplementation(kotlin("test"))
    // Runs the bundled web exporter (app/src/main/assets/js/exporter.js) the way the phone does.
    testImplementation("io.github.dokar3:quickjs-kt:1.0.3")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }
