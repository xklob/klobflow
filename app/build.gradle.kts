import java.util.Properties
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val signingFile = providers.environmentVariable("KLOBFLOW_SIGNING_PROPERTIES").orNull?.let(::File)
    ?: rootProject.file("signing.properties")
val signing = if (signingFile.isFile) Properties().apply { signingFile.inputStream().use(::load) } else null
android {
    namespace = "com.caleb.klobflow"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.caleb.klobflow"
        minSdk = 29
        targetSdk = 36
        versionCode = 16
        versionName = "0.13.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    signingConfigs {
        if (signing != null) create("release") {
            storeFile = signingFile.parentFile.resolve(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        release {
            if (signing != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.06.01"))
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.camera:camera-camera2:1.5.3")
    implementation("androidx.camera:camera-lifecycle:1.5.3")
    implementation("androidx.camera:camera-video:1.5.3")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}

// Both interfaces ship the exact same mode tutorials.
val copyPracticeGuides by tasks.registering(Copy::class) {
    from(rootProject.file("companion/public/practice-guides.json"))
    into(layout.buildDirectory.dir("generated/practiceAssets"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/practiceAssets"))
tasks.named("preBuild").configure { dependsOn(copyPracticeGuides) }
