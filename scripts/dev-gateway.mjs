/**
 * Local dev shim for the Netlify gateway (`netlify/functions/api.mjs`).
 *
 * Lets you run the SPA against the real Supabase project without netlify-cli:
 *   1) fill SUPABASE_SERVICE_ROLE_KEY in .env
 *   2)  node scripts/dev-gateway.mjs      (this — serves /api on :8787)
 *   3)  npm run dev                       (vite proxies /api → :8787)
 *   4)  open http://127.0.0.1:5173/admin-console.html?school=demo
 *
 * Not used in production — Netlify serves the edge/lambda function there.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// minimal .env loader (avoid hard dep ordering issues)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('PASTE')) {
  console.error('\n  ✗ .env 의 SUPABASE_SERVICE_ROLE_KEY 를 먼저 채워주세요.\n');
  process.exit(1);
}

const { handler } = await import('../netlify/functions/api.mjs');
const PORT = process.env.GH_DEV_GATEWAY_PORT || 8787;

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyBuf = Buffer.concat(chunks);
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const event = {
    httpMethod: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v])),
    path: url.pathname,
    rawUrl: `http://localhost:${PORT}${req.url}`,
    rawQuery: url.search.replace(/^\?/, ''),
    body: bodyBuf.length ? bodyBuf.toString('utf8') : null,
    isBase64Encoded: false,
  };

  try {
    const r = await handler(event);
    const h = { ...(r.headers || {}) };
    h['Access-Control-Allow-Origin'] = req.headers.origin || '*';
    h['Access-Control-Allow-Headers'] = 'authorization,x-teacher-token,content-type,accept,prefer,range,x-client-info,apikey,cache-control,x-upsert';
    h['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,DELETE,HEAD,OPTIONS';
    res.writeHead(r.statusCode || 200, h);
    res.end(r.body || '');
  } catch (e) {
    console.error('gateway error', e);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'dev_gateway_error', detail: String(e?.message || e) }));
  }
}).listen(PORT, () => {
  console.log(`\n  ✓ dev gateway  →  http://localhost:${PORT}/api/*`);
  console.log(`    SUPABASE_URL = ${process.env.SUPABASE_URL}`);
  console.log(`    이제 다른 터미널에서:  npm run dev\n`);
});
