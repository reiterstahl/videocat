plugins {
    alias(libs.plugins.android.application)
}

// Release signing comes from the environment (GitHub Actions secrets), never from the repository.
// Without it the release build comes out unsigned, which is fine for checking that it builds.
val releaseKeystore: String? = System.getenv("VIDEOCAT_ANDROID_KEYSTORE")?.takeIf { it.isNotBlank() }

android {
    namespace = "app.videocat.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.videocat.android"
        minSdk = 26
        targetSdk = 36
        // versionCode goes up by one with every published build; Play and Android refuse a lower one.
        versionCode = 4
        versionName = "0.4.0"
        // The FFmpeg decoder ships native code: phones (ARM) and x86_64 emulators and Chromebooks.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("VIDEOCAT_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("VIDEOCAT_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("VIDEOCAT_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            // Installs next to the release build instead of replacing it.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    // No Google-encrypted dependency list in the APK: it means nothing to anyone else and F-Droid refuses it.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // Versions go up on purpose (a release at least two weeks old), not when lint sees a newer one.
        // targetSdk stays on what Google Play asks for until the app is tested on the next one.
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable", "OldTargetApi")
    }
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.core)
    implementation(libs.androidx.splashscreen)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)
    implementation(libs.media3.session)
    implementation(libs.media3.ffmpeg)
    implementation(libs.androidx.biometric)

    testImplementation(libs.junit)
    // org.json is part of Android; on the JVM the unit tests need the real one.
    testImplementation(libs.json)
}
