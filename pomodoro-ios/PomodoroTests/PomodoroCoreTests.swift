import XCTest
@testable import Pomodoro

/// 状态机核心测试：时间全部注入，可确定性"快进"而不必真实等待。
final class PomodoroCoreTests: XCTestCase {
    // 固定基准时间，所有推进基于它偏移，保证确定性。
    let base = Date(timeIntervalSince1970: 1_700_000_000)
    var settings: PomodoroSettings { .default }

    private func minutes(_ n: Double) -> TimeInterval { n * 60 }

    // MARK: 初始状态与设置

    func testInitialState() {
        let state = PomodoroState.initial(settings: settings, now: base)
        XCTAssertEqual(state.phase, .focus)
        XCTAssertEqual(state.duration, minutes(25), accuracy: 0.001)
        XCTAssertEqual(state.remaining, minutes(25), accuracy: 0.001)
        XCTAssertFalse(state.isRunning)
        XCTAssertNil(state.endsAt)
        XCTAssertEqual(state.focusDone, 0)
    }

    func testSettingsNormalizationClampsValues() {
        var s = PomodoroSettings.default
        s.focusMinutes = 0        // 低于下限 → 1
        s.shortMinutes = 999      // 超上限 → 60
        s.longMinutes = -5        // 负数 → 1（clamp 后不低于 min）
        s.longBreakInterval = 100 // 超上限 → 12
        let n = PomodoroSettings.normalize(s)
        XCTAssertEqual(n.focusMinutes, 1)
        XCTAssertEqual(n.shortMinutes, 60)
        XCTAssertEqual(n.longMinutes, 1)
        XCTAssertEqual(n.longBreakInterval, 12)
    }

    func testSettingsNormalizationNilFallsBack() {
        let n = PomodoroSettings.normalize(nil)
        XCTAssertEqual(n, PomodoroSettings.default)
    }

    // MARK: 开始 / 暂停 / 恢复

    func testStartSetsEndsAt() {
        let s0 = PomodoroState.initial(settings: settings, now: base)
        let s1 = PomodoroCore.start(s0, at: base)
        XCTAssertTrue(s1.isRunning)
        XCTAssertEqual(s1.endsAt, base + minutes(25))
        XCTAssertEqual(s1.remainingMs(at: base), minutes(25), accuracy: 0.001)
    }

    func testPauseFreezesRemaining() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        // 快进 10 分钟后暂停
        s = PomodoroCore.tick(s, at: base + minutes(10), settings: settings).state
        let paused = PomodoroCore.pause(s, at: base + minutes(10))
        XCTAssertFalse(paused.isRunning)
        XCTAssertNil(paused.endsAt)
        XCTAssertEqual(paused.remainingMs(at: base + minutes(10)), minutes(15), accuracy: 0.001)
        // 冻结：暂停 3 小时后剩余不变
        XCTAssertEqual(paused.remainingMs(at: base + minutes(10) + hours(3)), minutes(15), accuracy: 0.001)
    }

    func testResumeDoesNotDrift() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        s = PomodoroCore.pause(s, at: base + minutes(5))
        // 暂停 2 小时后恢复：剩余仍从 20 分钟起算
        let resumed = PomodoroCore.start(s, at: base + hours(2))
        XCTAssertEqual(resumed.endsAt, base + hours(2) + minutes(20))
        XCTAssertEqual(resumed.remainingMs(at: base + hours(2)), minutes(20), accuracy: 0.001)
    }

    func testStartWhenFinishedKeepsState() {
        var s = PomodoroState.initial(settings: settings, now: base)
        s.remaining = 0
        let s1 = PomodoroCore.start(s, at: base)
        XCTAssertFalse(s1.isRunning) // 剩余为 0 不允许 start
    }

    // MARK: 阶段结束与自动循环

    func testFocusCompletionAutoStartsShortBreak() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        // 快进 25 分钟：专注结束
        let result = PomodoroCore.tick(s, at: base + minutes(25), settings: settings)
        XCTAssertEqual(result.completed?.finished, .focus)
        XCTAssertEqual(result.completed?.next, .short)
        XCTAssertEqual(result.completed?.focusDone, 1)
        XCTAssertTrue(result.completed?.autoStarted ?? false) // 默认 autoStartBreaks=true
        XCTAssertEqual(result.state.phase, .short)
        XCTAssertEqual(result.state.duration, minutes(5), accuracy: 0.001)
        XCTAssertTrue(result.state.isRunning)
        XCTAssertEqual(result.state.endsAt, base + minutes(30))
    }

    func testFourthFocusLeadsToLongBreak() {
        var s = PomodoroState.initial(settings: settings, now: base)
        // 连续完成 3 个专注（进入短休息后跳过）
        for i in 0..<3 {
            s = PomodoroCore.start(s, at: base)
            s = PomodoroCore.tick(s, at: base + minutes(25 * Double(i + 1)), settings: settings).state
            XCTAssertTrue(s.phase == .short)
            s = PomodoroCore.skip(s, settings: settings) // 跳过休息 → 回专注
        }
        XCTAssertEqual(s.focusDone, 3)
        // 第 4 个专注
        s = PomodoroCore.start(s, at: base)
        let result = PomodoroCore.tick(s, at: base + minutes(25), settings: settings)
        XCTAssertEqual(result.completed?.next, .long)
        XCTAssertEqual(result.state.phase, .long)
        XCTAssertEqual(result.state.duration, minutes(15), accuracy: 0.001)
    }

    func testBreakCompletionGoesToFocus() {
        var s = PomodoroCore.switchPhase(PomodoroState.initial(settings: settings, now: base), to: .short, settings: settings)
        s = PomodoroCore.start(s, at: base)
        let result = PomodoroCore.tick(s, at: base + minutes(5), settings: settings)
        XCTAssertEqual(result.completed?.finished, .short)
        XCTAssertEqual(result.completed?.next, .focus)
        // 默认 autoStartFocus=false → 停在专注满时长，未运行
        XCTAssertEqual(result.state.phase, .focus)
        XCTAssertFalse(result.state.isRunning)
        XCTAssertFalse(result.completed?.autoStarted ?? true)
    }

    func testAutoStartDisabledStopsAfterPhase() {
        var custom = settings
        custom.autoStartBreaks = false
        var s = PomodoroCore.start(PomodoroState.initial(settings: custom, now: base), at: base)
        let result = PomodoroCore.tick(s, at: base + minutes(25), settings: custom)
        XCTAssertEqual(result.state.phase, .short)
        XCTAssertFalse(result.state.isRunning)
        XCTAssertNil(result.state.endsAt)
        XCTAssertEqual(result.state.remaining, minutes(5), accuracy: 0.001)
    }

    // MARK: 跳过 / 重置

    func testSkipDoesNotCount() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        s = PomodoroCore.skip(s, settings: settings)
        XCTAssertEqual(s.phase, .short)      // 专注 → 短休息
        XCTAssertEqual(s.focusDone, 0)       // 不计数
        XCTAssertFalse(s.isRunning)
        // 休息中跳过 → 回专注
        s = PomodoroCore.skip(s, settings: settings)
        XCTAssertEqual(s.phase, .focus)
        XCTAssertEqual(s.focusDone, 0)
    }

    func testResetRestoresFullDurationPaused() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        s = PomodoroCore.tick(s, at: base + minutes(10), settings: settings).state
        let r = PomodoroCore.reset(s, settings: settings)
        XCTAssertFalse(r.isRunning)
        XCTAssertEqual(r.duration, minutes(25), accuracy: 0.001)
        XCTAssertEqual(r.remaining, minutes(25), accuracy: 0.001)
        XCTAssertEqual(r.focusDone, 0)
    }

    // MARK: 周期圆点与格式化

    func testCycleDots() {
        var s = PomodoroState.initial(settings: settings, now: base)
        XCTAssertEqual(PomodoroCore.cycleDots(state: s, settings: settings).filled, 0)
        s.focusDone = 2
        XCTAssertEqual(PomodoroCore.cycleDots(state: s, settings: settings).filled, 2)
        s.focusDone = 4
        // 刚完成一个周期：4/4 全亮
        let dots = PomodoroCore.cycleDots(state: s, settings: settings)
        XCTAssertEqual(dots.total, 4)
        XCTAssertEqual(dots.filled, 4)
        s.focusDone = 5
        XCTAssertEqual(PomodoroCore.cycleDots(state: s, settings: settings).filled, 1)
    }

    func testFormatTime() {
        XCTAssertEqual(PomodoroCore.formatTime(minutes(25)), "25:00")
        XCTAssertEqual(PomodoroCore.formatTime(65), "01:05")
        XCTAssertEqual(PomodoroCore.formatTime(0), "00:00")
        XCTAssertEqual(PomodoroCore.formatTime(599), "09:59")
        XCTAssertEqual(PomodoroCore.formatTime(-1), "00:00") // 负数兜底为 0
    }

    // MARK: 持久化 / 恢复

    func testCodableRoundTrip() throws {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        s.focusDone = 3
        let data = try JSONEncoder().encode(s)
        let decoded = try JSONDecoder().decode(PomodoroState.self, from: data)
        XCTAssertEqual(decoded, s)
    }

    func testRestoreRunningState() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        let restored = PomodoroCore.restore(raw: s, settings: settings, now: base + minutes(10))
        XCTAssertTrue(restored.state.isRunning)
        XCTAssertEqual(restored.state.remainingMs(at: base + minutes(10)), minutes(15), accuracy: 0.001)
        XCTAssertNil(restored.completed)
    }

    func testRestoreAfterEndSettlesAndPauses() {
        var s = PomodoroCore.start(PomodoroState.initial(settings: settings, now: base), at: base)
        // 离开 26 分钟后回来：专注已结束
        let restored = PomodoroCore.restore(raw: s, settings: settings, now: base + minutes(26))
        XCTAssertEqual(restored.completed?.finished, .focus)
        XCTAssertEqual(restored.state.phase, .short)
        XCTAssertFalse(restored.state.isRunning) // 不自动接续
        XCTAssertEqual(restored.state.remaining, minutes(5), accuracy: 0.001)
    }

    func testRestoreInvalidFallsToInitial() {
        let restored = PomodoroCore.restore(raw: nil, settings: settings, now: base)
        XCTAssertEqual(restored.state.phase, .focus)
        XCTAssertEqual(restored.state.duration, minutes(25), accuracy: 0.001)
        XCTAssertNil(restored.completed)
    }

    // MARK: - 辅助

    private func hours(_ n: Double) -> TimeInterval { n * 3600 }
}
