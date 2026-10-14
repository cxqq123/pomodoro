package com.mico.pomodoro.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import androidx.core.app.NotificationCompat
import com.mico.pomodoro.MainActivity
import com.mico.pomodoro.R
import com.mico.pomodoro.core.Phase
import com.mico.pomodoro.core.PhaseCompletedEvent
import kotlin.concurrent.thread

/**
 * 提醒反馈：合成提示音（ToneGenerator，无音频文件）+ 通知。
 * 通知渠道未授权时静默降级（不影响主功能）。
 */
object Feedback {
    private const val CHANNEL_ID = "pomodoro_phase_end"

    fun playPhaseEndSound(context: Context, finished: Phase) {
        thread {
            try {
                val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
                // 专注结束：双短音；休息结束：单长音
                if (finished == Phase.FOCUS) {
                    tone.startTone(ToneGenerator.TONE_PROP_BEEP, 200)
                    Thread.sleep(280)
                    tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 350)
                } else {
                    tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 500)
                }
                Thread.sleep(600)
                tone.release()
            } catch (_: Exception) {
                // 模拟器/静音模式下可能失败，忽略
            }
        }
    }

    fun notifyPhaseEnd(context: Context, event: PhaseCompletedEvent) {
        try {
            ensureChannel(context)
            val title = if (event.finished == Phase.FOCUS) "🍅 专注完成！" else "⏰ 休息结束"
            val body = "${event.next.label}，${event.next.hint} ${event.next.emoji}"
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build()
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(event.hashCode(), notification)
        } catch (_: Exception) {
            // 通知权限被拒等情况：静默降级
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "计时结束提醒", NotificationManager.IMPORTANCE_DEFAULT,
            )
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }
}
