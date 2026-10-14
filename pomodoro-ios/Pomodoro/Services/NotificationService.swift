import Foundation
import UserNotifications

/// 本地通知服务：计时结束提醒。权限被拒时静默降级（不影响主功能）。
@MainActor
final class NotificationService {
    private let center = UNUserNotificationCenter.current()
    private var permissionRequested = false

    init() {}

    /// 请求通知权限（App 启动后调用一次即可；被拒不影响功能）。
    func requestAuthorizationIfNeeded() async {
        guard !permissionRequested else { return }
        permissionRequested = true
        let options: UNAuthorizationOptions = [.alert, .sound, .badge]
        _ = try? await center.requestAuthorization(options: options)
    }

    /// 阶段结束时发一条立即通知。
    func notifyPhaseEnd(finished: PomodoroPhase, next: PomodoroPhase) {
        let content = UNMutableNotificationContent()
        content.title = finished == .focus ? "🍅 专注完成！" : "⏰ 休息结束"
        switch finished {
        case .focus:
            content.body = "坚持了 \(next.name)，现在 \(next.hint)，\(next.emoji)"
        case .short, .long:
            content.body = "休息够了，\(next.hint) \(next.emoji)"
        }
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "pomodoro.phase.\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        Task {
            _ = try? await center.add(request)
        }
    }
    // 备用：静默版（可从设置页关声音时用），当前未启用
}
