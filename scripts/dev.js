// 로컬 실행용 간단 서버: 정적 파일 + /api/* 를 Vercel 함수처럼 호출
// 사용법: npm run dev → http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

// .env 읽기
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const file = path.join(root, 'api', path.basename(url.pathname) + '.js');
      if (!fs.existsSync(file)) return res.writeHead(404).end('not found');
      const { default: handler } = await import(pathToFileURL(file));
      req.query = Object.fromEntries(url.searchParams);
      res.status = (code) => ((res.statusCode = code), res);
      res.json = (body) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
      };
      return handler(req, res);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));
