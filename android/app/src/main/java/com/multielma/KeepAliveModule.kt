package com.multielma

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ClipData
import android.content.ClipboardManager
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebSettings
import androidx.core.content.FileProvider
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * Exposes the Android "keep alive" primitives to JavaScript under the name "KeepAlive":
 * screen-on flag, background foreground service with a wake lock, and local notifications.
 */
class KeepAliveModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  init {
    instance = this
  }

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> =
      mapOf(KEY_IS_ANDROID to true, KEY_IS_DIAG to (BuildConfig.BUILD_TYPE == "diag"))

  private val secretPrefs: SharedPreferences by lazy {
    val masterKey = MasterKey.Builder(reactApplicationContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    EncryptedSharedPreferences.create(
        reactApplicationContext,
        SECRETS_FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  /** Сохраняет секрет (токен, cookie) в шифрованном виде. */
  @ReactMethod
  fun saveSecret(key: String, value: String, promise: Promise) {
    try {
      val ok = secretPrefs.edit().putString(key, value).commit()
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.reject("secret_save_failed", e)
    }
  }

  /** Возвращает секрет или null, если его нет. */
  @ReactMethod
  fun getSecret(key: String, promise: Promise) {
    try {
      promise.resolve(secretPrefs.getString(key, null))
    } catch (e: Exception) {
      promise.reject("secret_read_failed", e)
    }
  }

  /** Удаляет секрет. */
  @ReactMethod
  fun deleteSecret(key: String, promise: Promise) {
    try {
      val ok = secretPrefs.edit().remove(key).commit()
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.reject("secret_delete_failed", e)
    }
  }

  /** Keeps the screen on while the current Activity is visible (no-op if there is none). */
  @ReactMethod
  fun setKeepScreenOn(enabled: Boolean) {
    val activity = currentActivity ?: return
    activity.runOnUiThread {
      if (enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }
  }

  /**
   * Включает/снимает FLAG_SECURE на текущей Activity: запрещает скриншоты
   * и превью в списке «недавние». Если активности нет — резолвим false
   * (ничего не применяем), исключение на UI-потоке уходит в reject.
   */
  @ReactMethod
  fun setSecureFlag(enabled: Boolean, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    try {
      activity.runOnUiThread {
        try {
          if (enabled) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
          } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
          }
          promise.resolve(true)
        } catch (t: Throwable) {
          promise.reject("SECURE_FLAG_FAILED", t)
        }
      }
    } catch (t: Throwable) {
      promise.reject("SECURE_FLAG_FAILED", t)
    }
  }

  /**
   * Starts [KeepAliveService] as a foreground service ("background_sync" channel, LOW
   * importance). The service itself owns the foreground notification so that it can rebuild
   * it with default text after a system restart (null intent).
   */
  @ReactMethod
  fun startBackgroundSync(title: String?, body: String?, promise: Promise) {
    try {
      ensureChannel(
          CHANNEL_BACKGROUND_SYNC,
          CHANNEL_BACKGROUND_SYNC_NAME,
          NotificationManager.IMPORTANCE_LOW)
      val intent =
          Intent(reactApplicationContext, KeepAliveService::class.java).apply {
            title?.takeIf { it.isNotBlank() }?.let { putExtra(KeepAliveService.EXTRA_TITLE, it) }
            body?.takeIf { it.isNotBlank() }?.let { putExtra(KeepAliveService.EXTRA_BODY, it) }
          }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("KEEP_ALIVE_START_FAILED", t)
    }
  }

  /** Stops [KeepAliveService]; the service releases the wake lock in onDestroy(). */
  @ReactMethod
  fun stopBackgroundSync(promise: Promise) {
    try {
      reactApplicationContext.stopService(Intent(reactApplicationContext, KeepAliveService::class.java))
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("KEEP_ALIVE_STOP_FAILED", t)
    }
  }

  @ReactMethod
  fun isBackgroundSyncRunning(promise: Promise) {
    promise.resolve(KeepAliveService.isRunning)
  }

  /**
   * Posts a local task alert (id 2) on its own "task_alerts" channel (IMPORTANCE_DEFAULT),
   * independently of the foreground service. Silently ignores missing permission.
   */
  @ReactMethod
  fun notify(title: String?, body: String?, sound: Boolean, vibration: Boolean, soundId: String?, volume: Int) {
    try {
      val context = reactApplicationContext
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED) {
        return
      }
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (!manager.areNotificationsEnabled()) {
        return
      }
      ensureChannel(CHANNEL_TASK_ALERTS, CHANNEL_TASK_ALERTS_NAME, NotificationManager.IMPORTANCE_DEFAULT)
      manager.notify(TASK_ALERT_NOTIFICATION_ID, buildNotification(title, body, CHANNEL_TASK_ALERTS))
      if (vibration) {
        vibrateAlert()
      }
      if (sound) {
        playSoundOnce(soundId, volume)
      }
    } catch (t: Throwable) {
      // Best effort: never crash the JS caller because of a notification issue.
    }
  }

  /** Opens the system dialog that asks the user to exempt the app from battery optimization. */
  @ReactMethod
  fun requestBatteryOptimizationSettings() {
    try {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
      intent.data = Uri.parse("package:" + reactApplicationContext.packageName)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
    } catch (t: Throwable) {
      // The dialog may be unavailable on some OEM builds — keep it silent.
    }
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    try {
      val powerManager = reactApplicationContext.getSystemService(PowerManager::class.java)
      if (powerManager == null) {
        promise.resolve(false)
        return
      }
      promise.resolve(powerManager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    } catch (t: Throwable) {
      promise.reject("BATTERY_OPT_CHECK_FAILED", t)
    }
  }

  /**
   * Синхронно возвращает User-Agent без маркеров WebView (`; wv`, `Version/4.0 `),
   * чтобы reCAPTCHA в CaptchaModal не видела «webview-сигнатуру» и реже выдавала
   * challenge. При ошибке — пустая строка (JS тогда не передаёт userAgent).
   */
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getCaptchaUserAgent(): String {
    return try {
      WebSettings.getDefaultUserAgent(reactApplicationContext)
          .replace("; wv", "")
          .replace("Version/4.0 ", "")
    } catch (e: Exception) {
      ""
    }
  }

  @ReactMethod
  fun getCookies(url: String, promise: Promise) {
    val cm = CookieManager.getInstance()
    UiThreadUtil.runOnUiThread {
      try {
        try { cm.flush() } catch (_: Throwable) {}
        val value = cm.getCookie(url)
        promise.resolve(value)
      } catch (e: Throwable) {
        promise.resolve(null)
      }
    }
  }

  @ReactMethod
  fun copyToClipboard(text: String) {
    UiThreadUtil.runOnUiThread {
      try {
        val cm = reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("MultiElma", text))
      } catch (_: Throwable) {
      }
    }
  }

  /**
   * Отдаёт текст файлом через системный «Поделиться» (ACTION_SEND + content-Uri),
   * чтобы большой лог не уходил в Intent текстом и не подвешивал приложение (ANR).
   * Запись файла — в фоновом потоке, запуск chooser'а — строго на главном потоке.
   */
  @ReactMethod
  fun shareTextFile(fileName: String, content: String, title: String, promise: Promise) {
    try {
      val safeName = sanitizeFileName(fileName)
      val ctx = reactApplicationContext
      Thread {
        try {
          val dir = File(ctx.cacheDir, DIAG_DIR)
          dir.mkdirs()
          val file = File(dir, safeName)
          file.writeText(content)
          UiThreadUtil.runOnUiThread {
            try {
              val uri = FileProvider.getUriForFile(ctx, ctx.packageName + FILE_PROVIDER_SUFFIX, file)
              val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              }
              val chooser = Intent.createChooser(send, title).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              (currentActivity ?: ctx).startActivity(chooser)
              promise.resolve(true)
            } catch (t: Throwable) {
              promise.reject("diag_share", t)
            }
          }
        } catch (t: Throwable) {
          promise.reject("diag_share", t)
        }
      }.start()
    } catch (t: Throwable) {
      promise.reject("diag_share", t)
    }
  }

  /** Имя файла, безопасное для File(dir, name): [A-Za-z0-9._-], иначе имя по умолчанию. */
  private fun sanitizeFileName(fileName: String): String {
    val name = fileName.trim()
    if (name.isEmpty() || name == "." || name == ".." || !SAFE_FILE_NAME_REGEX.matches(name)) {
      return DEFAULT_DIAG_FILE_NAME
    }
    return name
  }

  // --- Application alerts (sound + vibration + notification) ---

  private var mediaPlayer: MediaPlayer? = null
  private var repeatCountRemaining = 0
  private val alertHandler = Handler(Looper.getMainLooper())
  private var alertReceiverRegistered = false
  private var currentVibrator: Vibrator? = null

  private var audioFocusRequest: AudioFocusRequest? = null
  private val alertFocusListener = AudioManager.OnAudioFocusChangeListener { }

  private val SAFETY_TIMEOUT_MS = 60_000L

  private val safetyStopRunnable = Runnable { stopAlertInternal() }

  /**
   * Идентификатор звука из настроек -> источник MediaPlayer:
   *   raw:<имя>  — встроенный ресурс res/raw;
   *   system     — системный звук уведомлений по умолчанию;
   *   uri:<uri>  — произвольный content/ringtone-uri;
   *   пусто/иное — резервный встроенный сигнал.
   */
  private fun createAlertPlayer(soundId: String?): MediaPlayer? {
    val context = reactApplicationContext
    val fallback = R.raw.notification_alert
    return try {
      val spec = soundId?.trim().orEmpty()
      when {
        spec.isEmpty() -> MediaPlayer.create(context, fallback)
        spec.startsWith("raw:") -> {
          val resId =
              context.resources.getIdentifier(spec.removePrefix("raw:"), "raw", context.packageName)
          MediaPlayer.create(context, if (resId != 0) resId else fallback)
        }
        spec == "system" ->
            MediaPlayer.create(context, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        spec.startsWith("uri:") -> MediaPlayer.create(context, Uri.parse(spec.removePrefix("uri:")))
        else -> MediaPlayer.create(context, fallback)
      }
    } catch (_: Throwable) {
      null
    }
  }

  /** Вибрация уведомления; отсутствие разрешения/поддержки игнорируется. */
  private fun vibrateAlert() {
    try {
      val context = reactApplicationContext
      val pattern = longArrayOf(0, 800, 250, 800, 250, 1200)
      @Suppress("DEPRECATION")
      val vibrator: Vibrator? =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
          } else {
            context.getSystemService(Vibrator::class.java)
          }
      if (vibrator != null && vibrator.hasVibrator()) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(pattern, -1)
        }
        currentVibrator = vibrator
      }
    } catch (_: SecurityException) {
      // Нет разрешения VIBRATE — пропускаем
    } catch (_: Throwable) {
      // Устройство не поддерживает вибрацию
    }
  }

  /** Аудио-фокус на время сигнала: музыка приглушается (играем как медиа-поток). */
  private fun requestAlertAudioFocus(): Boolean {
    return try {
      val am = reactApplicationContext.getSystemService(AudioManager::class.java) ?: return false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
            .setOnAudioFocusChangeListener(alertFocusListener)
            .build()
        audioFocusRequest = req
        am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(
            alertFocusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      }
    } catch (_: Throwable) {
      false
    }
  }

  private fun abandonAlertAudioFocus() {
    try {
      val am = reactApplicationContext.getSystemService(AudioManager::class.java)
      if (am != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
        } else {
          @Suppress("DEPRECATION")
          am.abandonAudioFocus(alertFocusListener)
        }
      }
    } catch (_: Throwable) {
      // Ignore
    }
    audioFocusRequest = null
  }

  /** Одиночное воспроизведение выбранного звука (уведомление-задача). */
  private fun playSoundOnce(soundId: String?, volume: Int) {
    try {
      stopAlertInternal()
      val mp = createAlertPlayer(soundId) ?: return
      prepareAlertPlayer(mp, volume)
      mp.setOnCompletionListener { stopAlertInternal() }
      requestAlertAudioFocus()
      mp.start()
      mediaPlayer = mp
      alertHandler.removeCallbacks(safetyStopRunnable)
      alertHandler.postDelayed(safetyStopRunnable, SAFETY_TIMEOUT_MS)
    } catch (_: Throwable) {
      // Звук недоступен
    }
  }

  /** Общая подготовка плеера: аудио-поток уведомления и громкость 0..10. */
  private fun prepareAlertPlayer(mp: MediaPlayer, volume: Int) {
    mp.setAudioAttributes(
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build())
    val level = volume.coerceIn(0, 10) / 10f
    mp.setVolume(level, level)
  }

  /**
   * Проиграть выбранный звук один раз — предпрослушивание в настройках.
   * Отдельный временный плеер: активный сигнал (`mediaPlayer`, safety-timer)
   * не останавливается и не перезаписывается.
   */
  @ReactMethod
  fun previewAlertSound(soundId: String?, volume: Int) {
    try {
      val mp = createAlertPlayer(soundId) ?: return
      prepareAlertPlayer(mp, volume)
      mp.setOnCompletionListener {
        try {
          it.release()
        } catch (_: Throwable) {
          // Ignore
        }
      }
      requestAlertAudioFocus()
      mp.start()
    } catch (_: Throwable) {
      // Звук недоступен
    }
  }

  /** BroadcastReceiver для остановки звука при тапе (contentIntent) и смахивании (deleteIntent). */
  private val alertStopReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      stopAlertInternal()
    }
  }

  @ReactMethod
  fun alertNewItem(title: String?, body: String?, sound: Boolean, vibration: Boolean, repeatCount: Int, accountId: String?, soundId: String?, volume: Int) {
    try {
      // Останавливаем предыдущий звук/вибрацию перед запуском нового
      stopAlertInternal()

      val safeRepeat = repeatCount.coerceIn(1, 10)

      // --- Вибрация ---
      if (vibration) {
        vibrateAlert()
      }

      // --- Звук через MediaPlayer (звук выбирается в настройках) ---
      if (sound) {
        try {
          val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
          val mp = createAlertPlayer(soundId)
          if (mp != null) {
            val level = volume.coerceIn(0, 10) / 10f
            mp.setAudioAttributes(attrs)
            mp.setVolume(level, level)
            mp.isLooping = true
            repeatCountRemaining = safeRepeat
            mp.setOnCompletionListener {
              repeatCountRemaining--
              if (repeatCountRemaining > 0) {
                try {
                  it.seekTo(0)
                  it.start()
                } catch (_: Throwable) {
                  stopAlertInternal()
                }
              } else {
                stopAlertInternal()
              }
            }
            requestAlertAudioFocus()
            mp.start()
            mediaPlayer = mp
            // Страховочный таймаут
            alertHandler.removeCallbacks(safetyStopRunnable)
            alertHandler.postDelayed(safetyStopRunnable, SAFETY_TIMEOUT_MS)
          }
        } catch (_: Throwable) {
          // Звук недоступен
        }
      }

      // --- Уведомление на канале application_alerts_v3 ---
      publishApplicationAlert(title, body, accountId)
    } catch (_: Throwable) {
      // Best effort: never crash JS
    }
  }

  @ReactMethod
  fun stopAlert() {
    try {
      stopAlertInternal()
    } catch (_: Throwable) {
      // Best effort
    }
  }

  private fun stopAlertInternal() {
    try {
      alertHandler.removeCallbacks(safetyStopRunnable)
      mediaPlayer?.let {
        if (it.isPlaying) {
          it.stop()
        }
        it.release()
      }
      mediaPlayer = null
      repeatCountRemaining = 0
      currentVibrator?.cancel()
      currentVibrator = null
      unregisterAlertReceiver()
      abandonAlertAudioFocus()
    } catch (_: Throwable) {
      // Ignore
    }
  }

  private fun registerAlertReceiver() {
    if (alertReceiverRegistered) return
    val filter = IntentFilter(ACTION_ALERT_STOP)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactApplicationContext.registerReceiver(alertStopReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      reactApplicationContext.registerReceiver(alertStopReceiver, filter)
    }
    alertReceiverRegistered = true
  }

  private fun unregisterAlertReceiver() {
    if (!alertReceiverRegistered) return
    try {
      reactApplicationContext.unregisterReceiver(alertStopReceiver)
    } catch (_: Throwable) {
      // Already unregistered
    }
    alertReceiverRegistered = false
  }

  private fun publishApplicationAlert(title: String?, body: String?, accountId: String?) {
    try {
      val context = reactApplicationContext
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED) {
        return
      }
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (!manager.areNotificationsEnabled()) {
        return
      }
      ensureChannel(CHANNEL_APPLICATION_ALERTS, CHANNEL_APPLICATION_ALERTS_NAME, NotificationManager.IMPORTANCE_HIGH)

      // Регистрируем receiver для обработки смахивания
      registerAlertReceiver()

      // deleteIntent — смахивание останавливает звук
      val stopIntent = Intent(ACTION_ALERT_STOP).apply {
        setPackage(context.packageName)
      }
      val deletePendingIntent = PendingIntent.getBroadcast(
        context, 1, stopIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      // contentIntent — тап открывает приложение на экране заявок с фильтром учётки
      val contentIntent = PendingIntent.getActivity(
        context,
        5,
        Intent(context, MainActivity::class.java).apply {
          putExtra("multi_elma_nav", "applications")
          accountId?.takeIf { it.isNotBlank() }?.let { putExtra("multi_elma_account", it) }
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

      val contentTitle = title?.takeIf { it.isNotBlank() } ?: DEFAULT_TITLE
      val contentText = body?.takeIf { it.isNotBlank() }

      val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(context, CHANNEL_APPLICATION_ALERTS)
        } else {
          Notification.Builder(context)
        }
      builder
        .setSmallIcon(R.drawable.ic_stat_notification)
        .setContentTitle(contentTitle)
        .setContentIntent(contentIntent)
        .setDeleteIntent(deletePendingIntent)
        .setAutoCancel(true)
      if (contentText != null) {
        builder.setContentText(contentText)
      }
      manager.notify(APPLICATION_ALERT_NOTIFICATION_ID, builder.build())
    } catch (_: Throwable) {
      // Best effort
    }
  }

  private fun ensureChannel(channelId: String, channelName: String, importance: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = reactApplicationContext.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(channelId) == null) {
      val channel = NotificationChannel(channelId, channelName, importance)
      // Звук и вибрацию воспроизводим сами (MediaPlayer/Vibrator), чтобы их можно было
      // регулировать из приложения; канал держим «тихим», иначе сигнал звучал бы дважды.
      channel.setSound(null, null)
      channel.enableVibration(false)
      manager.createNotificationChannel(channel)
      // После бампа id старые каналы остаются висеть в системных настройках — чистим их.
      deleteLegacyChannels(manager, channelId)
    }
  }

  /**
   * Удаляет устаревшие каналы (старые id после бампа), чтобы они не висели в
   * системных настройках. Текущий канал [currentChannelId] не трогаем.
   */
  private fun deleteLegacyChannels(manager: NotificationManager, currentChannelId: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    for (id in LEGACY_CHANNEL_IDS) {
      if (id == currentChannelId) {
        continue
      }
      try {
        manager.deleteNotificationChannel(id)
      } catch (_: Throwable) {
        // Best effort: не мешаем показу уведомления из-за чистки каналов
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun buildNotification(title: String?, body: String?, channelId: String): Notification {
    val contentTitle = title?.takeIf { it.isNotBlank() } ?: DEFAULT_TITLE
    val contentText = body?.takeIf { it.isNotBlank() }
    val contentIntent =
        PendingIntent.getActivity(
            reactApplicationContext,
            0,
            Intent(reactApplicationContext, MainActivity::class.java).apply {
              flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(reactApplicationContext, channelId)
        } else {
          Notification.Builder(reactApplicationContext)
        }
    builder
        .setSmallIcon(R.drawable.ic_stat_notification)
        .setContentTitle(contentTitle)
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
    if (contentText != null) {
      builder.setContentText(contentText)
    }
    return builder.build()
  }

  // --- Нативный тикер планировщика синхронизации ---
  // JS-таймеры в React Native останавливаются, когда приложение свёрнуто, поэтому
  // планировщик опроса учёток просыпается по этому событию.

  private val syncTickerHandler = Handler(Looper.getMainLooper())
  @Volatile private var syncTickerRunning = false

  private val syncTickerRunnable = object : Runnable {
    override fun run() {
      if (!syncTickerRunning) {
        return
      }
      emitSyncTick()
      syncTickerHandler.postDelayed(this, SYNC_TICK_INTERVAL_MS)
    }
  }

  @ReactMethod
  fun startSyncTicker() {
    if (syncTickerRunning) {
      return
    }
    syncTickerRunning = true
    syncTickerHandler.post(syncTickerRunnable)
  }

  @ReactMethod
  fun stopSyncTicker() {
    syncTickerRunning = false
    syncTickerHandler.removeCallbacks(syncTickerRunnable)
  }

  private fun emitSyncTick() {
    try {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_SYNC_TICK, null)
    } catch (_: Throwable) {
      // JS может быть ещё не готов — пропускаем тик
    }
  }

  /**
   * Аналог JS setTimeout на нативном Handler: JS-таймеры не срабатывают, когда
   * приложение свёрнуто, поэтому фоновые задержки выполняются через этот метод.
   * Промис резолвится через [ms] миллисекунд (или сразу, если задержка не нужна).
   */
  @ReactMethod
  fun delay(ms: Double, promise: Promise) {
    val value = ms.toLong()
    if (value <= 0L) {
      promise.resolve(null)
      return
    }
    syncTickerHandler.postDelayed({ promise.resolve(null) }, value)
  }

  // --- Overlay widget ---

  @Volatile
  private var pendingNavigation: String? = null
  @Volatile
  private var pendingAccountId: String? = null

  @ReactMethod
  fun showOverlayWidget(text: String?) {
    try {
      ensureForegroundServiceRunning()
      OverlayWidget.show(reactApplicationContext, text ?: "Обновлено —")
    } catch (_: Throwable) {
      // Best effort
    }
  }

  @ReactMethod
  fun hideOverlayWidget() {
    try {
      OverlayWidget.hide()
    } catch (_: Throwable) {
      // Best effort
    }
  }

  @ReactMethod
  fun updateOverlayWidget(text: String) {
    try {
      OverlayWidget.updateText(text)
    } catch (_: Throwable) {
      // Best effort
    }
  }

  @ReactMethod
  fun pulseOverlayWidget() {
    try {
      OverlayWidget.startAlert()
    } catch (_: Throwable) {
      // Best effort
    }
  }

  @ReactMethod
  fun hasOverlayPermission(promise: Promise) {
    promise.resolve(OverlayWidget.hasPermission(reactApplicationContext))
  }

  @ReactMethod
  fun requestOverlayPermission() {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + reactApplicationContext.packageName),
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
    } catch (_: Throwable) {
      // Best effort
    }
  }

  @ReactMethod
  fun consumePendingNavigation(promise: Promise) {
    val target = pendingNavigation
    val accountId = pendingAccountId
    pendingNavigation = null
    pendingAccountId = null
    if (target == null) {
      promise.resolve(null)
    } else {
      val map = Arguments.createMap()
      map.putString("target", target)
      map.putString("accountId", accountId)
      promise.resolve(map)
    }
  }

  /**
   * Called from MainActivity when the app is brought to front via the overlay widget tap.
   * Sends a navigation event to JS and stores it for consumePendingNavigation.
   */
  fun handleNavigationIntent(target: String, accountId: String?) {
    pendingNavigation = target
    pendingAccountId = accountId
    stopAlertInternal()
    try {
      val payload = Arguments.createMap()
      payload.putString("target", target)
      payload.putString("accountId", accountId)
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAVIGATION, payload)
    } catch (_: Throwable) {
      // JS side may not be ready yet; pendingNavigation will handle it
    }
  }

  private fun ensureForegroundServiceRunning() {
    try {
      if (!KeepAliveService.isRunning) {
        val intent = Intent(reactApplicationContext, KeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          reactApplicationContext.startForegroundService(intent)
        } else {
          reactApplicationContext.startService(intent)
        }
      }
    } catch (_: Throwable) {
      // Best effort
    }
  }

  companion object {
    private const val NAME = "KeepAlive"
    private const val KEY_IS_ANDROID = "isAndroid"
    private const val KEY_IS_DIAG = "isDiag"
    private const val SECRETS_FILE = "multielma_secrets"

    @Volatile
    var instance: KeepAliveModule? = null
      private set
    const val CHANNEL_BACKGROUND_SYNC = "background_sync"
    const val CHANNEL_TASK_ALERTS = "task_alerts_v2"
    private const val CHANNEL_BACKGROUND_SYNC_NAME = "Background sync"
    private const val CHANNEL_TASK_ALERTS_NAME = "Task alerts"
    private const val TASK_ALERT_NOTIFICATION_ID = 2
    private const val DEFAULT_TITLE = "MultiElma"
    private const val CHANNEL_APPLICATION_ALERTS = "application_alerts_v3"
    private const val CHANNEL_APPLICATION_ALERTS_NAME = "Application alerts"
    /** Старые id каналов, оставшиеся после бампа — удаляются при создании нового канала. */
    private val LEGACY_CHANNEL_IDS = listOf("task_alerts", "application_alerts_v2")
    private const val APPLICATION_ALERT_NOTIFICATION_ID = 3
    private const val ACTION_ALERT_STOP = "com.multielma.ACTION_ALERT_STOP"
    private const val EVENT_NAVIGATION = "multiElmaNavigate"
    private const val EVENT_SYNC_TICK = "multiElmaSyncTick"
    private const val SYNC_TICK_INTERVAL_MS = 1000L
    private const val DIAG_DIR = "diag"
    private const val FILE_PROVIDER_SUFFIX = ".fileprovider"
    private const val DEFAULT_DIAG_FILE_NAME = "multielma-diag.txt"
    private val SAFE_FILE_NAME_REGEX = Regex("[A-Za-z0-9._-]+")
  }
}
