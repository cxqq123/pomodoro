'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../timer-core.js');

const T0 = 1_700_000_000_000; // 固定时间戳，避免测试依赖真实时钟
const MIN = 60 * 1000;

function settings(overrides) {
  return core.normalizeSettings(Object.assign({}, core.DEFAULT_SETTINGS, overrides));
}

test('formatTime 输出 MM:SS 并对不足一秒向上取整', () => {
  assert.equal(core.formatTime(25 * MIN), '25:00');
  assert.equal(core.formatTime(59_001), '01:00');
  assert.equal(core.formatTime(59_000), '00:59');
  assert.equal(core.formatTime(0), '00:00');
  assert.equal(core.formatTime(-500), '00:00');
  assert.equal(core.formatTime(120 * MIN), '120:00');
});

test('normalizeSettings 会收敛越界与非数字输入', () => {
  const s = settings({ focusMinutes: 0, shortMinutes: 999, longMinutes: 'abc', longBreakInterval: -3 });
  assert.equal(s.focusMinutes, 1);
  assert.equal(s.shortMinutes, 60);
  assert.equal(s.longMinutes, core.DEFAULT_SETTINGS.longMinutes);
  assert.equal(s.longBreakInterval, 1);
  assert.equal(typeof settings({ autoStartFocus: 1 }).autoStartFocus, 'boolean');
  assert.equal(settings({ autoStartFocus: 1 }).autoStartFocus, true);
});

test('phaseDurationMs 按阶段取对应时长', () => {
  const s = settings({ focusMinutes: 30, shortMinutes: 7, longMinutes: 20 });
  assert.equal(core.phaseDurationMs('focus', s), 30 * MIN);
  assert.equal(core.phaseDurationMs('short', s), 7 * MIN);
  assert.equal(core.phaseDurationMs('long', s), 20 * MIN);
});

test('开始 / 暂停 / 继续保持剩余时间不丢失', () => {
  const s = settings();
  let state = core.createState(s, T0);
  assert.equal(state.running, false);

  state = core.start(state, T0);
  assert.equal(state.running, true);
  assert.equal(core.remainingMs(state, T0 + 5 * MIN), 20 * MIN);

  state = core.pause(state, T0 + 5 * MIN);
  assert.equal(state.running, false);
  assert.equal(state.remainingMs, 20 * MIN);

  // 暂停期间时间继续流逝，但剩余时间被冻结
  assert.equal(core.remainingMs(state, T0 + 60 * MIN), 20 * MIN);

  state = core.start(state, T0 + 60 * MIN);
  assert.equal(core.remainingMs(state, T0 + 60 * MIN + MIN), 19 * MIN);
});

test('重复调用 start / pause 是幂等的', () => {
  const s = settings();
  let state = core.start(core.createState(s, T0), T0);
  const endAt = state.endAt;
  state = core.start(state, T0 + 1000);
  assert.equal(state.endAt, endAt, '运行中再次 start 不应重置结束时间');

  state = core.pause(state, T0 + 1000);
  const paused = state.remainingMs;
  state = core.pause(state, T0 + 2000);
  assert.equal(state.remainingMs, paused, '暂停中再次 pause 不应改变剩余时间');
});

test('专注结束进入短休息，并按设置自动开始', () => {
  const s = settings({ autoStartBreaks: true });
  let state = core.start(core.createState(s, T0), T0);
  const result = core.tick(state, T0 + 25 * MIN, s);

  assert.ok(result.completed, '应报告阶段完成');
  assert.equal(result.completed.phase, 'focus');
  assert.equal(result.completed.next, 'short');
  assert.equal(result.state.phase, 'short');
  assert.equal(result.state.focusDone, 1);
  assert.equal(result.state.running, true, 'autoStartBreaks=true 时应自动开始休息');
  assert.equal(core.remainingMs(result.state, T0 + 25 * MIN), 5 * MIN);
});

test('关闭自动开始后，休息处于暂停状态', () => {
  const s = settings({ autoStartBreaks: false });
  let state = core.start(core.createState(s, T0), T0);
  const result = core.tick(state, T0 + 25 * MIN, s);
  assert.equal(result.state.phase, 'short');
  assert.equal(result.state.running, false);
  assert.equal(result.state.remainingMs, 5 * MIN);
});

test('每完成 longBreakInterval 个专注后进入长休息', () => {
  const s = settings({ longBreakInterval: 4, autoStartBreaks: true, autoStartFocus: false });
  let state = core.createState(s, T0);
  let now = T0;

  for (let i = 1; i <= 4; i += 1) {
    state = core.switchPhase(state, 'focus', s);
    state = core.start(state, now);
    const result = core.tick(state, now + 25 * MIN, s);
    now += 25 * MIN;
    state = result.state;
    assert.equal(state.focusDone, i);
    const expected = i === 4 ? 'long' : 'short';
    assert.equal(state.phase, expected, `第 ${i} 个番茄后应进入 ${expected}`);
    if (expected === 'short') {
      // 结算休息，回到暂停的专注
      state = core.start(state, now);
      const after = core.tick(state, now + 5 * MIN, s);
      now += 5 * MIN;
      state = after.state;
      assert.equal(state.phase, 'focus');
      assert.equal(state.running, false, 'autoStartFocus=false');
    }
  }

  // 长休息结束后回到专注
  state = core.start(state, now);
  const after = core.tick(state, now + 15 * MIN, s);
  assert.equal(after.state.phase, 'focus');
  assert.equal(after.state.focusDone, 4);
});

test('tick 在阶段未结束时只更新剩余时间', () => {
  const s = settings();
  const state = core.start(core.createState(s, T0), T0);
  const result = core.tick(state, T0 + 10 * MIN, s);
  assert.equal(result.completed, null);
  assert.equal(result.state.phase, 'focus');
  assert.equal(result.state.remainingMs, 15 * MIN);
});

test('skip 不增加完成计数，只切换阶段', () => {
  const s = settings({ longBreakInterval: 4 });
  let state = core.createState(s, T0);
  state = core.skip(state, s);
  assert.equal(state.phase, 'short');
  assert.equal(state.focusDone, 0);
  assert.equal(state.running, false);

  state = core.skip(state, s);
  assert.equal(state.phase, 'focus');
  assert.equal(state.focusDone, 0);
});

test('reset 会按当前阶段时长重置并停止计时', () => {
  const s = settings({ focusMinutes: 40 });
  let state = core.start(core.createState(s, T0), T0);
  state = core.tick(state, T0 + 10 * MIN, s).state;
  const reset = core.reset(state, s);
  assert.equal(reset.remainingMs, 40 * MIN);
  assert.equal(reset.durationMs, 40 * MIN);
  assert.equal(reset.running, false);
  assert.equal(reset.endAt, null);
});

test('cycleDots 反映当前周期进度', () => {
  const s = settings({ longBreakInterval: 4 });
  const base = core.createState(s, T0);
  assert.deepEqual(core.cycleDots(base, s), { total: 4, filled: 0 });
  assert.deepEqual(core.cycleDots(Object.assign({}, base, { focusDone: 2 }), s), { total: 4, filled: 2 });
  assert.deepEqual(core.cycleDots(Object.assign({}, base, { focusDone: 4 }), s), { total: 4, filled: 4 });
  assert.deepEqual(core.cycleDots(Object.assign({}, base, { focusDone: 5 }), s), { total: 4, filled: 1 });
});

test('progress 从 0 线性走到 1', () => {
  const s = settings({ focusMinutes: 20 });
  const state = core.start(core.createState(s, T0), T0);
  assert.equal(core.progress(state, T0), 0);
  assert.equal(core.progress(state, T0 + 5 * MIN), 0.25);
  assert.equal(core.progress(state, T0 + 20 * MIN), 1);
  assert.equal(core.progress(state, T0 + 99 * MIN), 1, '不应超过 1');
});

test('serialize / restore 能在刷新后继续计时', () => {
  const s = settings();
  let state = core.start(core.createState(s, T0), T0);
  state = core.tick(state, T0 + 10 * MIN, s).state;
  const raw = JSON.parse(JSON.stringify(core.serialize(state)));

  const restored = core.restore(raw, s, T0 + 12 * MIN);
  assert.equal(restored.completed, null);
  assert.equal(restored.state.running, true);
  assert.equal(core.remainingMs(restored.state, T0 + 12 * MIN), 13 * MIN);
});

test('restore 处理「关闭页面期间已结束」的情况：结算但不连锁自动开始', () => {
  const s = settings({ autoStartBreaks: true });
  const raw = core.serialize(Object.assign(core.start(core.createState(s, T0), T0), {}));
  const restored = core.restore(raw, s, T0 + 3 * 60 * MIN);

  assert.ok(restored.completed);
  assert.equal(restored.completed.phase, 'focus');
  assert.equal(restored.state.phase, 'short');
  assert.equal(restored.state.running, false, '恢复时不应自动接续');
  assert.equal(restored.state.focusDone, 1);
});

test('restore 对损坏数据回退到全新状态', () => {
  const s = settings();
  for (const bad of [null, undefined, 'nope', 42, { phase: 'nonsense' }]) {
    const restored = core.restore(bad, s, T0);
    assert.equal(restored.state.phase, 'focus');
    assert.equal(restored.state.remainingMs, 25 * MIN);
    assert.equal(restored.state.running, false);
  }
});

test('restore 会丢弃缺少 endAt 的「假运行」状态', () => {
  const s = settings();
  const restored = core.restore(
    { phase: 'focus', durationMs: 25 * MIN, remainingMs: 10 * MIN, running: true, endAt: null, focusDone: 0 },
    s,
    T0
  );
  assert.equal(restored.state.running, false);
  assert.equal(restored.state.remainingMs, 10 * MIN);
});
