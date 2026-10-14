import Foundation

// MARK: - 阶段定义

/// 三种计时阶段。
enum PomodoroPhase: String, CaseIterable, Codable, Identifiable, Sendable {
    case focus
    case short
    case long

    var id: String { rawValue }

    var name: String {
        switch self {
        case .focus: return "专注时间"
        case .short: return "短休息"
        case .long: return "长休息"
        }
    }

    var hint: String {
        switch self {
        case .focus: return "该专注了"
        case .short: return "起来伸个懒腰"
        case .long: return "好好休息一下"
        }
    }

    var emoji: String {
        switch self {
        case .focus: return "🍅"
        case .short: return "☕️"
        case .long: return "🌿"
        }
    }
}

// MARK: - 设置

/// 计时设置。所有时长可调，`normalize()` 把非法值收敛到合法范围。
struct PomodoroSettings: Codable, Equatable, Sendable {
    var focusMinutes: Int = 25
    var shortMinutes: Int = 5
    var longMinutes: Int = 15
    var longBreakInterval: Int = 4
    var autoStartBreaks: Bool = true
    var autoStartFocus: Bool = false
    var soundEnabled: Bool = true
    var notifyEnabled: Bool = true

    static let `default` = PomodoroSettings()

    /// 把外部输入（如反序列化结果 / UI 输入）规整成合法值，
    /// 避免 NaN / 负数 / 越界值让计时器异常。对应 web 版 normalizeSettings。
    static func normalize(_ raw: PomodoroSettings?) -> PomodoroSettings {
        guard var s = raw else { return .default }
        s.focusMinutes = Self.clamp(s.focusMinutes, fallback: 25, min: 1, max: 180)
        s.shortMinutes = Self.clamp(s.shortMinutes, fallback: 5, min: 1, max: 60)
        s.longMinutes = Self.clamp(s.longMinutes, fallback: 15, min: 1, max: 120)
        s.longBreakInterval = Self.clamp(s.longBreakInterval, fallback: 4, min: 1, max: 12)
        return s
    }

    private static func clamp(_ value: Int, fallback: Int, min minValue: Int, max maxValue: Int) -> Int {
        Swift.min(maxValue, Swift.max(minValue, value))
    }

    func duration(of phase: PomodoroPhase) -> TimeInterval {
        switch phase {
        case .focus: return TimeInterval(focusMinutes) * 60
        case .short: return TimeInterval(shortMinutes) * 60
        case .long: return TimeInterval(longMinutes) * 60
        }
    }
}

// MARK: - 计时状态

/// 计时器核心状态。值类型，所有推进都返回新值，便于确定性单测：
/// 时间全部由调用方以参数传入，不在此内部取当前时间。
struct PomodoroState: Equatable, Codable, Sendable {
    var phase: PomodoroPhase = .focus
    /// 本阶段总时长（秒）。
    var duration: TimeInterval
    /// 暂停时冻结的剩余秒数。
    var remaining: TimeInterval
    var isRunning: Bool = false
    /// 运行中计时的绝对终点；暂停时为 nil。
    var endsAt: Date? = nil
    /// 今日完成的番茄数。
    var focusDone: Int = 0

    static func initial(settings: PomodoroSettings, now: Date) -> PomodoroState {
        let d = settings.duration(of: .focus)
        return PomodoroState(duration: d, remaining: d)
    }

    /// 当前剩余秒数（运行中按真实时钟推算，暂停时返回冻结值）。
    func remainingMs(at now: Date) -> TimeInterval {
        guard isRunning, let endsAt = endsAt else {
            return max(0, remaining)
        }
        return max(0, endsAt.timeIntervalSince(now))
    }

    func progress(at now: Date) -> Double {
        guard duration > 0 else { return 1 }
        let left = remainingMs(at: now)
        return min(1, max(0, 1 - left / duration))
    }
}

// MARK: - 推进结果

/// tick 之后若刚结束一个阶段，返回结束信息。
struct PhaseCompletedEvent: Equatable, Sendable {
    let finished: PomodoroPhase
    let next: PomodoroPhase
    let focusDone: Int
    let autoStarted: Bool
}

// MARK: - 纯逻辑状态机

/// 对应 web 版 timer-core.js 的纯函数集：不依赖 UI、时钟注入、
/// 全部返回新值，可在测试里"快进 26 分钟"而不必真实等待。
enum PomodoroCore {
    static func start(_ state: PomodoroState, at now: Date) -> PomodoroState {
        guard !state.isRunning else { return state }
        let left = max(0, state.remaining)
        guard left > 0 else { return state }
        var s = state
        s.isRunning = true
        s.endsAt = now.addingTimeInterval(left)
        s.remaining = left
        return s
    }

    static func pause(_ state: PomodoroState, at now: Date) -> PomodoroState {
        guard state.isRunning else { return state }
        var s = state
        s.isRunning = false
        s.endsAt = nil
        s.remaining = state.remainingMs(at: now)
        return s
    }

    static func toggle(_ state: PomodoroState, at now: Date) -> PomodoroState {
        state.isRunning ? pause(state, at: now) : start(state, at: now)
    }

    /// 重置当前阶段（回到该阶段满时长、暂停）。
    static func reset(_ state: PomodoroState, settings: PomodoroSettings) -> PomodoroState {
        var s = state
        s.duration = settings.duration(of: state.phase)
        s.remaining = s.duration
        s.isRunning = false
        s.endsAt = nil
        return s
    }

    /// 切换到指定阶段（暂停、满时长）。未知阶段直接忽略。
    static func switchPhase(_ state: PomodoroState, to phase: PomodoroPhase, settings: PomodoroSettings) -> PomodoroState {
        let duration = settings.duration(of: phase)
        var s = state
        s.phase = phase
        s.duration = duration
        s.remaining = duration
        s.isRunning = false
        s.endsAt = nil
        return s
    }

    /// 休息结束回专注；专注结束按 focusDone % longBreakInterval 决定长/短休息。
    static func nextPhase(after state: PomodoroState, settings: PomodoroSettings) -> PomodoroPhase {
        guard state.phase == .focus else { return .focus }
        if state.focusDone > 0 && state.focusDone % settings.longBreakInterval == 0 {
            return .long
        }
        return .short
    }

    static func shouldAutoStart(_ phase: PomodoroPhase, settings: PomodoroSettings) -> Bool {
        phase == .focus ? settings.autoStartFocus : settings.autoStartBreaks
    }

    /// 推进状态机。返回新状态与"刚结束的阶段"事件（如果有）。
    /// 注意：一次 tick 只结算一个阶段（不会连锁推进多个阶段），
    /// 与 web 版行为一致——恢复场景下多余的阶段交给下一次 tick。
    static func tick(_ state: PomodoroState, at now: Date, settings: PomodoroSettings) -> (state: PomodoroState, completed: PhaseCompletedEvent?) {
        guard state.isRunning, let endsAt = state.endsAt else {
            return (state, nil)
        }
        if now < endsAt {
            var s = state
            s.remaining = max(0, endsAt.timeIntervalSince(now))
            return (s, nil)
        }

        let finished = state.phase
        let focusDone = state.focusDone + (finished == .focus ? 1 : 0)
        var settled = state
        settled.focusDone = focusDone

        let upcoming = nextPhase(after: settled, settings: settings)
        var advanced = switchPhase(settled, to: upcoming, settings: settings)
        if shouldAutoStart(upcoming, settings: settings) {
            advanced = start(advanced, at: now)
        }
        let event = PhaseCompletedEvent(finished: finished, next: upcoming, focusDone: focusDone, autoStarted: advanced.isRunning)
        return (advanced, event)
    }

    /// 跳过当前阶段：不计入统计，直接切到下一阶段。
    static func skip(_ state: PomodoroState, settings: PomodoroSettings) -> PomodoroState {
        let upcoming = state.phase == .focus
            ? nextPhase(after: state, settings: settings)
            : .focus
        return switchPhase(state, to: upcoming, settings: settings)
    }

    /// 当前周期圆点：total 个里 filled 个已完成。
    static func cycleDots(state: PomodoroState, settings: PomodoroSettings) -> (total: Int, filled: Int) {
        let total = settings.longBreakInterval
        var filled = state.focusDone % total
        if state.focusDone > 0 && filled == 0 { filled = total }
        return (total, filled)
    }

    /// 剩余秒数 → "MM:SS"。
    static func formatTime(_ seconds: TimeInterval) -> String {
        let total = Int((max(0, seconds)).rounded(.up))
        let m = total / 60
        let s = total % 60
        return String(format: "%02d:%02d", m, s)
    }

    // MARK: 序列化 / 恢复

    /// 从持久化数据恢复。若离开期间计时已经结束，只结算这一个阶段
    /// （不连锁自动开始），并把下一阶段置为暂停，让用户自己决定。
    static func restore(raw: PomodoroState?, settings: PomodoroSettings, now: Date) -> (state: PomodoroState, completed: PhaseCompletedEvent?) {
        guard var base = raw else {
            return (PomodoroState.initial(settings: settings, now: now), nil)
        }

        base.focusDone = max(0, base.focusDone)
        if base.remaining < 0 { base.remaining = 0 }
        if base.duration <= 0 { base.duration = settings.duration(of: base.phase) }

        if base.isRunning && base.endsAt == nil { base.isRunning = false }

        if base.isRunning, let endsAt = base.endsAt, now >= endsAt {
            let result = tick(base, at: now, settings: settings)
            if result.completed != nil {
                var paused = result.state
                paused.isRunning = false
                paused.endsAt = nil
                return (paused, result.completed)
            }
            return result
        }

        if base.isRunning, let endsAt = base.endsAt {
            base.remaining = max(0, endsAt.timeIntervalSince(now))
        }
        return (base, nil)
    }
}
