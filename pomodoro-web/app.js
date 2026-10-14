/**
 * 番茄时钟 —— 界面与交互（依赖 timer-core.js 提供的纯逻辑）
 */
(function () {
  'use strict';

  var core = window.PomodoroCore;
  var STORAGE_KEY = 'pomodoro-web:v1';

  var els = {
    toggleBtn: document.getElementById('toggleBtn'),
    toggleText: document.getElementById('toggleText'),
    resetBtn: document.getElementById('resetBtn'),
    skipBtn: document.getElementById('skipBtn'),
    ring: document.getElementById('ringProgress'),
    time: document.getElementById('timeDisplay'),
    phaseLabel: document.getElementById('phaseLabel'),
    phaseHint: document.getElementById('phaseHint'),
    modes: Array.prototype.slice.call(document.querySelectorAll('.mode')),
    dots: document.getElementById('dots'),
    focusCount: document.getElementById('focusCount'),
    taskInput: document.getElementById('taskInput'),
    settingsBtn: document.getElementById('settingsBtn'),
    panel: document.getElementById('settingsPanel'),
    scrim: document.getElementById('scrim'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    resetStatsBtn: document.getElementById('resetStatsBtn'),
    restoreDefaultsBtn: document.getElementById('restoreDefaultsBtn'),
    notifyHint: document.getElementById('notifyHint'),
    toast: document.getElementById('toast'),
    form: document.getElementById('settingsForm'),
    numbers: {
      focusMinutes: document.getElementById('focusMinutes'),
      shortMinutes: document.getElementById('shortMinutes'),
      longMinutes: document.getElementById('longMinutes'),
      longBreakInterval: document.getElementById('longBreakInterval')
    },
    toggles: {
      autoStartBreaks: document.getElementById('autoStartBreaks'),
      autoStartFocus: document.getElementById('autoStartFocus'),
      soundEnabled: document.getElementById('soundEnabled'),
      notifyEnabled: document.getElementById('notifyEnabled')
    }
  };

  var RING_CIRCUMFERENCE = 2 * Math.PI * Number(els.ring.getAttribute('r'));

  var settings = core.normalizeSettings(core.DEFAULT_SETTINGS);
  var state = core.createState(settings);
  var stats = { date: todayKey(), count: 0 };
  var lastPaint = { time: null, phase: null, running: null, progress: -1, dots: null };
  var toastTimer = null;
  var closeTimer = null;
  var audioCtx = null;

  /* ------------------------------------------------------------ 存储 -- */

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function load() {
    var raw;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (err) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return;

    settings = core.normalizeSettings(Object.assign({}, core.DEFAULT_SETTINGS, raw.settings));

    var restored = core.restore(raw.timer, settings, Date.now());
    state = restored.state;

    if (raw.stats && raw.stats.date === todayKey()) {
      stats = { date: raw.stats.date, count: Math.max(0, Math.floor(Number(raw.stats.count) || 0)) };
    }

    if (typeof raw.task === 'string') els.taskInput.value = raw.task;

    if (restored.completed) {
      // 页面关闭期间计时已结束：结算统计，但不连锁自动开始。
      if (restored.completed.phase === 'focus') bumpToday();
      setTimeout(function () {
        toast('离开时「' + core.PHASE_TEXT[restored.completed.phase].name + '」已结束，继续加油 👋');
      }, 400);
    } else if (state.running) {
      setTimeout(function () {
        toast('已恢复上次未完成的计时 ▶');
      }, 400);
    }
  }

  function save() {
    var payload = {
      v: 1,
      settings: settings,
      timer: core.serialize(state),
      stats: stats,
      task: els.taskInput.value.slice(0, 60)
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      /* 隐私模式下可能无法写入，忽略即可 */
    }
  }

  /* ------------------------------------------------------------ 音效 -- */

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch (err) {
      audioCtx = null;
    }
    return audioCtx;
  }

  /** 用振荡器合成一小段提示音，避免依赖任何外部音频文件。 */
  function playChime(kind) {
    if (!settings.soundEnabled) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();

    // 专注结束：向上两音；休息结束：向下两音，便于用耳朵区分
    var notes = kind === 'focus' ? [660, 990] : [880, 587];
    var start = ctx.currentTime + 0.02;

    notes.forEach(function (freq, i) {
      var t = start + i * 0.22;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  }

  /* ---------------------------------------------------------- 通知 -- */

  function updateNotifyHint() {
    if (!('Notification' in window)) {
      els.notifyHint.textContent = '当前浏览器不支持，或页面未通过 https 打开';
      els.toggles.notifyEnabled.disabled = true;
      return;
    }
    var p = Notification.permission;
    els.notifyHint.textContent =
      p === 'granted' ? '已授权' :
      p === 'denied' ? '已被浏览器拒绝，请在地址栏权限里重新允许' :
      '首次开启时会向浏览器申请权限';
  }

  function notify(title, body) {
    if (!settings.notifyEnabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var n = new Notification(title, { body: body, tag: 'pomodoro', silent: true });
      setTimeout(function () { n.close(); }, 8000);
    } catch (err) {
      /* file:// 下部分浏览器会抛错，忽略 */
    }
  }

  /* ----------------------------------------------------------- toast -- */

  function toast(message, ms) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    void els.toast.offsetWidth; // 强制重排，让过渡动画从初始状态开始
    els.toast.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-open');
      setTimeout(function () { els.toast.hidden = true; }, 260);
    }, ms || 3200);
  }

  /* ------------------------------------------------------------ 渲染 -- */

  function buildDots(total, filled) {
    els.dots.innerHTML = '';
    for (var i = 0; i < total; i += 1) {
      var dot = document.createElement('span');
      dot.className = 'dot' + (i < filled ? ' is-filled' : '');
      els.dots.appendChild(dot);
    }
    els.dots.setAttribute('aria-label', '本周期番茄进度：' + filled + ' / ' + total);
  }

  function render(now, force) {
    var text = core.PHASE_TEXT[state.phase];
    var timeText = core.formatTime(core.remainingMs(state, now));
    var progress = core.progress(state, now);
    var dots = core.cycleDots(state, settings);
    var dotsKey = dots.total + ':' + dots.filled;

    if (force || timeText !== lastPaint.time) {
      els.time.textContent = timeText;
      document.title = (state.running ? timeText + ' · ' : '') + text.name + ' · 番茄时钟';
      lastPaint.time = timeText;
    }

    if (force || state.phase !== lastPaint.phase) {
      els.phaseLabel.textContent = text.name;
      els.phaseHint.textContent = text.verb;
      document.body.setAttribute('data-phase', state.phase);
      els.modes.forEach(function (btn) {
        btn.setAttribute('aria-selected', String(btn.dataset.phase === state.phase));
      });
      lastPaint.phase = state.phase;
    }

    if (force || state.running !== lastPaint.running) {
      document.body.classList.toggle('is-running', state.running);
      els.toggleBtn.setAttribute('aria-label', (state.running ? '暂停' : '开始') + text.name + '（快捷键 空格）');
      els.toggleText.textContent = state.running ? '暂停' : '开始';
      lastPaint.running = state.running;
    }

    if (force || Math.abs(progress - lastPaint.progress) > 0.0004) {
      // 必须带单位：CSS 里 stroke-dashoffset 是 <length-percentage>，无单位的行内值会被忽略
      els.ring.style.strokeDashoffset = (RING_CIRCUMFERENCE * progress).toFixed(2) + 'px';
      lastPaint.progress = progress;
    }

    if (force || dotsKey !== lastPaint.dots) {
      buildDots(dots.total, dots.filled);
      lastPaint.dots = dotsKey;
    }

    if (force) els.focusCount.textContent = String(stats.count);
  }

  function bumpToday() {
    var key = todayKey();
    if (stats.date !== key) stats = { date: key, count: 0 };
    stats.count += 1;
    els.focusCount.textContent = String(stats.count);
  }

  /* ------------------------------------------------------- 主循环 -- */

  function handleCompleted(completed) {
    if (completed.phase === 'focus') bumpToday();

    var finished = core.PHASE_TEXT[completed.phase];
    var upcoming = core.PHASE_TEXT[completed.next];
    var msg = finished.emoji + ' ' + finished.name + '结束';
    if (completed.next === 'short') msg += '，去休息 ' + settings.shortMinutes + ' 分钟吧';
    else if (completed.next === 'long') msg += '，进入 ' + settings.longMinutes + ' 分钟长休息';
    else msg += '，回到专注';

    playChime(completed.phase);
    toast(msg, 4200);
    notify(finished.emoji + ' ' + finished.name + '结束', '下一步：' + upcoming.name + (completed.autoStarted ? '（已自动开始）' : ''));

    if (completed.autoStarted) els.toggleText.textContent = '暂停';
    save();
  }

  /** 推进一次状态机；返回是否刚刚完成了某个阶段。 */
  function step() {
    if (!state.running) return false;
    var result = core.tick(state, Date.now(), settings);
    if (result.completed) {
      state = result.state;
      handleCompleted(result.completed);
      return true;
    }
    if (result.state !== state) state = result.state;
    return false;
  }

  function loop() {
    step();
    render(Date.now(), false);
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------ 用户操作 -- */

  function toggle() {
    ensureAudio();
    var wasRunning = state.running;
    // 极端情况下暂停时恰好走到 0，先补一个完整时长再开始
    if (!wasRunning && core.remainingMs(state, Date.now()) <= 0) {
      state = core.reset(state, settings);
    }
    state = core.toggle(state, Date.now());
    if (wasRunning) {
      toast('已暂停 ⏸');
    } else {
      toast(core.PHASE_TEXT[state.phase].emoji + ' 开始' + core.PHASE_TEXT[state.phase].name);
    }
    render(Date.now(), true);
    save();
  }

  function resetTimer() {
    state = core.reset(state, settings);
    toast('已重置为 ' + core.formatTime(state.remainingMs));
    render(Date.now(), true);
    save();
  }

  function skipPhase() {
    var from = state.phase;
    state = core.skip(state, settings);
    toast('跳过' + core.PHASE_TEXT[from].name + ' → ' + core.PHASE_TEXT[state.phase].name);
    render(Date.now(), true);
    save();
  }

  function setPhase(phase) {
    if (phase === state.phase) return;
    state = core.switchPhase(state, phase, settings);
    render(Date.now(), true);
    save();
  }

  /* ------------------------------------------------------- 设置面板 -- */

  function syncForm() {
    Object.keys(els.numbers).forEach(function (key) {
      els.numbers[key].value = String(settings[key]);
    });
    Object.keys(els.toggles).forEach(function (key) {
      els.toggles[key].checked = Boolean(settings[key]);
    });
    updateNotifyHint();
  }

  /** 修改时长后：若当前阶段还没开始计时就同步剩余时间，否则只夹紧不越界。 */
  function applyDurationChange() {
    var duration = core.phaseDurationMs(state.phase, settings);
    var previous = state.durationMs;
    state = Object.assign({}, state, { durationMs: duration });

    if (!state.running) {
      if (state.remainingMs >= previous || state.remainingMs > duration) {
        state = Object.assign({}, state, { remainingMs: duration });
      }
    } else if (core.remainingMs(state, Date.now()) > duration) {
      state = Object.assign({}, state, { endAt: Date.now() + duration });
    }
    render(Date.now(), true);
    save();
  }

  function readNumberInput(input, key) {
    var draft = Object.assign({}, settings);
    draft[key] = input.value;
    var value = core.normalizeSettings(draft)[key];
    input.value = String(value);
    settings[key] = value;
    return value;
  }

  function openPanel() {
    clearTimeout(closeTimer);
    els.panel.hidden = false;
    els.scrim.hidden = false;
    void els.panel.offsetWidth; // 强制重排，保证入场过渡生效（不依赖 rAF）
    els.panel.classList.add('is-open');
    els.scrim.classList.add('is-open');
    els.settingsBtn.setAttribute('aria-expanded', 'true');
    var first = els.numbers.focusMinutes;
    if (first) first.focus();
  }

  function closePanel() {
    els.panel.classList.remove('is-open');
    els.scrim.classList.remove('is-open');
    els.settingsBtn.setAttribute('aria-expanded', 'false');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      els.panel.hidden = true;
      els.scrim.hidden = true;
    }, 220);
    els.settingsBtn.focus();
  }

  function toastConfirmResetStats() {
    if (window.confirm('确定要清空统计吗？已完成番茄数与周期进度都会归零。')) {
      stats = { date: todayKey(), count: 0 };
      state = Object.assign({}, state, { focusDone: 0 });
      render(Date.now(), true);
      save();
      toast('统计已清空');
    }
  }

  /* -------------------------------------------------------- 事件绑定 -- */

  els.toggleBtn.addEventListener('click', toggle);
  els.resetBtn.addEventListener('click', resetTimer);
  els.skipBtn.addEventListener('click', skipPhase);
  els.modes.forEach(function (btn) {
    btn.addEventListener('click', function () { setPhase(btn.dataset.phase); });
  });

  els.settingsBtn.addEventListener('click', openPanel);
  els.closeSettingsBtn.addEventListener('click', closePanel);
  els.scrim.addEventListener('click', closePanel);
  els.resetStatsBtn.addEventListener('click', toastConfirmResetStats);

  els.restoreDefaultsBtn.addEventListener('click', function () {
    settings = core.normalizeSettings(core.DEFAULT_SETTINGS);
    syncForm();
    applyDurationChange();
    toast('已恢复默认设置');
  });

  Object.keys(els.numbers).forEach(function (key) {
    els.numbers[key].addEventListener('change', function () {
      readNumberInput(els.numbers[key], key);
      applyDurationChange();
    });
  });

  els.toggles.autoStartBreaks.addEventListener('change', function () {
    settings.autoStartBreaks = els.toggles.autoStartBreaks.checked;
    save();
  });

  els.toggles.autoStartFocus.addEventListener('change', function () {
    settings.autoStartFocus = els.toggles.autoStartFocus.checked;
    save();
  });

  els.toggles.soundEnabled.addEventListener('change', function () {
    settings.soundEnabled = els.toggles.soundEnabled.checked;
    if (settings.soundEnabled) {
      ensureAudio();
      playChime('focus');
    }
    save();
  });

  els.toggles.notifyEnabled.addEventListener('change', function () {
    var want = els.toggles.notifyEnabled.checked;
    if (!want) {
      settings.notifyEnabled = false;
      save();
      return;
    }
    if (!('Notification' in window)) {
      els.toggles.notifyEnabled.checked = false;
      toast('当前环境不支持桌面通知');
      return;
    }
    if (Notification.permission === 'granted') {
      settings.notifyEnabled = true;
      updateNotifyHint();
      save();
      return;
    }
    if (Notification.permission === 'denied') {
      els.toggles.notifyEnabled.checked = false;
      updateNotifyHint();
      toast('通知权限被拒绝，请在浏览器站点设置里允许');
      return;
    }
    Notification.requestPermission().then(function (permission) {
      settings.notifyEnabled = permission === 'granted';
      els.toggles.notifyEnabled.checked = settings.notifyEnabled;
      updateNotifyHint();
      toast(settings.notifyEnabled ? '已开启桌面通知' : '未获得通知权限');
      save();
    });
  });

  els.taskInput.addEventListener('input', save);

  document.addEventListener('keydown', function (event) {
    var tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape' && !els.panel.hidden) {
      closePanel();
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      toggle();
      return;
    }
    var key = event.key.toLowerCase();
    if (key === 'r') { event.preventDefault(); resetTimer(); }
    else if (key === 's') { event.preventDefault(); skipPhase(); }
    else if (key === '1') setPhase('focus');
    else if (key === '2') setPhase('short');
    else if (key === '3') setPhase('long');
  });

  // 回到前台时立即补算流逝的时间
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      step();
      render(Date.now(), true);
    }
  });

  // 后台标签页里 rAF 会被节流甚至暂停，用定时器兜底保证计时与界面都不停摆
  setInterval(function () {
    step();
    render(Date.now(), false);
  }, 500);

  window.addEventListener('beforeunload', save);

  /* ------------------------------------------------------------ 启动 -- */

  load();
  syncForm();
  render(Date.now(), true);
  requestAnimationFrame(loop);
})();
