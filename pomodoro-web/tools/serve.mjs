/**
 * 本地静态服务器：node tools/serve.mjs [端口]
 *
 * 直接双击 index.html（file://）也能用，但 Chrome 会限制 file:// 下的
 * localStorage 与桌面通知权限；用这个脚本通过 http://127.0.0.1 打开就能
 * 完整使用「记忆设置 / 今日统计 / 桌面通知」这些能力。
 */
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, path.normalize(rel === '/' ? '/index.html' : rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`🍅 番茄时钟：http://127.0.0.1:${PORT}/`);
  console.log('   Ctrl+C 停止');
});
