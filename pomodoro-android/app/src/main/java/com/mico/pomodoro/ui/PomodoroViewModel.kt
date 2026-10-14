package com.mico.pomodoro.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.mico.pomodoro.core.Phase
import com.mico.pomodoro.core.PhaseCompletedEvent
import com.mico.pomodoro.core.PomodoroCore
import com.mico.pomodoro.core.Settings
import com.mico.pomodoro.core.State
import com.mico.pomodoro.service.Feedback
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Date

/**
 * 计时器 ViewModel：
 * - 协程 250ms tick 只负责驱动 UI 刷新，状态一律以 Date 时间戳结算，
 *   暂停冻结剩余、恢复时重算终点——后台/锁屏/切前台都不累计漂移；
 * - 时间源通过 [clock] 注入，测试可固定时钟。
 */
class PomodoroViewModel(
    private val app: Application,
    private val clock: () -> Date = { Date() },
) {
    var state by mutableStateOf(State.initial(Settings.DEFAULT))
        private set
    var settings by mutableStateOf(Settings.DEFAULT)
        private set

    private var tickerJob: Job? = null
    private val scope = MainScope()
    private val prefs by lazy { app.getSharedPreferences("pomodoro", Context.MODE_PRIVATE) }

    init {
        restore()
    }

    // MARK: - 派生只读属性（供 UI）

    val remainingText: String get() = PomodoroCore.formatTime(state.remaining(clock()))
    val progress: Float get() = state.progress(clock()).toFloat()

    // MARK: - 控制动作

    fun toggleRun() {
        val now = clock()
        val next = PomodoroCore.toggle(state, now)
        if (next.isRunning != state.isRunning) {
            state = next
            persist()
            if (next.isRunning) startTicker() else stopTicker()
        }
    }

    fun resetCurrentPhase() {
        state = PomodoroCore.reset(state, settings)
        stopTicker()
        persist()
    }

    fun skipPhase() {
        state = PomodoroCore.skip(state, settings)
        stopTicker()
        persist()
    }

    fun selectPhase(phase: Phase) {
        if (phase == state.phase) return
        state = PomodoroCore.switchPhase(state, phase, settings)
        stopTicker()
        persist()
    }

    fun resetStats() {
        state = state.copy(focusDone = 0)
        persist()
    }

    fun updateSettings(s: Settings) {
        val normalized = Settings.normalize(s)
        settings = normalized
        persistSettings()
        // 时长变化后重置当前阶段时长（保持暂停，不动完成数）
        state = PomodoroCore.reset(state, normalized)
        stopTicker()
        persist()
    }

    // MARK: - 计时驱动

    private fun startTicker() {
        stopTicker()
        tickerJob = scope.launch {
            while (isActive) {
                delay(250)
                onTick()
            }
        }
    }

    private fun stopTicker() {
        tickerJob?.cancel()
        tickerJob = null
    }

    private fun onTick() {
        val now = clock()
        val (next, event) = PomodoroCore.tick(state, now, settings)
        state = next
        if (event != null) {
            handlePhaseCompleted(event)
        }
        persist()
    }

    private fun handlePhaseCompleted(event: PhaseCompletedEvent) {
        if (settings.soundEnabled) Feedback.playPhaseEndSound(app, event.finished)
        if (settings.notifyEnabled) Feedback.notifyPhaseEnd(app, event)
        if (!event.autoStarted) stopTicker()
    }

    // MARK: - 持久化（JSON 手工序列化，保持零依赖）

    private fun persist() {
        prefs.edit().putString("state", serializeState(state)).apply()
    }

    private fun persistSettings() {
        prefs.edit().putString("settings", serializeSettings(settings)).apply()
    }

    private fun restore() {
        settings = Settings.normalize(
            prefs.getString("settings", null)?.let { deserializeSettings(it) }
        )
        val raw = prefs.getString("state", null)?.let { deserializeState(it) }
        val (restored, event) = PomodoroCore.restore(raw, settings, clock())
        state = restored
        if (event != null && settings.soundEnabled) {
            Feedback.playPhaseEndSound(app, event.finished)
        }
        if (state.isRunning) startTicker()
    }
}

// MARK: - JSON 序列化（无依赖手写）

internal fun serializeState(s: State): String = buildString {
    append("{")
    append("\"phase\":\"${s.phase.name}\",")
    append("\"durationMs\":${s.durationMs},")
    append("\"remainingMs\":${s.remainingMs},")
    append("\"isRunning\":${s.isRunning},")
    append("\"endsAt\":${s.endsAt?.time ?: 0},")
    append("\"focusDone\":${s.focusDone}")
    append("}")
}

internal fun deserializeState(json: String): State? = try {
    val phaseName = Regex("\"phase\":\"(\\w+)\"").find(json)?.groupValues?.get(1)
    val phase = phaseName?.let { runCatching { Phase.valueOf(it) }.getOrNull() } ?: return null
    val duration = Regex("\"durationMs\":(\\d+)").find(json)?.groupValues?.get(1)?.toLongOrNull() ?: return null
    val remaining = Regex("\"remainingMs\":(\\d+)").find(json)?.groupValues?.get(1)?.toLongOrNull() ?: 0
    val running = Regex("\"isRunning\":(true|false)").find(json)?.groupValues?.get(1) == "true"
    val endsAt = Regex("\"endsAt\":(\\d+)").find(json)?.groupValues?.get(1)?.toLongOrNull() ?: 0
    val focusDone = Regex("\"focusDone\":(\\d+)").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 0
    State(
        phase = phase,
        durationMs = duration,
        remainingMs = remaining,
        isRunning = running,
        endsAt = if (running && endsAt > 0) Date(endsAt) else null,
        focusDone = focusDone,
    )
} catch (e: Exception) {
    null
}

internal fun serializeSettings(s: Settings): String = buildString {
    append("{\"focusMinutes\":${s.focusMinutes},")
    append("\"shortMinutes\":${s.shortMinutes},")
    append("\"longMinutes\":${s.longMinutes},")
    append("\"longBreakInterval\":${s.longBreakInterval},")
    append("\"autoStartBreaks\":${s.autoStartBreaks},")
    append("\"autoStartFocus\":${s.autoStartFocus},")
    append("\"soundEnabled\":${s.soundEnabled},")
    append("\"notifyEnabled\":${s.notifyEnabled}}")
}

internal fun deserializeSettings(json: String): Settings? = try {
    Settings(
        focusMinutes = Regex("\"focusMinutes\":(\\d+)").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 25,
        shortMinutes = Regex("\"shortMinutes\":(\\d+)").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 5,
        longMinutes = Regex("\"longMinutes\":(\\d+)").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 15,
        longBreakInterval = Regex("\"longBreakInterval\":(\\d+)").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 4,
        autoStartBreaks = Regex("\"autoStartBreaks\":(true|false)").find(json)?.groupValues?.get(1) == "true",
        autoStartFocus = Regex("\"autoStartFocus\":(true|false)").find(json)?.groupValues?.get(1) == "true",
        soundEnabled = Regex("\"soundEnabled\":(true|false)").find(json)?.groupValues?.get(1) == "true",
        notifyEnabled = Regex("\"notifyEnabled\":(true|false)").find(json)?.groupValues?.get(1) == "true",
    )
} catch (e: Exception) {
    null
}
