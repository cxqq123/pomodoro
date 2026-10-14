package com.mico.pomodoro.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mico.pomodoro.core.Phase
import com.mico.pomodoro.core.PomodoroCore

// MARK: - 阶段主题色

data class PhaseColors(val primary: Color, val soft: Color)

fun phaseColors(phase: Phase): PhaseColors = when (phase) {
    Phase.FOCUS -> PhaseColors(Color(0xFFE84D3D), Color(0x26E84D3D))
    Phase.SHORT_BREAK -> PhaseColors(Color(0xFF29A678), Color(0x2629A678))
    Phase.LONG_BREAK -> PhaseColors(Color(0xFF4D70E6), Color(0x264D70E6))
}

// MARK: - 主界面

@Composable
fun TimerScreen(viewModel: PomodoroViewModel) {
    val state = viewModel.state
    val settings = viewModel.settings
    val colors = phaseColors(state.phase)
    var showSettings by remember { mutableStateOf(false) }
    val progress by animateFloatAsState(
        targetValue = viewModel.progress,
        animationSpec = tween(300),
        label = "progress",
    )

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(colors.soft, Color.Transparent)
                    )
                )
                .systemBarsPadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 顶栏：标题 + 设置按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    state.phase.label,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { showSettings = true }) {
                    Text("⚙️")
                }
            }

            Spacer(Modifier.height(12.dp))

            // 阶段选择
            PhasePicker(
                current = state.phase,
                onSelect = { viewModel.selectPhase(it) },
                colors = colors,
            )

            Spacer(Modifier.weight(0.4f))

            // 环形进度 + 倒计时
            Box(contentAlignment = Alignment.Center) {
                CircleProgress(
                    progress = progress,
                    color = colors.primary,
                    modifier = Modifier.size(260.dp),
                )
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.phase.emoji, fontSize = 32.sp)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        viewModel.remainingText,
                        fontSize = 56.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        state.phase.hint,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    )
                }
            }

            Spacer(Modifier.weight(0.4f))

            // 周期圆点
            val (total, filled) = PomodoroCore.cycleDots(state, settings)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                repeat(total) { i ->
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(
                                if (i < filled) colors.primary
                                else MaterialTheme.colorScheme.outlineVariant,
                                CircleShape,
                            )
                    )
                }
            }

            Spacer(Modifier.height(28.dp))

            // 控制按钮
            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedIconButton(
                    onClick = { viewModel.resetCurrentPhase() },
                    content = "↺",
                    label = "重置",
                )
                Button(
                    onClick = { viewModel.toggleRun() },
                    shape = RoundedCornerShape(28.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = colors.primary),
                    modifier = Modifier
                        .height(56.dp)
                        .width(120.dp),
                ) {
                    Text(
                        if (state.isRunning) "暂停" else "开始",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                OutlinedIconButton(
                    onClick = { viewModel.skipPhase() },
                    content = "⏭",
                    label = "跳过",
                )
            }

            Spacer(Modifier.height(16.dp))

            Text(
                "今日完成 ${state.focusDone} 个番茄",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
            )

            Spacer(Modifier.height(16.dp))
        }
    }

    if (showSettings) {
        SettingsSheet(
            settings = settings,
            onSave = { viewModel.updateSettings(it); showSettings = false },
            onResetStats = { viewModel.resetStats(); showSettings = false },
            onDismiss = { showSettings = false },
        )
    }
}

// MARK: - 阶段选择器

@Composable
private fun PhasePicker(
    current: Phase,
    onSelect: (Phase) -> Unit,
    colors: PhaseColors,
) {
    Row(
        modifier = Modifier
            .background(
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                RoundedCornerShape(24.dp),
            )
            .padding(4.dp),
    ) {
        Phase.entries.forEach { phase ->
            val selected = phase == current
            Text(
                phase.label,
                fontSize = 14.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                color = if (selected) colors.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .background(
                        if (selected) colors.soft else Color.Transparent,
                        RoundedCornerShape(20.dp),
                    )
                    .clickable { onSelect(phase) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
}

// MARK: - 环形进度

@Composable
private fun CircleProgress(
    progress: Float,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val stroke = 14.dp.toPx()
        val inset = stroke / 2
        val size = Size(this.size.width - stroke, this.size.height - stroke)
        val topLeft = Offset(inset, inset)
        drawArc(
            color = color.copy(alpha = 0.15f),
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = topLeft,
            size = size,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
        drawArc(
            color = color,
            startAngle = -90f,
            sweepAngle = 360f * progress,
            useCenter = false,
            topLeft = topLeft,
            size = size,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
    }
}

// MARK: - 圆形轮廓按钮

@Composable
private fun OutlinedIconButton(
    onClick: () -> Unit,
    content: String,
    label: String,
) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(28.dp),
        contentPadding = PaddingValues(0.dp),
        modifier = Modifier.size(56.dp),
    ) {
        Text(content, fontSize = 22.sp)
    }
}

// MARK: - 设置页

@Composable
fun SettingsSheet(
    settings: com.mico.pomodoro.core.Settings,
    onSave: (com.mico.pomodoro.core.Settings) -> Unit,
    onResetStats: () -> Unit,
    onDismiss: () -> Unit,
) {
    var focusMinutes by remember { mutableStateOf(settings.focusMinutes.toFloat()) }
    var shortMinutes by remember { mutableStateOf(settings.shortMinutes.toFloat()) }
    var longMinutes by remember { mutableStateOf(settings.longMinutes.toFloat()) }
    var longBreakInterval by remember { mutableStateOf(settings.longBreakInterval.toFloat()) }
    var autoStartBreaks by remember { mutableStateOf(settings.autoStartBreaks) }
    var autoStartFocus by remember { mutableStateOf(settings.autoStartFocus) }
    var soundEnabled by remember { mutableStateOf(settings.soundEnabled) }
    var notifyEnabled by remember { mutableStateOf(settings.notifyEnabled) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("设置") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SettingSlider("专注时长（分钟）", focusMinutes, 1f..180f) { focusMinutes = it }
                SettingSlider("短休息（分钟）", shortMinutes, 1f..60f) { shortMinutes = it }
                SettingSlider("长休息（分钟）", longMinutes, 1f..120f) { longMinutes = it }
                SettingSlider("长休息间隔（个番茄）", longBreakInterval, 1f..12f) { longBreakInterval = it }
                SettingRow("休息自动开始", autoStartBreaks) { autoStartBreaks = it }
                SettingRow("专注自动开始", autoStartFocus) { autoStartFocus = it }
                SettingRow("提示音", soundEnabled) { soundEnabled = it }
                SettingRow("本地通知", notifyEnabled) { notifyEnabled = it }
                TextButton(onClick = onResetStats) {
                    Text("清零今日番茄统计", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSave(
                    settings.copy(
                        focusMinutes = focusMinutes.toInt(),
                        shortMinutes = shortMinutes.toInt(),
                        longMinutes = longMinutes.toInt(),
                        longBreakInterval = longBreakInterval.toInt(),
                        autoStartBreaks = autoStartBreaks,
                        autoStartFocus = autoStartFocus,
                        soundEnabled = soundEnabled,
                        notifyEnabled = notifyEnabled,
                    )
                )
            }) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

@Composable
private fun SettingSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit,
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text("${value.toInt()}", style = MaterialTheme.typography.bodyMedium)
        }
        Slider(
            value = value,
            onValueChange = { onChange(it) },
            valueRange = range,
            steps = 0,
        )
    }
}

@Composable
private fun SettingRow(
    label: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
