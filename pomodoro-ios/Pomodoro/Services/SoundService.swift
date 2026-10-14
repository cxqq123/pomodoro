import Foundation
import AVFoundation

/// 提示音服务：用系统音（AudioServicesSoundID）而非外部音频文件，
/// 与 web 版"零音频资源"的思路一致。专注结束与休息结束使用不同音型。
final class SoundService: Sendable {
    /// 专注结束（该休息了）：双短音。
    private let focusEndSoundID: SystemSoundID = 1054  // AudioToolbox Simt: 倒计时结束
    /// 休息结束（该专注了）：长提示音。
    private let breakEndSoundID: SystemSoundID = 1057  // 倒计时结束提醒

    private let queue = DispatchQueue(label: "pomodoro.sound")

    init() {}

    func playPhaseEndSound(for phase: PomodoroPhase) {
        let id: SystemSoundID = phase == .focus ? focusEndSoundID : breakEndSoundID
        queue.async {
            AudioServicesPlaySystemSound(id)
        }
    }
}
