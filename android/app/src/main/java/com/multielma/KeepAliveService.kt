package com.multielma

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Foreground service that keeps the process alive in the background: it holds a partial wake
 * lock and a high-performance wifi lock and shows a low-importance notification on the
 * "background_sync" channel. JS starts and stops it through [KeepAliveModule].
 */
class KeepAliveService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (isRunning) {
      return START_STICKY
    }
    ensureNotificationChannel()
    // A null intent means the system restarted the process (START_STICKY): rebuild the
    // notification with default text since there are no extras anymore.
    val title = intent?.getStringExtra(EXTRA_TITLE)
    val body = intent?.getStringExtra(EXTRA_BODY)
    val notification = buildNotification(title, body)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    acquireWakeLock()
    acquireWifiLock()
    isRunning = true
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    isRunning = false
    releaseWakeLock()
    releaseWifiLock()
    stopForegroundCompat()
    super.onDestroy()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW))
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) {
      return
    }
    val powerManager = getSystemService(PowerManager::class.java) ?: return
    val lock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    lock.acquire()
    wakeLock = lock
  }

  private fun releaseWakeLock() {
    val lock = wakeLock ?: return
    if (lock.isHeld) {
      lock.release()
    }
    wakeLock = null
  }

  /**
   * High-performance wifi lock: keeps the wifi radio awake while the service runs, so the
   * background sync (and its websocket) is not starved when the screen turns off.
   * Best-effort: any failure must not break the service.
   */
  @Suppress("DEPRECATION")
  private fun acquireWifiLock() {
    try {
      if (wifiLock?.isHeld == true) {
        return
      }
      val wifiManager = applicationContext.getSystemService(WifiManager::class.java) ?: return
      val lock =
          wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, WIFI_LOCK_TAG)
      lock.acquire()
      wifiLock = lock
    } catch (_: Exception) {
      // best-effort
    }
  }

  private fun releaseWifiLock() {
    try {
      val lock = wifiLock ?: return
      if (lock.isHeld) {
        lock.release()
      }
      wifiLock = null
    } catch (_: Exception) {
      // best-effort
    }
  }

  @Suppress("DEPRECATION")
  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      stopForeground(true)
    }
  }

  @Suppress("DEPRECATION")
  private fun buildNotification(title: String?, body: String?): Notification {
    val contentIntent =
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
              flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(this, CHANNEL_ID)
        } else {
          Notification.Builder(this)
        }
    builder
        .setSmallIcon(R.drawable.ic_stat_notification)
        .setContentTitle(title?.takeIf { it.isNotBlank() } ?: DEFAULT_TITLE)
        .setContentText(body?.takeIf { it.isNotBlank() } ?: DEFAULT_BODY)
        .setContentIntent(contentIntent)
    return builder.build()
  }

  companion object {
    const val CHANNEL_ID = "background_sync"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val NOTIFICATION_ID = 1

    @Volatile
    var isRunning = false

    private const val CHANNEL_NAME = "Background sync"
    private const val WAKE_LOCK_TAG = "MultiElma:KeepAliveService"
    private const val WIFI_LOCK_TAG = "MultiElma:KeepAliveServiceWifi"
    private const val DEFAULT_TITLE = "MultiElma"
    private const val DEFAULT_BODY = "Фоновая синхронизация активна"
  }
}
