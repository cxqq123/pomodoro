package com.mico.pomodoro.core

import java.util.Date

/**
 * 番茄时钟 —— 纯逻辑核心（与 iOS/web 版同构）。
 *
 * 不依赖 Android 框架、不取真实时钟：时间一律由调用方以 [Date] 注入，
 * 因此核心状态机可在纯 JVM 单元测试里"快进 26 分钟"而无需真实等待。
 */

// MARK: 阶段

enum class Phase(val label: String, val hint: String, val emoji: String) {
    FOCUS("专注时间", "该专注了", "🍅"),
    SHORT_BREAK("短休息", "起来伸个懒腰", "☕️"),
    LONG_BREAK("长休息", "好好休息一下", "🌿");

    val isBreak: Boolean get() = this != FOCUS
}

// MARK: 设置

data class Settings(
    val focusMinutes: Int = 25,
    val shortMinutes: Int = 5,
    val longMinutes: Int = 15,
    val longBreakInterval: Int = 4,
    val autoStartBreaks: Boolean = true,
    val autoStartFocus: Boolean = false,
    val soundEnabled: Boolean = true,
    val notifyEnabled: Boolean = true,
) {
    companion object {
        val DEFAULT = Settings()

        /** 把外部输入（如反序列化结果 / UI 输入）规整成合法值，越界收敛到边界。 */
        fun normalize(raw: Settings?): Settings {
            if (raw == null) return DEFAULT
            return raw.copy(
                focusMinutes = raw.focusMinutes.coerceIn(1, 180),
                shortMinutes = raw.shortMinutes.coerceIn(1, 60),
                longMinutes = raw.longMinutes.coerceIn(1, 120),
                longBreakInterval = raw.longBreakInterval.coerceIn(1, 12),
            )
        }
    }

    fun durationOf(phase: Phase): Long = when (phase) {
        Phase.FOCUS -> focusMinutes
        Phase.SHORT_BREAK -> shortMinutes
        Phase.LONG_BREAK -> longMinutes
    } * 60_000L
}

// MARK: 状态

data class State(
    val phase: Phase = Phase.FOCUS,
    /** 本阶段总时长（毫秒） */
    val durationMs: Long,
    /** 暂停时冻结的剩余毫秒数 */
    val remainingMs: Long,
    val isRunning: Boolean = false,
    /** 运行中计时的绝对终点；暂停时为 null */
    val endsAt: Date? = null,
    /** 今日完成的番茄数 */
    val focusDone: Int = 0,
) {
    companion object {
        fun initial(settings: Settings): State {
            val d = settings.durationOf(Phase.FOCUS)
            return State(durationMs = d, remainingMs = d)
        }
    }

    /** 当前剩余毫秒数（运行中按真实时钟推算，暂停时返回冻结值）。 */
    fun remaining(now: Date): Long {
        if (!isRunning) return remainingMs.coerceAtLeast(0)
        val end = endsAt ?: return remainingMs.coerceAtLeast(0)
        return (end.time - now.time).coerceAtLeast(0)
    }

    /** 进度 0~1：0 表示刚开始，1 表示已结束。 */
    fun progress(now: Date): Double {
        if (durationMs <= 0) return 1.0
        val left = remaining(now)
        return (1.0 - left.toDouble() / durationMs).coerceIn(0.0, 1.0)
    }
}

// MARK: 阶段结束事件

data class PhaseCompletedEvent(
    val finished: Phase,
    val next: Phase,
    val focusDone: Int,
    val autoStarted: Boolean,
)

// MARK: 状态机

object PomodoroCore {

    fun start(state: State, now: Date): State {
        if (state.isRunning) return state
        val left = state.remainingMs.coerceAtLeast(0)
        if (left <= 0) return state
        return state.copy(
            isRunning = true,
            endsAt = Date(now.time + left),
            remainingMs = left,
        )
    }

    fun pause(state: State, now: Date): State {
        if (!state.isRunning) return state
        return state.copy(
            isRunning = false,
            endsAt = null,
            remainingMs = state.remaining(now),
        )
    }

    fun toggle(state: State, now: Date): State =
        if (state.isRunning) pause(state, now) else start(state, now)

    /** 重置当前阶段（回到该阶段满时长、暂停）。 */
    fun reset(state: State, settings: Settings): State {
        val d = settings.durationOf(state.phase)
        return state.copy(durationMs = d, remainingMs = d, isRunning = false, endsAt = null)
    }

    /** 切换到指定阶段（暂停、满时长）。 */
    fun switchPhase(state: State, phase: Phase, settings: Settings): State {
        val d = settings.durationOf(phase)
        return state.copy(
            phase = phase,
            durationMs = d,
            remainingMs = d,
            isRunning = false,
            endsAt = null,
        )
    }

    /** 休息结束回专注；专注结束按 focusDone % longBreakInterval 决定长/短休息。 */
    fun nextPhase(state: State, settings: Settings): Phase {
        if (state.phase != Phase.FOCUS) return Phase.FOCUS
        return if (state.focusDone > 0 && state.focusDone % settings.longBreakInterval == 0) {
            Phase.LONG_BREAK
        } else {
            Phase.SHORT_BREAK
        }
    }

    fun shouldAutoStart(phase: Phase, settings: Settings): Boolean =
        if (phase == Phase.FOCUS) settings.autoStartFocus else settings.autoStartBreaks

    /**
     * 推进状态机。返回新状态与"刚结束的阶段"事件（如果有）。
     * 一次 tick 只结算一个阶段，与 iOS/web 版行为一致。
     */
    fun tick(state: State, now: Date, settings: Settings): Pair<State, PhaseCompletedEvent?> {
        if (!state.isRunning) return state to null
        val end = state.endsAt ?: return state to null
        if (now < end) {
            return state.copy(remainingMs = end.time - now.time) to null
        }

        val finished = state.phase
        val focusDone = state.focusDone + if (finished == Phase.FOCUS) 1 else 0
        val settled = state.copy(focusDone = focusDone)

        val upcoming = nextPhase(settled, settings)
        var advanced = switchPhase(settled, upcoming, settings)
        if (shouldAutoStart(upcoming, settings)) {
            advanced = start(advanced, now)
        }
        val event = PhaseCompletedEvent(
            finished = finished,
            next = upcoming,
            focusDone = focusDone,
            autoStarted = advanced.isRunning,
        )
        return advanced to event
    }

    /** 跳过当前阶段：不计入统计，直接切到下一阶段。 */
    fun skip(state: State, settings: Settings): State {
        val upcoming = if (state.phase == Phase.FOCUS) {
            nextPhase(state, settings)
        } else {
            Phase.FOCUS
        }
        return switchPhase(state, upcoming, settings)
    }

    /** 当前周期圆点。 */
    fun cycleDots(state: State, settings: Settings): Pair<Int, Int> {
        val total = settings.longBreakInterval
        var filled = state.focusDone % total
        if (state.focusDone > 0 && filled == 0) filled = total
        return total to filled
    }

    /** 剩余毫秒 → "MM:SS"。 */
    fun formatTime(ms: Long): String {
        val totalSeconds = (ms.coerceAtLeast(0) + 999) / 1000
        val m = totalSeconds / 60
        val s = totalSeconds % 60
        return String.format("%02d:%02d", m, s)
    }

    /** 从持久化数据恢复。离开期间已结束的只结算这一个阶段并暂停等待确认。 */
    fun restore(raw: State?, settings: Settings, now: Date): Pair<State, PhaseCompletedEvent?> {
        if (raw == null) return State.initial(settings) to null

        var base = raw.copy(
            focusDone = raw.focusDone.coerceAtLeast(0),
            remainingMs = raw.remainingMs.coerceAtLeast(0),
        )
        if (base.durationMs <= 0) {
            base = base.copy(durationMs = settings.durationOf(base.phase))
        }
        if (base.isRunning && base.endsAt == null) {
            base = base.copy(isRunning = false)
        }

        if (base.isRunning) {
            val end = base.endsAt
            if (end != null) {
                if (now >= end) {
                    val (advanced, event) = tick(base, now, settings)
                    if (event != null) {
                        // 回来时不要自动接续，让用户自己决定
                        return advanced.copy(isRunning = false, endsAt = null) to event
                    }
                    return advanced to event
                }
                base = base.copy(remainingMs = (end.time - now.time).coerceAtLeast(0))
            }
        }
        return base to null
    }
}
