import Foundation
import SwiftUI

/// 计时器 ViewModel：
/// - Timer 只负责驱动 UI 刷新，状态一律以 Date 时间戳结算（暂停冻结剩余、
///   恢复时用 now + 剩余 重算终点），因此后台/锁屏/切前台都不会累计漂移；
/// - 时间源通过 `now` 闭包注入，测试可固定时钟。
@MainActor
final class PomodoroViewModel: ObservableObject {
    // MARK: - 状态

    private(set) var state: PomodoroState
    private(set) var settings: PomodoroSettings

    // MARK: - 依赖

    let soundService: SoundService
    let notificationService: NotificationService
    let now: () -> Date

    private var timer: Timer?
    private let persistence: UserDefaults

    // MARK: - 初始化

    init(
        persistence: UserDefaults = .standard,
        soundService: SoundService = SoundService(),
        notificationService: NotificationService = NotificationService(),
        now: @escaping () -> Date = Date.init
    ) {
        self.persistence = persistence
        self.soundService = soundService
        self.notificationService = notificationService
        self.now = now

        let loadedSettings = Self.loadSettings(from: persistence)
        self.settings = loadedSettings
        let raw = Self.loadState(from: persistence)
        let restored = PomodoroCore.restore(raw: raw, settings: loadedSettings, now: now())
        self.state = restored.state

        persist()
        if let completed = restored.completed {
            // 恢复时发现离开期间已结束：给出提示但不自动接续，让用户自己决定
            playCompletionFeedback(for: completed)
        }
    }

    // MARK: - 派生只读属性（供 UI）

    var remainingText: String {
        PomodoroCore.formatTime(state.remainingMs(at: now()))
    }

    var progressValue: Double {
        state.progress(at: now())
    }

    var phaseName: String { state.phase.name }
    var phaseHint: String { state.phase.hint }
    var phaseEmoji: String { state.phase.emoji }
    var isRunning: Bool { state.isRunning }
    var focusDone: Int { state.focusDone }

    var cycleDots: (total: Int, filled: Int) {
        PomodoroCore.cycleDots(state: state, settings: settings)
    }

    var phaseColor: PhaseTheme.Color {
        PhaseTheme.color(for: state.phase)
    }

    // MARK: - 控制动作

    func toggleRun() {
        let newState = PomodoroCore.toggle(state, at: now())
        guard newState.isRunning != state.isRunning else { return }
        apply(newState)
        if newState.isRunning {
            startTimer()
        } else {
            stopTimer()
        }
    }

    func resetCurrentPhase() {
        apply(PomodoroCore.reset(state, settings: settings))
        stopTimer()
    }

    func skipPhase() {
        apply(PomodoroCore.skip(state, settings: settings))
        stopTimer()
    }

    func switchPhase(to phase: PomodoroPhase) {
        guard phase != state.phase else { return }
        apply(PomodoroCore.switchPhase(state, to: phase, settings: settings))
        stopTimer()
    }

    /// 清零今日完成统计（不动计时状态）。
    func resetStats() {
        var s = state
        s.focusDone = 0
        apply(s)
    }

    func updateSettings(_ newSettings: PomodoroSettings) {
        let normalized = PomodoroSettings.normalize(newSettings)
        let turningOnNotify = normalized.notifyEnabled && !settings.notifyEnabled
        settings = normalized
        persistSettings()
        // 时长变化后重置当前阶段时长（保持暂停，不动完成数）
        apply(PomodoroCore.reset(state, settings: normalized))
        stopTimer()
        if turningOnNotify {
            Task { [notificationService] in
                await notificationService.requestAuthorizationIfNeeded()
            }
        }
    }

    // MARK: - 计时驱动

    private func startTimer() {
        timer?.invalidate()
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.onTick()
            }
        }
        timer = t
        RunLoop.main.add(t, forMode: .common)
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    /// UI tick：读取真实时钟推进状态机；阶段结束时触发声音/通知。
    private func onTick() {
        let result = PomodoroCore.tick(state, at: now(), settings: settings)
        if let completed = result.completed {
            apply(result.state)
            handlePhaseCompleted(completed)
            return
        }
        if result.state != state {
            state = result.state
        }
        objectWillChange.send()
    }

    private func handlePhaseCompleted(_ completed: PhaseCompletedEvent) {
        playCompletionFeedback(for: completed)
        if completed.autoStarted {
            // 自动接续下一阶段：timer 继续跑
        } else {
            stopTimer()
        }
        persist()
    }

    private func playCompletionFeedback(for completed: PhaseCompletedEvent) {
        if settings.soundEnabled {
            soundService.playPhaseEndSound(for: completed.finished)
        }
        if settings.notifyEnabled {
            notificationService.notifyPhaseEnd(
                finished: completed.finished,
                next: completed.next
            )
        }
    }

    private func apply(_ newState: PomodoroState) {
        state = newState
        persist()
        objectWillChange.send()
    }

    // MARK: - 持久化

    private func persist() {
        Self.save(state, to: persistence)
    }

    private func persistSettings() {
        Self.saveSettings(settings, to: persistence)
    }

    // MARK: - 静态存取（便于测试直接复用）

    static let stateKey = "pomodoro.state.v1"
    static let settingsKey = "pomodoro.settings.v1"

    static func save(_ state: PomodoroState, to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(state) {
            defaults.set(data, forKey: stateKey)
        }
    }

    static func loadState(from defaults: UserDefaults) -> PomodoroState? {
        guard let data = defaults.data(forKey: stateKey) else { return nil }
        return try? JSONDecoder().decode(PomodoroState.self, from: data)
    }

    static func saveSettings(_ settings: PomodoroSettings, to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(settings) {
            defaults.set(data, forKey: settingsKey)
        }
    }

    static func loadSettings(from defaults: UserDefaults) -> PomodoroSettings {
        guard let data = defaults.data(forKey: settingsKey) else { return .default }
        return PomodoroSettings.normalize(try? JSONDecoder().decode(PomodoroSettings.self, from: data))
    }
}

/// 阶段主题配色。
enum PhaseTheme {
    struct Color {
        let primary: SwiftUI.Color
        let soft: SwiftUI.Color
    }

    static func color(for phase: PomodoroPhase) -> Color {
        switch phase {
        case .focus:
            return Color(primary: SwiftUI.Color(red: 0.91, green: 0.30, blue: 0.24), soft: SwiftUI.Color(red: 0.91, green: 0.30, blue: 0.24).opacity(0.15))
        case .short:
            return Color(primary: SwiftUI.Color(red: 0.16, green: 0.62, blue: 0.47), soft: SwiftUI.Color(red: 0.16, green: 0.62, blue: 0.47).opacity(0.15))
        case .long:
            return Color(primary: SwiftUI.Color(red: 0.30, green: 0.44, blue: 0.90), soft: SwiftUI.Color(red: 0.30, green: 0.44, blue: 0.90).opacity(0.15))
        }
    }
}
