package com.multielma

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  private val navHandler = Handler(Looper.getMainLooper())
  private var navAttempt = 0
  private var navTarget: String? = null
  private var navAccountId: String? = null
  private var navApplicationId: String? = null
  private var navTaskId: String? = null
  private val allowedNavTargets = setOf("applications", "tasks")

  /**
   * Передаёт переход в нативный модуль. На холодном старте модуль создаётся вместе с
   * React-инстансом, поэтому ждём его появления — иначе переход по уведомлению теряется.
   */
  private val navRunnable = object : Runnable {
    override fun run() {
      val module = KeepAliveModule.instance
      if (module == null) {
        if (++navAttempt <= 40) {
          navHandler.postDelayed(this, 250)
        }
        return
      }
      navAttempt = 0
      val target = navTarget
      val accountId = navAccountId
      val applicationId = navApplicationId
      val taskId = navTaskId
      navTarget = null
      navAccountId = null
      navApplicationId = null
      navTaskId = null
      if (target != null) {
        module.handleNavigationIntent(target, accountId, applicationId, taskId)
      }
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MultiElma"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applySecureWindow()
    handleNavIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    applySecureWindow()
  }

  /**
   * Постоянная защита окна: запрет скриншотов и записи экрана (FLAG_SECURE).
   * Флаг ставится при создании и при каждом возврате к активности и никогда не снимается.
   */
  private fun applySecureWindow() {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleNavIntent(intent)
  }

  /** Безопасный id из extras: trim, длина 1..64, без ISO-control; иначе null. */
  private fun sanitizeNavId(value: String?): String? {
    val trimmed = value?.trim() ?: return null
    return trimmed.takeIf { it.length in 1..64 && it.none { c -> c.isISOControl() } }
  }

  private fun handleNavIntent(intent: Intent?) {
    val rawTarget = intent?.getStringExtra("multi_elma_nav")?.trim() ?: return
    if (rawTarget.length > 32 || rawTarget !in allowedNavTargets) {
      return
    }
    val safeAccount = sanitizeNavId(intent.getStringExtra("multi_elma_account"))
    val safeApplication = sanitizeNavId(intent.getStringExtra("multi_elma_application"))
    val safeTask = sanitizeNavId(intent.getStringExtra("multi_elma_task"))
    navHandler.removeCallbacks(navRunnable)
    navAttempt = 0
    navTarget = rawTarget
    navAccountId = safeAccount
    navApplicationId = safeApplication
    navTaskId = safeTask
    navRunnable.run()
  }
}
