plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNo = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "tv.stark.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "tv.stark.app"
        minSdk = 22            // Fire OS 5 and newer
        targetSdk = 34
        versionCode = buildNo
        versionName = "4.22.$buildNo"
    }

    // one fixed key, so every new build installs over the last one on the TV
    signingConfigs {
        create("stark") {
            storeFile = file("starktv.keystore")
            storePassword = "starktv"
            keyAlias = "starktv"
            keyPassword = "starktv"
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("stark")
        }
        getByName("debug") {
            signingConfig = signingConfigs.getByName("stark")
        }
    }
    // two builds of the same app: "tv" (Fire Stick – installs its own updates) and "phone" (no install permission,
    // so Google Play Protect doesn't warn – updates download in the browser instead)
    flavorDimensions += "device"
    productFlavors {
        create("tv") { dimension = "device" }
        create("phone") { dimension = "device" }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

dependencies {
    val media3 = "1.5.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    // FFmpeg audio decoders (MP2, AC-3, E-AC-3, DTS…) for channels the TV can't decode itself
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.5.0+1")
    implementation("androidx.annotation:annotation:1.8.2")
}
