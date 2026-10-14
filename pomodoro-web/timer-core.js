/**
 * 番茄时钟 —— 纯逻辑核心。
 *
 * 该文件不依赖 DOM，可在浏览器（挂载到 window.PomodoroCore）
 * 或 Node（module.exports）中使用，因此核心状态机是可单元测试的。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PHASES = ['focus', 'short', 'long'];

  var DEFAULT_SETTINGS = {
    focusMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    longBreakInterval: 4,
    autoStartBreaks: true,
    autoStartFocus: false,
    soundEnabled: true,
    notifyEnabled: false
  };

  /**
   * 把输入收敛到 [min, max] 的整数。
   * 非数字（NaN / '' / 'abc'）回退到 fallback，越界值则夹到边界。
   */
  function toIntInRange(value, fallback, min, max) {
    var n = Number(value);
    if (!isFinite(n)) n = Number(fallback);
    if (!isFinite(n)) n = min;
    return Math.round(Math.min(max, Math.max(min, n)));
  }

  /** 把外部传入的设置规整成合法值，避免 NaN / 负数造成计时器异常。 */
  function normalizeSettings(raw) {
    var input = raw && typeof raw === 'object' ? raw : {};
    var merged = {};
    for (var key in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
        merged[key] = Object.prototype.hasOwnProperty.call(input, key)
          ? input[key]
          : DEFAULT_SETTINGS[key];
      }
    }
    return {
      focusMinutes: toIntInRange(merged.focusMinutes, DEFAULT_SETTINGS.focusMinutes, 1, 180),
      shortMinutes: toIntInRange(merged.shortMinutes, DEFAULT_SETTINGS.shortMinutes, 1, 60),
      longMinutes: toIntInRange(merged.longMinutes, DEFAULT_SETTINGS.longMinutes, 1, 120),
      longBreakInterval: toIntInRange(merged.longBreakInterval, DEFAULT_SETTINGS.longBreakInterval, 1, 12),
      autoStartBreaks: Boolean(merged.autoStartBreaks),
      autoStartFocus: Boolean(merged.autoStartFocus),
      soundEnabled: Boolean(merged.soundEnabled),
      notifyEnabled: Boolean(merged.notifyEnabled)
    };
  }

  function phaseDurationMs(phase, settings) {
    var s = normalizeSettings(settings);
    var minutes =
      phase === 'short' ? s.shortMinutes :
      phase === 'long' ? s.longMinutes :
      s.focusMinutes;
    return minutes * 60 * 1000;
  }

  function createState(settings, now) {
    var s = normalizeSettings(settings);
    return {
      phase: 'focus',
      durationMs: phaseDurationMs('focus', s),
      remainingMs: phaseDurationMs('focus', s),
      running: false,
      endAt: null,
      focusDone: 0,
      startedAt: typeof now === 'number' ? now : Date.now()
    };
  }

  /** 当前剩余毫秒数（运行中按真实时钟推算，暂停时返回冻结值）。 */
  function remainingMs(state, now) {
    if (!state) return 0;
    if (!state.running || typeof state.endAt !== 'number') {
      return Math.max(0, state.remainingMs);
    }
    return Math.max(0, state.endAt - now);
  }

  function start(state, now) {
    if (state.running) return state;
    var left = Math.max(0, state.remainingMs);
    if (left <= 0) return state;
    return Object.assign({}, state, {
      running: true,
      endAt: now + left,
      remainingMs: left
    });
  }

  function pause(state, now) {
    if (!state.running) return state;
    return Object.assign({}, state, {
      running: false,
      endAt: null,
      remainingMs: remainingMs(state, now)
    });
  }

  function toggle(state, now) {
    return state.running ? pause(state, now) : start(state, now);
  }

  function reset(state, settings) {
    var s = normalizeSettings(settings);
    return Object.assign({}, state, {
      durationMs: phaseDurationMs(state.phase, s),
      remainingMs: phaseDurationMs(state.phase, s),
      running: false,
      endAt: null
    });
  }

  function switchPhase(state, phase, settings) {
    if (PHASES.indexOf(phase) === -1) return state;
    var s = normalizeSettings(settings);
    var duration = phaseDurationMs(phase, s);
    return Object.assign({}, state, {
      phase: phase,
      durationMs: duration,
      remainingMs: duration,
      running: false,
      endAt: null
    });
  }

  /**
   * 休息结束后回到专注；专注结束后按 longBreakInterval 决定长/短休息。
   */
  function nextPhase(state, settings) {
    var s = normalizeSettings(settings);
    if (state.phase !== 'focus') return 'focus';
    return state.focusDone > 0 && state.focusDone % s.longBreakInterval === 0
      ? 'long'
      : 'short';
  }

  function shouldAutoStart(phase, settings) {
    var s = normalizeSettings(settings);
    return phase === 'focus' ? s.autoStartFocus : s.autoStartBreaks;
  }

  /**
   * 推进状态机。
   * @returns {{state: object, completed: null|object}}
   *   completed 不为 null 时表示刚刚结束一个阶段。
   */
  function tick(state, now, settings) {
    if (!state.running) return { state: state, completed: null };
    if (now < state.endAt) {
      return {
        state: Object.assign({}, state, { remainingMs: Math.max(0, state.endAt - now) }),
        completed: null
      };
    }

    var finishedPhase = state.phase;
    var focusDone = state.focusDone + (finishedPhase === 'focus' ? 1 : 0);
    var settled = Object.assign({}, state, { focusDone: focusDone });
    var upcoming = nextPhase(settled, settings);
    var advanced = switchPhase(settled, upcoming, settings);

    if (shouldAutoStart(upcoming, settings)) {
      advanced = start(advanced, now);
    }

    return {
      state: advanced,
      completed: {
        phase: finishedPhase,
        next: upcoming,
        focusDone: focusDone,
        autoStarted: advanced.running
      }
    };
  }

  /** 跳过当前阶段：不计入完成统计，直接切到「下一阶段」。 */
  function skip(state, settings) {
    var upcoming = state.phase === 'focus'
      ? nextPhase(state, settings)
      : 'focus';
    return switchPhase(state, upcoming, settings);
  }

  /**
   * 把「当前周期」的完成进度映射成圆点状态。
   * @returns {{total:number, filled:number}}
   */
  function cycleDots(state, settings) {
    var s = normalizeSettings(settings);
    var total = s.longBreakInterval;
    var done = state.focusDone;
    var filled = done % total;
    if (done > 0 && filled === 0) filled = total;
    return { total: total, filled: filled };
  }

  function formatTime(ms) {
    var totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  /** 进度 0~1：0 表示刚开始（满环），1 表示已结束（空环）。 */
  function progress(state, now) {
    var total = state.durationMs || 0;
    if (total <= 0) return 1;
    var left = remainingMs(state, now);
    return Math.min(1, Math.max(0, 1 - left / total));
  }

  var PHASE_TEXT = {
    focus: { name: '专注时间', verb: '该专注了', emoji: '🍅' },
    short: { name: '短休息', verb: '起来伸个懒腰', emoji: '☕️' },
    long: { name: '长休息', verb: '好好休息一下', emoji: '🌿' }
  };

  function serialize(state) {
    return {
      phase: state.phase,
      durationMs: state.durationMs,
      remainingMs: state.remainingMs,
      running: state.running,
      endAt: state.endAt,
      focusDone: state.focusDone
    };
  }

  /**
   * 从 localStorage 恢复。若关闭页面期间计时已经结束，
   * 这里只结算这一个阶段（不会连锁自动开始），并把下一阶段置为暂停。
   */
  function restore(raw, settings, now) {
    var s = normalizeSettings(settings);
    if (!raw || typeof raw !== 'object' || PHASES.indexOf(raw.phase) === -1) {
      return { state: createState(s, now), completed: null };
    }

    var focusDone = Math.max(0, Math.floor(Number(raw.focusDone) || 0));
    var base = {
      phase: raw.phase,
      durationMs: Math.max(1, Number(raw.durationMs) || phaseDurationMs(raw.phase, s)),
      remainingMs: Math.max(0, Number(raw.remainingMs) || 0),
      running: Boolean(raw.running),
      endAt: typeof raw.endAt === 'number' ? raw.endAt : null,
      focusDone: focusDone
    };

    if (base.running && base.endAt === null) base.running = false;

    if (base.running && now >= base.endAt) {
      var result = tick(base, now, s);
      if (result.completed) {
        // 回来时不要自动接续，让用户自己决定。
        result.state = Object.assign({}, result.state, { running: false, endAt: null });
      }
      return result;
    }

    if (base.running) {
      base.remainingMs = Math.max(0, base.endAt - now);
    }
    return { state: base, completed: null };
  }

  return {
    PHASES: PHASES,
    PHASE_TEXT: PHASE_TEXT,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normalizeSettings: normalizeSettings,
    phaseDurationMs: phaseDurationMs,
    createState: createState,
    remainingMs: remainingMs,
    start: start,
    pause: pause,
    toggle: toggle,
    reset: reset,
    switchPhase: switchPhase,
    nextPhase: nextPhase,
    tick: tick,
    skip: skip,
    cycleDots: cycleDots,
    formatTime: formatTime,
    progress: progress,
    serialize: serialize,
    restore: restore
  };
});
