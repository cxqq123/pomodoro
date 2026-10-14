package com.mico.pomodoro

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import com.mico.pomodoro.ui.PomodoroViewModel
import com.mico.pomodoro.ui.TimerScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val viewModel = PomodoroViewModel(application)
        setContent {
            MaterialTheme {
                Surface {
                    TimerScreen(viewModel)
                }
            }
        }
    }
}
