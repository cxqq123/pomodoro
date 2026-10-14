/**
 * 运行浏览器自检。
 *
 *   node tools/run-selftest.mjs [--screenshots <目录>] [--budget <虚拟毫秒>]
 *
 * 起一个临时静态服务器 → 用无头 Chrome 打开 tools/selftest.html
 * （无头浏览器无法用 CDP WebSocket，所以让页面自己把报告写进 DOM，
 *   再用 --dump-dom 取回来）→ 解析报告 → 失败时以非 0 退出。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const SHOT_DIR = argValue('--screenshots', null);
const BUDGET = Number(argValue('--budget', '60000'));
const SKIP_TESTS = argv.includes('--skip-tests');

const APPS = ['index.html', 'pomodoro.html'];

const SCENARIOS = [
  ['running', '02-running.png'],
  ['break', '03-short-break.png'],
  ['settings', '04-settings.png']
];

function startServer() {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, path.normalize(rel === '/' ? '/index.html' : rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end('forbidden');
    try {
      const body = await fsp.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function runChrome(chrome, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, out, err }));
  });
}

function decodeEntities(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractReport(dom) {
  const match = dom.match(/<pre id="report">([\s\S]*?)<\/pre>/);
  if (!match) return null;
  return decodeEntities(match[1])
    .split('\n')
    .filter((line, i) => !(i === 0 && line.trim() === '运行中…'))
    .join('\n')
    .trim();
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    console.error('未找到 Chrome，可用 CHROME_PATH 环境变量指定路径');
    process.exit(1);
  }

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'pomodoro-selftest-'));
  const common = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`
  ];

  let exitCode = 0;
  try {
    if (!SKIP_TESTS) {
      // 多文件版与单文件版（构建产物）跑同一套断言，保证两者行为一致
      for (const app of APPS) {
        const label = `${app}${app === 'pomodoro.html' ? '（单文件版）' : '（多文件版）'}`;
        console.log(`\n▶ 被测页面 ${base}/${label}`);
        const { out } = await runChrome(chrome, [
          ...common,
          '--virtual-time-budget=' + BUDGET,
          '--dump-dom',
          `${base}/tools/selftest.html?app=${app}`
        ]);

        const report = extractReport(out);
        if (!report || !/SUMMARY/.test(report)) {
          console.error(`❌ ${app}：没有拿到自检报告，页面可能在加载或执行时出错。`);
          if (report) console.error(report);
          console.error('--- DOM 片段 ---');
          console.error(out.slice(0, 1500));
          exitCode = 1;
        } else {
          console.log(report);
          if (!/SUMMARY PASS/.test(report)) exitCode = 1;
        }
      }
    }

    if (SHOT_DIR) {
      await fsp.mkdir(SHOT_DIR, { recursive: true });
      // 统一走 scenario 入口：它会先清空 localStorage，避免上一轮跑测试留下的状态串味
      await runChrome(chrome, [
        ...common,
        '--window-size=760,1100',
        '--virtual-time-budget=8000',
        `--screenshot=${path.join(SHOT_DIR, '01-initial.png')}`,
        `${base}/tools/selftest.html?scenario=initial`
      ]);
      for (const [scenario, file] of SCENARIOS) {
        await runChrome(chrome, [
          ...common,
          '--window-size=760,1100',
          '--virtual-time-budget=8000',
          `--screenshot=${path.join(SHOT_DIR, file)}`,
          `${base}/tools/selftest.html?scenario=${scenario}`
        ]);
      }
      console.log(`\n📸 截图已保存到 ${SHOT_DIR}`);
    }
  } finally {
    server.close();
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log(exitCode === 0 ? '\n✅ 自检通过' : '\n❌ 自检未通过');
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('自检运行失败：', err);
  process.exit(1);
});
