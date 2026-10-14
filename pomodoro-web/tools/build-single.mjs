/**
 * 构建单文件版：node tools/build-single.mjs [输出文件]
 *
 * 把 styles.css / timer-core.js / app.js 全部内联进 index.html，
 * 产出一个「双击即用、可以直接发给别人、沙箱预览也能正常显示」的
 * 独立 HTML（默认写到项目根目录的 pomodoro.html）。
 *
 * 为什么需要它：某些预览器 / 阅读器出于安全策略禁止页面加载同目录的
 * 外部资源，多文件版会变成没有样式的裸 HTML；单文件版没有这个依赖。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'pomodoro.html');

const read = (rel) => fsp.readFile(path.join(ROOT, rel), 'utf8');

/** 内联到 <script> 里的内容不能出现 </script>，否则会提前闭合标签 */
function assertSafeForInlineScript(code, name) {
  if (/<\/script/i.test(code)) {
    throw new Error(`${name} 含有 </script>，无法安全内联`);
  }
  return code;
}

async function main() {
  const [html, css, core, app] = await Promise.all([
    read('index.html'),
    read('styles.css'),
    read('timer-core.js'),
    read('app.js')
  ]);

  assertSafeForInlineScript(core, 'timer-core.js');
  assertSafeForInlineScript(app, 'app.js');

  const banner = '<!-- 单文件版：由 tools/build-single.mjs 从 index.html / styles.css / timer-core.js / app.js 生成，勿直接修改 -->';

  const out = html
    .replace(
      / {2}<link rel="stylesheet" href="styles\.css" \/>/,
      `  <style>\n${css.trimEnd()}\n  </style>`
    )
    .replace(
      / {2}<script src="timer-core\.js"><\/script>\n {2}<script src="app\.js"><\/script>/,
      `  <script>\n${core.trimEnd()}\n  </script>\n  <script>\n${app.trimEnd()}\n  </script>`
    )
    .replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${banner}`);

  if (out.includes('href="styles.css"') || out.includes('src="app.js"') || out.includes('src="timer-core.js"')) {
    throw new Error('内联失败：仍有外部资源引用，请检查 index.html 的引用写法');
  }

  await fsp.writeFile(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
  console.log(`✅ 已生成单文件版：${path.relative(ROOT, OUT)}（${kb} KB，无任何外部依赖）`);
}

main().catch((err) => {
  console.error('构建失败：', err.message);
  process.exit(1);
});
