import SwiftUI

@main
struct PomodoroApp: App {
    @StateObject private var viewModel = PomodoroViewModel()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TimerView()
            }
            .environmentObject(viewModel)
        }
    }
}
