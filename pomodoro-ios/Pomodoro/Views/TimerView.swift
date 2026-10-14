import SwiftUI

/// 主界面：阶段选择、环形进度、大数字倒计时、控制按钮、周期圆点、今日统计。
struct TimerView: View {
    @EnvironmentObject private var viewModel: PomodoroViewModel

    var body: some View {
        VStack(spacing: 0) {
            phasePicker

            Spacer(minLength: 12)

            // 环形进度 + 倒计时数字
            ZStack {
                CircleProgressView(progress: viewModel.progressValue, color: viewModel.phaseColor)
                    .frame(width: 260, height: 260)

                VStack(spacing: 8) {
                    Text(viewModel.phaseEmoji)
                        .font(.system(size: 34))
                    Text(viewModel.remainingText)
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(.default, value: viewModel.remainingText)
                    Text(viewModel.phaseHint)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 12)

            // 周期圆点
            CycleDotsView(total: viewModel.cycleDots.total, filled: viewModel.cycleDots.filled, color: viewModel.phaseColor)
                .padding(.bottom, 20)

            // 控制按钮
            HStack(spacing: 16) {
                Button {
                    viewModel.resetCurrentPhase()
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.title2)
                        .frame(width: 56, height: 56)
                        .background(Color(.systemGray5))
                        .clipShape(Circle())
                }
                .accessibilityLabel(Text("重置"))

                Button {
                    viewModel.toggleRun()
                } label: {
                    Text(viewModel.isRunning ? "暂停" : "开始")
                        .font(.headline)
                        .frame(width: 110, height: 56)
                        .background(viewModel.phaseColor.primary)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                }
                .accessibilityLabel(Text(viewModel.isRunning ? "暂停" : "开始"))

                Button {
                    viewModel.skipPhase()
                } label: {
                    Image(systemName: "forward.end.fill")
                        .font(.title2)
                        .frame(width: 58, height: 56)
                        .foregroundStyle(viewModel.phaseColor.primary)
                        .background(Color(.systemGray5))
                        .clipShape(Capsule())
                }
                .accessibilityLabel(Text("跳过"))
            }
            .padding(.bottom, 20)

            // 今日完成数
            HStack(spacing: 6) {
                Text("今日 \(viewModel.focusDone) 个番茄")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(gradientBackground)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    SettingsView(viewModel: viewModel)
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel(Text("设置"))
            }
        }
        .navigationTitle(viewModel.phaseName)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if viewModel.settings.notifyEnabled {
                Task {
                    await viewModel.notificationService.requestAuthorizationIfNeeded()
                }
            }
        }
    }

    // MARK: - 子视图

    private var phasePicker: some View {
        HStack(spacing: 0) {
            ForEach(PomodoroPhase.allCases) { phase in
                Button {
                    viewModel.switchPhase(to: phase)
                } label: {
                    Text(phase.name)
                        .font(.subheadline.weight(viewModel.state.phase == phase ? .semibold : .regular))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 8)
                        .background(
                            viewModel.state.phase == phase
                                ? viewModel.phaseColor.soft
                                : Color.clear
                        )
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(viewModel.state.phase == phase ? viewModel.phaseColor.primary : .secondary)
            }
        }
        .padding(4)
        .background(Color(.systemGray6))
        .clipShape(Capsule())
        .accessibilityElement(children: .contain)
    }

    private var gradientBackground: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            LinearGradient(
                colors: [viewModel.phaseColor.soft, Color(.systemBackground)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }
}

// MARK: - 环形进度

struct CircleProgressView: View {
    let progress: Double
    let color: PhaseTheme.Color

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.soft, lineWidth: 14)
            Circle()
                .trim(from: 0, to: max(0.001, progress))
                .stroke(color.primary, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.3), value: progress)
        }
    }
}

// MARK: - 周期圆点

struct CycleDotsView: View {
    let total: Int
    let filled: Int
    let color: PhaseTheme.Color

    var body: some View {
        HStack(spacing: 10) {
            ForEach(0..<max(total, 1), id: \.self) { i in
                Circle()
                    .fill(i < filled ? color.primary : Color(.systemGray4))
                    .frame(width: 12, height: 12)
            }
        }
    }
}
