import SwiftUI

/// 设置页：各阶段时长、长休息间隔、自动开始开关、声音/通知、恢复默认、统计清零。
struct SettingsView: View {
    private let viewModel: PomodoroViewModel

    @State private var focusMinutes: Double
    @State private var shortMinutes: Double
    @State private var longMinutes: Double
    @State private var longBreakInterval: Double
    @State private var autoStartBreaks: Bool
    @State private var autoStartFocus: Bool
    @State private var soundEnabled: Bool
    @State private var notifyEnabled: Bool

    @Environment(\.dismiss) private var dismiss

    init(viewModel: PomodoroViewModel) {
        let s = viewModel.settings
        _focusMinutes = State(initialValue: Double(s.focusMinutes))
        _shortMinutes = State(initialValue: Double(s.shortMinutes))
        _longMinutes = State(initialValue: Double(s.longMinutes))
        _longBreakInterval = State(initialValue: Double(s.longBreakInterval))
        _autoStartBreaks = State(initialValue: s.autoStartBreaks)
        _autoStartFocus = State(initialValue: s.autoStartFocus)
        _soundEnabled = State(initialValue: s.soundEnabled)
        _notifyEnabled = State(initialValue: s.notifyEnabled)
        self.viewModel = viewModel
    }

    var body: some View {
        Form {
            Section("时长（分钟）") {
                stepperRow("专注", value: $focusMinutes, range: 1...180, unit: "分钟")
                stepperRow("短休息", value: $shortMinutes, range: 1...60, unit: "分钟")
                stepperRow("长休息", value: $longMinutes, range: 1...120, unit: "分钟")
                stepperRow("长休息间隔", value: $longBreakInterval, range: 1...12, unit: "个番茄")
            }

            Section("自动化") {
                Toggle("休息自动开始", isOn: $autoStartBreaks)
                Toggle("专注自动开始", isOn: $autoStartFocus)
            }

            Section("提醒") {
                Toggle("提示音", isOn: $soundEnabled)
                Toggle("本地通知", isOn: $notifyEnabled)
            }

            Section {
                Button("恢复默认设置") {
                    applyChanges(PomodoroSettings.default)
                    dismiss()
                }
            }

            Section {
                Button("清零今日番茄统计", role: .destructive) {
                    viewModel.resetStats()
                    dismiss()
                }
            } footer: {
                Text("当前已完成 \(viewModel.focusDone) 个番茄。清零只影响计数，不影响进行中的计时。")
            }
        }
        .navigationTitle("设置")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear {
            applyChanges(current())
        }
    }

    // MARK: - 子视图与辅助

    private func applyChanges(_ s: PomodoroSettings) {
        viewModel.updateSettings(s)
    }

    private func current() -> PomodoroSettings {
        var s = viewModel.settings
        s.focusMinutes = Int(focusMinutes)
        s.shortMinutes = Int(shortMinutes)
        s.longMinutes = Int(longMinutes)
        s.longBreakInterval = Int(longBreakInterval)
        s.autoStartBreaks = autoStartBreaks
        s.autoStartFocus = autoStartFocus
        s.soundEnabled = soundEnabled
        s.notifyEnabled = notifyEnabled
        return s
    }

    private func stepperRow(_ label: String, value: Binding<Double>, range: ClosedRange<Double>, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                Spacer()
                Text("\(Int(value.wrappedValue)) \(unit)")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range, step: 1)
        }
    }
}
