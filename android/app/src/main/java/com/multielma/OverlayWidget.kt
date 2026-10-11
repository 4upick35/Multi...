package com.multielma

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.TextView
import kotlin.math.abs

/**
 * Small floating overlay widget that shows last-refresh time.
 * Managed entirely on the main thread; safe when permission is absent.
 */
object OverlayWidget {

    private const val TAG = "OverlayWidget"

    /** Максимальная длительность мигания виджета (~1 минута). */
    private const val ALERT_MAX_MS = 60_000L

    /** Полупериод мигания (0.5 с). */
    private const val BLINK_HALF_PERIOD_MS = 500L

    /** Обычный фон виджета (полупрозрачный чёрный). */
    private val NORMAL_BG = 0x99000000.toInt()

    /** Алертный фон виджета — заметный зелёный. */
    private val ALERT_BG = 0xCC2E7D32.toInt()

    private var windowManager: WindowManager? = null
    private var textView: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private val handler = Handler(Looper.getMainLooper())
    private var alertAnimator: ObjectAnimator? = null
    private var alertTimeout: Runnable? = null

    /** Заявка пришла, когда виджет был скрыт — мигание стартует сразу после show(). */
    private var alertPending = false

    /** Safe dp → px conversion. */
    private fun dp(context: Context, value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics,
        ).toInt()

    /** Returns true when the system overlay permission has been granted. */
    fun hasPermission(context: Context): Boolean =
        Settings.canDrawOverlays(context)

    /** Creates (but does not add) the LayoutParams for the overlay. */
    private fun createLayoutParams(context: Context): WindowManager.LayoutParams {
        val width = WindowManager.LayoutParams.WRAP_CONTENT
        val height = WindowManager.LayoutParams.WRAP_CONTENT
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        return WindowManager.LayoutParams(
            width, height, type, flags, PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(context, 12)
            y = dp(context, 80)
        }
    }

    /** Фон виджета с фиксированным скруглением. */
    private fun buildBackground(context: Context, color: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(context, 16).toFloat()
        }

    /** Creates the styled TextView widget. */
    private fun createTextView(context: Context): TextView {
        val bg = buildBackground(context, NORMAL_BG)
        return TextView(context).apply {
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 13f
            setPadding(dp(context, 14), dp(context, 8), dp(context, 14), dp(context, 8))
            background = bg
            setShadowLayer(4f, 0f, 1f, 0x66000000)
            gravity = Gravity.CENTER
            isClickable = true
            setOnTouchListener(createDragTouchListener(context))
        }
    }

    /**
     * Перетаскивание виджета: при движении обновляем позицию окна, при коротком тапе
     * без движения — обычный клик (открытие приложения).
     */
    private fun createDragTouchListener(context: Context): View.OnTouchListener {
        val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        return object : View.OnTouchListener {
            private var startRawX = 0f
            private var startRawY = 0f
            private var startParamX = 0
            private var startParamY = 0
            private var dragged = false

            override fun onTouch(view: View, event: MotionEvent): Boolean {
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        startRawX = event.rawX
                        startRawY = event.rawY
                        startParamX = params?.x ?: 0
                        startParamY = params?.y ?: 0
                        dragged = false
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.rawX - startRawX
                        val dy = event.rawY - startRawY
                        if (!dragged && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                            dragged = true
                        }
                        if (dragged) {
                            val lp = params
                            val wm = windowManager
                            if (lp != null && wm != null) {
                                val metrics = context.resources.displayMetrics
                                val maxX = (metrics.widthPixels - view.width).coerceAtLeast(0)
                                val maxY = (metrics.heightPixels - view.height).coerceAtLeast(0)
                                // gravity = TOP or END: x — отступ от правого края, поэтому знак dx инвертирован
                                val newX = (startParamX - dx).toInt().coerceIn(0, maxX)
                                val newY = (startParamY + dy).toInt().coerceIn(0, maxY)
                                lp.x = newX
                                lp.y = newY
                                try {
                                    wm.updateViewLayout(view, lp)
                                } catch (_: Throwable) {
                                    // окно могло быть уже удалено
                                }
                            }
                        }
                        return true
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (!dragged) {
                            view.performClick()
                        }
                        return true
                    }
                }
                return false
            }
        }
    }

    /**
     * Shows the overlay.  If it is already visible the text is updated.
     * Does nothing (logs) when the permission is missing.
     */
    fun show(context: Context, text: String = "Обновлено —") {
        handler.post {
            try {
                if (!hasPermission(context)) {
                    Log.w(TAG, "No overlay permission – skip show")
                    return@post
                }
                if (textView != null) {
                    textView?.text = text
                    return@post
                }
                val wm = context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                val tv = createTextView(context)
                tv.setOnClickListener {
                    stopAlert()
                    openApplications(context)
                }
                tv.text = text
                val lp = createLayoutParams(context)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    wm.addView(tv, lp)
                } else {
                    wm.addView(tv, lp)
                }
                windowManager = wm
                textView = tv
                params = lp
                if (alertPending) {
                    alertPending = false
                    applyAlert(tv)
                }
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException on show", e)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to show overlay", e)
            }
        }
    }

    /** Removes the overlay if visible. Safe to call multiple times. */
    fun hide() {
        handler.post {
            try {
                val wm = windowManager ?: return@post
                val tv = textView ?: return@post
                wm.removeView(tv)
            } catch (e: Exception) {
                Log.w(TAG, "hide: ", e)
            } finally {
                textView = null
                windowManager = null
                params = null
                stopAlert()
            }
        }
    }

    /** Updates the displayed text without recreating the window. */
    fun updateText(text: String) {
        handler.post {
            textView?.text = text
        }
    }

    /** Returns true when the overlay view is currently attached. */
    fun isVisible(): Boolean = textView != null

    /**
     * Включает мигание виджета зелёным фоном при новой заявке.
     * Мигание длится не дольше [ALERT_MAX_MS] и останавливается по клику,
     * по hide() или автоматически по таймауту.
     * Если виджет скрыт — мигание стартует сразу после следующего show().
     * Повторный вызов перезапускает аниматор и таймаут без накопления.
     */
    fun startAlert() {
        handler.post {
            val tv = textView
            if (tv == null) {
                alertPending = true
                return@post
            }
            applyAlert(tv)
        }
    }

    /** Останавливает мигание и возвращает виджету обычный вид. Safe to call multiple times. */
    fun stopAlert() {
        alertAnimator?.cancel()
        alertAnimator = null
        alertTimeout?.let { handler.removeCallbacks(it) }
        alertTimeout = null
        alertPending = false
        val tv = textView ?: return
        tv.alpha = 1f
        tv.background = buildBackground(tv.context, NORMAL_BG)
    }

    /** Запускает мигание на уже видимом виджете, отменяя предыдущие аниматор/таймаут. */
    private fun applyAlert(tv: TextView) {
        alertAnimator?.cancel()
        alertAnimator = null
        alertTimeout?.let { handler.removeCallbacks(it) }
        alertTimeout = null

        tv.alpha = 1f
        tv.background = buildBackground(tv.context, ALERT_BG)

        val animator = ObjectAnimator.ofFloat(tv, "alpha", 1f, 0.35f).apply {
            duration = BLINK_HALF_PERIOD_MS
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
        }
        alertAnimator = animator
        animator.start()

        val timeout = Runnable { stopAlert() }
        alertTimeout = timeout
        handler.postDelayed(timeout, ALERT_MAX_MS)
    }

    /** Launches the main activity with the "applications" navigation target. */
    private fun openApplications(context: Context) {
        try {
            val intent = Intent(context, MainActivity::class.java).apply {
                putExtra("multi_elma_nav", "applications")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open applications", e)
        }
    }
}
