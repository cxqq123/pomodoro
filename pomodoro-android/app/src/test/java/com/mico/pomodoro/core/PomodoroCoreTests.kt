package com.mico.pomodoro.core

import org.junit.Assert.*
import org.junit.Test
import java.util.Date

/**
 * 状态机核心测试：时间全部注入，可确定性"快进"而不必真实等待。
 * 与 iOS 版 19 个用例语义对齐。
 */
class PomodoroCoreTests {
    private val base = Date(1_700_000_000_000L)
    private val settings = Settings.DEFAULT

    private fun minutes(n: Long) = n * 60_000L
    private fun hours(n: Long) = n * 3_600_000L
    private fun at(offsetMs: Long) = Date(base.time + offsetMs)

    // MARK: 初始状态与设置

    @Test fun initialState() {
        val s = State.initial(settings)
        assertEquals(Phase.FOCUS, s.phase)
        assertEquals(minutes(25), s.durationMs)
        assertEquals(minutes(25), s.remainingMs)
        assertFalse(s.isRunning)
        assertNull(s.endsAt)
        assertEquals(0, s.focusDone)
    }

    @Test fun settingsNormalizationClamps() {
        val raw = Settings(
            focusMinutes = 0, shortMinutes = 999,
            longMinutes = -5, longBreakInterval = 100,
        )
        val n = Settings.normalize(raw)
        assertEquals(1, n.focusMinutes)
        assertEquals(60, n.shortMinutes)
        assertEquals(1, n.longMinutes)
        assertEquals(12, n.longBreakInterval)
    }

    @Test fun settingsNormalizationNullFallsBack() {
        assertEquals(Settings.DEFAULT, Settings.normalize(null))
    }

    // MARK: 开始 / 暂停 / 恢复

    @Test fun startSetsEndsAt() {
        val s = PomodoroCore.start(State.initial(settings), at(0))
        assertTrue(s.isRunning)
        assertEquals(base.time + minutes(25), s.endsAt!!.time)
        assertEquals(minutes(25), s.remaining(at(0)))
    }

    @Test fun pauseFreezesRemaining() {
        var s = PomodoroCore.start(State.initial(settings), at(0))
        s = PomodoroCore.tick(s, at(minutes(10)), settings).first
        val paused = PomodoroCore.pause(s, at(minutes(10)))
        assertFalse(paused.isRunning)
        assertNull(paused.endsAt)
        assertEquals(minutes(15), paused.remaining(at(minutes(10))))
        // 冻结：暂停 3 小时后剩余不变
        assertEquals(minutes(15), paused.remaining(at(hours(3))))
    }

    @Test fun resumeDoesNotDrift() {
        var s = PomodoroCore.start(State.initial(settings), at(0))
        s = PomodoroCore.pause(s, at(minutes(5)))
        val resumed = PomodoroCore.start(s, at(hours(2)))
        assertEquals(base.time + hours(2) + minutes(20), resumed.endsAt!!.time)
        assertEquals(minutes(20), resumed.remaining(at(hours(2))))
    }

    @Test fun startWhenFinishedKeepsState() {
        val s = State.initial(settings).copy(remainingMs = 0)
        val s1 = PomodoroCore.start(s, at(0))
        assertFalse(s1.isRunning)
    }

    // MARK: 阶段结束与自动循环

    @Test fun focusCompletionAutoStartsShortBreak() {
        val s = PomodoroCore.start(State.initial(settings), at(0))
        val (next, event) = PomodoroCore.tick(s, at(minutes(25)), settings)
        assertNotNull(event)
        assertEquals(Phase.FOCUS, event!!.finished)
        assertEquals(Phase.SHORT_BREAK, event.next)
        assertEquals(1, event.focusDone)
        assertTrue(event.autoStarted)
        assertEquals(Phase.SHORT_BREAK, next.phase)
        assertEquals(minutes(5), next.durationMs)
        assertTrue(next.isRunning)
        assertEquals(base.time + minutes(30), next.endsAt!!.time)
    }

    @Test fun fourthFocusLeadsToLongBreak() {
        var s = State.initial(settings)
        repeat(3) {
            s = PomodoroCore.start(s, at(0))
            s = PomodoroCore.tick(s, at(minutes(25)), settings).first
            assertEquals(Phase.SHORT_BREAK, s.phase)
            s = PomodoroCore.skip(s, settings)
        }
        assertEquals(3, s.focusDone)
        val s4 = PomodoroCore.start(s, at(0))
        val (next, event) = PomodoroCore.tick(s4, at(minutes(25)), settings)
        assertEquals(Phase.LONG_BREAK, event!!.next)
        assertEquals(Phase.LONG_BREAK, next.phase)
        assertEquals(minutes(15), next.durationMs)
    }

    @Test fun breakCompletionGoesToFocus() {
        var s = PomodoroCore.switchPhase(State.initial(settings), Phase.SHORT_BREAK, settings)
        s = PomodoroCore.start(s, at(0))
        val (next, event) = PomodoroCore.tick(s, at(minutes(5)), settings)
        assertEquals(Phase.SHORT_BREAK, event!!.finished)
        assertEquals(Phase.FOCUS, event.next)
        assertEquals(Phase.FOCUS, next.phase)
        assertFalse(next.isRunning)
        assertFalse(event.autoStarted)
    }

    @Test fun autoStartDisabledStopsAfterPhase() {
        val custom = settings.copy(autoStartBreaks = false)
        val s = PomodoroCore.start(State.initial(custom), at(0))
        val (next, _) = PomodoroCore.tick(s, at(minutes(25)), custom)
        assertEquals(Phase.SHORT_BREAK, next.phase)
        assertFalse(next.isRunning)
        assertNull(next.endsAt)
        assertEquals(minutes(5), next.remainingMs)
    }

    // MARK: 跳过 / 重置

    @Test fun skipDoesNotCount() {
        var s = PomodoroCore.start(State.initial(settings), at(0))
        s = PomodoroCore.skip(s, settings)
        assertEquals(Phase.SHORT_BREAK, s.phase)
        assertEquals(0, s.focusDone)
        assertFalse(s.isRunning)
        s = PomodoroCore.skip(s, settings)
        assertEquals(Phase.FOCUS, s.phase)
        assertEquals(0, s.focusDone)
    }

    @Test fun resetRestoresFullDuration() {
        var s = PomodoroCore.start(State.initial(settings), at(0))
        s = PomodoroCore.tick(s, at(minutes(10)), settings).first
        val r = PomodoroCore.reset(s, settings)
        assertFalse(r.isRunning)
        assertEquals(minutes(25), r.durationMs)
        assertEquals(minutes(25), r.remainingMs)
        assertEquals(0, r.focusDone)
    }

    // MARK: 周期圆点与格式化

    @Test fun cycleDots() {
        var s = State.initial(settings)
        assertEquals(4 to 0, PomodoroCore.cycleDots(s, settings))
        s = s.copy(focusDone = 2)
        assertEquals(4 to 2, PomodoroCore.cycleDots(s, settings))
        s = s.copy(focusDone = 4)
        assertEquals(4 to 4, PomodoroCore.cycleDots(s, settings))
        s = s.copy(focusDone = 5)
        assertEquals(4 to 1, PomodoroCore.cycleDots(s, settings))
    }

    @Test fun formatTime() {
        assertEquals("25:00", PomodoroCore.formatTime(minutes(25)))
        assertEquals("01:05", PomodoroCore.formatTime(65_000))
        assertEquals("00:00", PomodoroCore.formatTime(0))
        assertEquals("09:59", PomodoroCore.formatTime(599_000))
        assertEquals("00:00", PomodoroCore.formatTime(-1))
    }

    // MARK: 持久化 / 恢复

    @Test fun restoreRunningState() {
        val s = PomodoroCore.start(State.initial(settings), at(0))
        val (restored, event) = PomodoroCore.restore(s, settings, at(minutes(10)))
        assertTrue(restored.isRunning)
        assertEquals(minutes(15), restored.remaining(at(minutes(10))))
        assertNull(event)
    }

    @Test fun restoreAfterEndSettlesAndPauses() {
        val s = PomodoroCore.start(State.initial(settings), at(0))
        val (restored, event) = PomodoroCore.restore(s, settings, at(minutes(26)))
        assertNotNull(event)
        assertEquals(Phase.FOCUS, event!!.finished)
        assertEquals(Phase.SHORT_BREAK, restored.phase)
        assertFalse(restored.isRunning)
        assertEquals(minutes(5), restored.remainingMs)
    }

    @Test fun restoreInvalidFallsToInitial() {
        val (restored, event) = PomodoroCore.restore(null, settings, at(0))
        assertEquals(Phase.FOCUS, restored.phase)
        assertEquals(minutes(25), restored.durationMs)
        assertNull(event)
    }
}
