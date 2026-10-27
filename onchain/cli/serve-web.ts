import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// 검증 화면(web/) 로컬 미리보기용 정적 서버. ES 모듈은 file://로 열면 브라우저가 막기 때문에 필요하다.
const ROOT = join(__dirname, "..", "web");
const PORT = Number(process.env.PORT ?? 4173);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const file = normalize(join(ROOT, path === "/" ? "verify.html" : path));
  if (!file.startsWith(ROOT) || !TYPES[extname(file)]) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)], "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, "127.0.0.1", () => console.log(`검증 화면: http://127.0.0.1:${PORT}/`));
