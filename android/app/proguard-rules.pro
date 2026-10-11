# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- MultiElma (E11: R8/minify для release) ---------------------------------

# Наши нативные классы: JNI/рефлексия, имена и члены классов не обрезаем.
-keep class com.multielma.** { *; }

# Мосты React Native: методы, вызываемые из JS через аннотацию @ReactMethod.
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod *; }

# Классы, к которым обращается JS/рефлексия RN по имени.
-keep class * implements com.facebook.react.ReactPackage { *; }
-keep class * extends com.facebook.react.bridge.ReactContextBaseJavaModule { *; }

# ReactPackage/модули, регистрируемые через рефлексию.
-keep class * extends com.facebook.react.ReactContext { *; }
-keep class com.facebook.react.ReactActivity { *; }
-keep class com.facebook.react.ReactActivityDelegate { *; }
-keep class com.facebook.react.ReactInstanceManager { *; }
