/**
 * OneClass secure API gateway (Netlify Function).
 *
 * Replaces the old model where the browser shipped the Supabase service_role key.
 * The browser now holds only a short-lived HMAC-signed session token; this
 * function validates it, enforces per-table authorization, and talks to Supabase
 * with the service_role key which lives ONLY in Netlify env vars.
 *
 * Routes (mounted at /api/* via netlify.toml redirect):
 *   POST /api/login                     { email }  -> { token, email, role, name }
 *   GET  /api/session                              -> { email, role, name }
 *   ANY  /api/rest/v1/<table>?<query>              -> PostgREST passthrough (authorized)
 *   GET  /api/storage/v1/object/public/<b>/<p>     -> 302 to Supabase (no auth)
 *   POST /api/storage/v1/object/<bucket>/<path>    -> authenticated upload proxy
 *
 * Env:
 *   SUPABASE_URL                 e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    service_role JWT (server only)
 *   AUTH_SIGNING_SECRET          random string >= 32 chars, for session-token HMAC
 */
import crypto from 'node:crypto';
import { surveyForm, surveySubmit, surveyPhoto } from '../lib/survey.mjs';
import { signupSchool } from '../lib/signup.mjs';
import { provisionConfig, provisionTenantDomain } from '../lib/provision.mjs';
import { loadRoleContext, scopeStudentsQuery, filterBody, isPrivileged } from '../lib/rolefilter.mjs';

const lambdaEnv = (k) => process.env[k];

const FILTERED_TABLES = new Set(['students', 'surveys', 'life_records']);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SIGNING_SECRET = process.env.AUTH_SIGNING_SECRET || '';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h

const WRITABLE_BUCKETS = new Set(['evidence-photos']);

// Gemini keys live server-side only. Comma-separated; rotated on 429.
const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.VITE_GEMINI_API_KEYS || '')
  .split(',').map((k) => k.trim()).filter(Boolean);

// ---- table authorization matrix -------------------------------------------
// read: any authenticated teacher. write: allowed HTTP methods for a valid teacher.
// Anything not listed is denied. DELETE on roster/identity tables is never allowed.
const TABLE_RULES = {
  schools:           { read: true,  write: ['PATCH'] },
  school_units:      { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  roles:             { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  record_types:      { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  survey_schema:     { read: true,  write: ['POST', 'PATCH'] },
  form_tokens:       { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  consents:          { read: true,  write: ['POST'] },
  students:          { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  teachers:          { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  surveys:           { read: true,  write: ['POST', 'PATCH'] },
  life_records:      { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  record_comments:   { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  custom_menus:      { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  student_insights:  { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  schedules:         { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  quiz_scores:       { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  preset_categories: { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  student_history:   { read: true,  write: [] },
  teacher_history:   { read: true,  write: [] },
  class_record_counts: { read: true, write: [] },   // aggregate view for the dashboard
  user_logs:         { read: false, write: ['POST'] },
  access_logs:       { read: false, write: ['POST'] },
};

// Tenant-scoped tables: every request is force-filtered / stamped with the
// session's school_id. `schools` scopes on `id`; everything else on `school_id`.
const SCOPED_TABLES = new Set([
  'schools', 'school_units', 'roles', 'record_types', 'survey_schema', 'form_tokens',
  'students', 'teachers', 'surveys', 'life_records', 'record_comments',
  'custom_menus', 'student_insights', 'schedules', 'quiz_scores',
  'preset_categories', 'class_record_counts', 'consents',
]);

const ADMIN_ONLY_WRITE = new Set([
  'schools', 'school_units', 'roles', 'record_types', 'survey_schema', 'form_tokens',
  'teachers', 'preset_categories',
]);

// DELETE on these needs admin (teachers may PATCH students for contact edits, but not delete rosters).
const DELETE_ADMIN_ONLY = new Set(['students']);

const scopeColumn = (table) => (table === 'schools' ? 'id' : 'school_id');

function scopedSearch(table, search, schoolId) {
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  // supabase-js upsert adds ?columns=... which PostgREST uses as an insert whitelist —
  // the school_id we inject into the body is dropped unless it is also listed here.
  const cols = qs.get('columns');
  if (cols && !cols.split(',').map((c) => c.replace(/"/g, '').trim()).includes(scopeColumn(table))) {
    qs.set('columns', `${cols},${scopeColumn(table)}`);
  }
  qs.append(scopeColumn(table), `eq.${schoolId}`);
  return `?${qs.toString()}`;
}

function scopedBody(table, bodyText, schoolId) {
  if (table === 'schools' || bodyText == null) return bodyText;
  try {
    const parsed = JSON.parse(bodyText.toString());
    const stamp = (o) => (o && typeof o === 'object' ? { ...o, school_id: schoolId } : o);
    return JSON.stringify(Array.isArray(parsed) ? parsed.map(stamp) : stamp(parsed));
  } catch {
    return bodyText;
  }
}

function tenantFromHost(host) {
  if (!host) return '';
  const m = String(host).toLowerCase().match(/^([a-z][a-z0-9-]{2,30})\.creat1324\.com$/);
  return m ? m[1] : '';
}

// headers we forward from the browser's supabase-js request to PostgREST
const FORWARD_HEADERS = ['accept', 'prefer', 'range', 'content-type', 'content-profile', 'accept-profile'];

// ---- session token (stateless HMAC) --------------------------------------
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const sig = b64url(crypto.createHmac('sha256', SIGNING_SECRET).update(body).digest());
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 1) return null;
  const [body, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', SIGNING_SECRET).update(body).digest());
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch { return null; }
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---- supabase REST helper (service role) ---------------------------------
const sbRest = (pathWithQuery, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body,
  });

const json = (statusCode, obj, extra = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  body: JSON.stringify(obj),
});

function rawBody(event) {
  if (event.body == null) return null;
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
}

// ---------------------------------------------------------------------------
export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY || !SIGNING_SECRET) {
    return json(500, { error: 'server_misconfigured' });
  }

  const method = event.httpMethod;
  const headers = event.headers || {};

  // Resolve path + query robustly. Prefer event.rawUrl (full original URL).
  let pathname = event.path || '';
  let search = '';
  try {
    if (event.rawUrl) {
      const u = new URL(event.rawUrl);
      pathname = u.pathname;
      search = u.search; // includes leading "?" or ""
    } else if (event.rawQuery) {
      search = event.rawQuery ? `?${event.rawQuery}` : '';
    }
  } catch { /* keep fallbacks */ }

  // strip either mount prefix; keep the remainder as the logical route
  const sub = pathname
    .replace(/^.*\/\.netlify\/functions\/api\/?/, '')
    .replace(/^.*\/api\//, '')
    .replace(/^\/+/, '');

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: {
      'Access-Control-Allow-Origin': headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,x-teacher-token,apikey,content-type,accept,prefer,range,x-client-info,x-upsert,cache-control',
      'Access-Control-Expose-Headers': 'content-range,content-profile',
      'Access-Control-Max-Age': '86400',
    } };
  }

  try {
    // ---- public bucket reads: 302 straight to Supabase (cacheable, no auth) ----
    if (sub.startsWith('storage/v1/object/public/') && (method === 'GET' || method === 'HEAD')) {
      return { statusCode: 302, headers: { Location: `${SUPABASE_URL}/${sub}`, 'Cache-Control': 'public, max-age=300' } };
    }

    // ---- POST /api/login  { email, domain? } ----
    if (sub === 'login' && method === 'POST') {
      let email = '', domain = '';
      try {
        const b = JSON.parse(event.body || '{}');
        email = String(b.email || '').trim().toLowerCase();
        domain = String(b.domain || '').trim().toLowerCase();
      } catch {}
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'invalid_email' });

      domain = domain
        || tenantFromHost((headers.origin && (() => { try { return new URL(headers.origin).hostname; } catch { return ''; } })()) || '')
        || tenantFromHost((headers.referer && (() => { try { return new URL(headers.referer).hostname; } catch { return ''; } })()) || '');
      if (!domain) return json(400, { error: 'no_tenant' });

      const sr = await sbRest(`schools?select=id,status&domain_name=eq.${encodeURIComponent(domain)}&limit=1`);
      const schools = await sr.json().catch(() => null);
      if (!Array.isArray(schools) || !schools[0]) return json(404, { error: 'school_not_found', domain });
      if (schools[0].status !== 'active') return json(403, { error: 'school_suspended' });
      const schoolId = schools[0].id;

      const r = await sbRest(
        `teachers?select=email,name,role_key,extra_roles,homeroom_unit,active` +
        `&school_id=eq.${schoolId}&email=eq.${encodeURIComponent(email)}&limit=1`,
      );
      const rows = await r.json().catch(() => null);
      if (!Array.isArray(rows) || rows.length === 0) return json(401, { error: 'not_registered' });
      const t = rows[0];
      if (t.active === false) return json(403, { error: 'teacher_inactive' });

      const roleKey = t.role_key || 'subject';
      let homeroom = null;
      if (t.homeroom_unit) {
        const ur = await sbRest(`school_units?select=level_order,class_order&id=eq.${t.homeroom_unit}&limit=1`);
        const u = (await ur.json().catch(() => []))[0];
        if (u) homeroom = `${u.level_order}-${u.class_order}`;
      }
      const token = signToken({
        email: t.email, name: t.name || '',
        school_id: schoolId, domain,
        role_key: roleKey, role: roleKey,
        extra_roles: t.extra_roles || [], homeroom,
      });
      return json(200, {
        token, email: t.email, name: t.name || '',
        school_id: schoolId, domain, role: roleKey, role_key: roleKey,
        homeroom_unit: t.homeroom_unit || null,
      });
    }

    // ---- survey engine: UNAUTHENTICATED student-facing routes ----
    if (sub === 'survey/form' && method === 'GET') {
      const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const res = await surveyForm(sbRest, qs.get('token'));
      return json(res.status, res.body);
    }
    if (sub === 'survey/submit' && method === 'POST') {
      let b = {};
      try { b = JSON.parse(event.body || '{}'); } catch {}
      const res = await surveySubmit(sbRest, b, {
        ipHash: ipHashOf(headers),
        userAgent: headers['user-agent'] || '',
      });
      return json(res.status, res.body);
    }
    if (sub === 'survey/photo' && method === 'POST') {
      const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const buf = rawBody(event);
      const res = await surveyPhoto(
        sbRest, SUPABASE_URL, SERVICE_KEY, qs.get('token'), qs.get('sid'),
        headers['content-type'], buf && (buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf),
      );
      return json(res.status, res.body);
    }

    // ---- POST /api/signup — 셀프 학교 개설 (무인증) ----
    if (sub === 'signup' && method === 'POST') {
      let b = {};
      try { b = JSON.parse(event.body || '{}'); } catch {}
      const res = await signupSchool(sbRest, b, process.env.SIGNUP_CODE || '', provisionConfig(lambdaEnv));
      return json(res.status, res.body);
    }

    // ---- everything below requires a valid session token ----
    const token = headers['x-teacher-token'] || (headers.authorization || '').replace(/^Bearer\s+/i, '');
    const session = verifyToken(token);
    if (!session) return json(401, { error: 'unauthenticated' });

    if (sub === 'session' && method === 'GET') {
      return json(200, {
        email: session.email, name: session.name,
        role: session.role_key || session.role, role_key: session.role_key || session.role,
        school_id: session.school_id || null, domain: session.domain || null,
      });
    }

    // ---- GET /api/config  — school settings bundle for the SPA ----
    if (sub === 'config' && method === 'GET') {
      const sid = session.school_id;
      if (!sid) return json(409, { error: 'legacy_token_no_tenant' });
      const [sc, un, rl, sv, rt] = await Promise.all([
        sbRest(`schools?id=eq.${sid}&select=*&limit=1`).then((r) => r.json()).catch(() => []),
        sbRest(`school_units?school_id=eq.${sid}&select=*&order=level_order,class_order`).then((r) => r.json()).catch(() => []),
        sbRest(`roles?school_id=eq.${sid}&select=*&order=sort_order`).then((r) => r.json()).catch(() => []),
        sbRest(`survey_schema?school_id=eq.${sid}&select=fields,languages&limit=1`).then((r) => r.json()).catch(() => []),
        sbRest(`record_types?school_id=eq.${sid}&select=key,label,polarity,visible_to,fields,active&order=sort_order`).then((r) => r.json()).catch(() => []),
      ]);
      const roles = Array.isArray(rl) ? rl : [];
      const myRole = roles.find((x) => x.key === (session.role_key || session.role)) || null;
      const svFields = ((Array.isArray(sv) && sv[0] && sv[0].fields) || [])
        .filter((f) => !f.hidden).sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((f) => ({ id: f.id, label: f.label, type: f.type, group: f.group, order: f.order, piiLevel: f.piiLevel }));
      return json(200, {
        school: Array.isArray(sc) ? sc[0] || null : null,
        units: Array.isArray(un) ? un : [],
        roles,
        survey: { fields: svFields, languages: ((Array.isArray(sv) && sv[0] && sv[0].languages)) || ['ko'] },
        record_types: (Array.isArray(rt) ? rt : []).filter((x) => x.active !== false),
        me: {
          email: session.email, name: session.name,
          role_key: session.role_key || session.role,
          extra_roles: session.extra_roles || [],
          permissions: myRole ? myRole.permissions : {},
          landing_page: myRole ? myRole.landing_page : 'home',
        },
      }, { 'Cache-Control': 'no-store' });
    }

    // ---- Gemini proxy: POST /api/gemini { model, prompt, context } ----
    if (sub === 'gemini' && method === 'POST') {
      if (!GEMINI_KEYS.length) return json(500, { error: 'gemini_not_configured' });
      let b = {};
      try { b = JSON.parse(event.body || '{}'); } catch {}
      const prompt = typeof b.prompt === 'string' ? b.prompt : '';
      if (!prompt) return json(400, { error: 'no_prompt' });
      const model = /^gemini-[\w.-]+$/.test(b.model || '') ? b.model : 'gemini-2.0-flash';
      const text = (b.context ? String(b.context) + '\n' : '') + prompt;
      const gBody = JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      let last = null;
      for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const gr = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEYS[i]}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: gBody },
        );
        const gt = await gr.text();
        if (gr.status === 429) { last = gt; continue; } // rotate to next key
        audit(session.email, `GEMINI ${model}`);
        return { statusCode: gr.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: gt };
      }
      return { statusCode: 429, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: last || '{"error":{"message":"all keys rate limited"}}' };
    }

    // ---- POST /api/provision-domain — 관리자: 자기 학교 도메인 자동연결 재시도 ----
    if (sub === 'provision-domain' && method === 'POST') {
      if ((session.role_key || session.role) !== 'admin') return json(403, { error: 'admin_only' });
      if (!session.domain) return json(409, { error: 'no_tenant' });
      const res = await provisionTenantDomain(session.domain, provisionConfig(lambdaEnv));
      audit(session.email, `PROVISION ${session.domain}`);
      return json(res.ok ? 200 : 502, res);
    }

    // ---- 개인정보/컴플라이언스 (관리자 전용) ----
    if (sub === 'logs' && method === 'GET') {
      if ((session.role_key || session.role) !== 'admin') return json(403, { error: 'admin_only' });
      const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const kind = qs.get('kind') === 'user' ? 'user_logs' : 'access_logs';
      const timeCol = kind === 'access_logs' ? 'accessed_at' : 'created_at';
      const limit = Math.min(500, parseInt(qs.get('limit'), 10) || 100);
      let q = `${kind}?school_id=eq.${session.school_id}&select=*&order=${timeCol}.desc&limit=${limit}`;
      if (qs.get('since')) q += `&${timeCol}=gte.${encodeURIComponent(qs.get('since'))}`;
      const r = await sbRest(q);
      return json(r.status, await r.json().catch(() => []));
    }

    if (sub === 'purge' && method === 'POST') {
      if ((session.role_key || session.role) !== 'admin') return json(403, { error: 'admin_only' });
      let b = {};
      try { b = JSON.parse(event.body || '{}'); } catch {}
      const fn = b.kind === 'logs' ? 'purge_old_access_logs' : 'purge_expired_data';
      const dry = b.dry_run !== false;
      const r = await sbRest(`rpc/${fn}`, {
        method: 'POST',
        body: JSON.stringify({ p_school: session.school_id, p_dry_run: dry }),
      });
      const out = await r.json().catch(() => ({}));
      if (!dry && r.ok) audit(session.email, `PURGE ${fn}`, { target_type: JSON.stringify(out).slice(0, 120) });
      return json(r.status, out);
    }

    if (sub === 'student-export' && method === 'GET') {
      const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const pid = qs.get('pid') || '';
      if (!/^[0-9a-f-]{36}$/i.test(pid)) return json(400, { error: 'bad_pid' });
      const roleKey = session.role_key || session.role;
      if (roleKey !== 'admin' && roleKey !== 'homeroom') return json(403, { error: 'forbidden' });
      const [st, sv, lr, cs] = await Promise.all([
        sbRest(`students?pid=eq.${pid}&school_id=eq.${session.school_id}&select=*`).then((r) => r.json()).catch(() => []),
        sbRest(`surveys?student_pid=eq.${pid}&school_id=eq.${session.school_id}&select=*`).then((r) => r.json()).catch(() => []),
        sbRest(`life_records?student_pid=eq.${pid}&school_id=eq.${session.school_id}&select=*`).then((r) => r.json()).catch(() => []),
        sbRest(`consents?student_pid=eq.${pid}&school_id=eq.${session.school_id}&select=*`).then((r) => r.json()).catch(() => []),
      ]);
      if (!Array.isArray(st) || !st[0]) return json(404, { error: 'not_found' });
      if (roleKey === 'homeroom' && session.homeroom && st[0].class_info !== session.homeroom) {
        return json(403, { error: 'not_your_class' });
      }
      audit(session.email, `EXPORT student ${st[0].student_id || pid}`);
      logAccess(headers, session, 'EXPORT student', st[0].student_id || pid);
      return json(200, { student: st[0], surveys: sv, life_records: lr, consents: cs, exported_at: new Date().toISOString() });
    }

    // ---- PostgREST passthrough ----
    if (sub.startsWith('rest/v1/')) {
      const restPath = sub.slice('rest/v1/'.length);        // "<table>" (no query — Netlify puts it in rawQuery)
      const table = restPath.split('/')[0].split('?')[0];
      const rule = TABLE_RULES[table];
      if (!rule) return json(403, { error: 'table_forbidden', table });

      if (method === 'GET' || method === 'HEAD') {
        if (!rule.read) return json(403, { error: 'read_forbidden', table });
      } else if (['POST', 'PATCH', 'DELETE'].includes(method)) {
        if (!rule.write.includes(method)) return json(403, { error: 'write_forbidden', table, method });
        if (ADMIN_ONLY_WRITE.has(table) && (session.role_key || session.role) !== 'admin') {
          return json(403, { error: 'admin_only', table });
        }
        if (method === 'DELETE' && DELETE_ADMIN_ONLY.has(table) && (session.role_key || session.role) !== 'admin') {
          return json(403, { error: 'admin_only_delete', table });
        }
      } else {
        return json(405, { error: 'method_not_allowed' });
      }

      let scopedSearchStr = search;
      if (SCOPED_TABLES.has(table)) {
        if (!session.school_id) return json(409, { error: 'legacy_token_no_tenant' });
        scopedSearchStr = scopedSearch(table, search, session.school_id);
      }

      let roleCtx = null;
      if (method === 'GET' && FILTERED_TABLES.has(table)) {
        roleCtx = await loadRoleContext(sbRest, session.school_id, session.role_key || session.role);
        if (table === 'students') {
          scopedSearchStr = scopeStudentsQuery(scopedSearchStr, roleCtx.perms, session.role_key || session.role, session.homeroom);
        }
        if (/(student_pid|student_id|pid|contact|sensitive)=/.test(scopedSearchStr || '')) {
          logAccess(headers, session, `READ ${table}`, scopedSearchStr);
        }
      }

      const fwd = {};
      for (const h of FORWARD_HEADERS) if (headers[h] != null) fwd[h[0].toUpperCase() + h.slice(1)] = headers[h];

      let outBody;
      if (['POST', 'PATCH'].includes(method)) {
        outBody = rawBody(event);
        if (SCOPED_TABLES.has(table)) outBody = scopedBody(table, outBody, session.school_id);
      }

      const resp = await sbRest(`${table}${scopedSearchStr}`, {
        method,
        headers: fwd,
        body: outBody,
      });

      let text = await resp.text();
      const out = { 'Content-Type': resp.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' };
      const cr = resp.headers.get('content-range'); if (cr) out['Content-Range'] = cr;
      const cp = resp.headers.get('content-profile'); if (cp) out['Content-Profile'] = cp;

      if (roleCtx && resp.ok && !isPrivileged(roleCtx.perms, session.role_key || session.role)) {
        try { text = filterBody(table, text, { ...roleCtx, roleKey: session.role_key || session.role }); } catch { /* parse fail-open */ }
      }

      if (method !== 'GET' && method !== 'HEAD') audit(session.email, `${method} ${table}`);
      return { statusCode: resp.status, headers: out, body: text };
    }

    // ---- authenticated storage upload proxy ----
    if (sub.startsWith('storage/v1/object/')) {
      const rest = sub.slice('storage/v1/object/'.length);   // <bucket>/<path...>
      const bucket = rest.split('/')[0];
      if (!WRITABLE_BUCKETS.has(bucket)) return json(403, { error: 'bucket_forbidden', bucket });
      if (!['POST', 'PUT'].includes(method)) return json(405, { error: 'method_not_allowed' });

      const upHeaders = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': headers['content-type'] || 'application/octet-stream',
      };
      if (headers['x-upsert']) upHeaders['x-upsert'] = headers['x-upsert'];
      if (headers['cache-control']) upHeaders['cache-control'] = headers['cache-control'];

      const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${rest}`, {
        method, headers: upHeaders, body: rawBody(event),
      });
      const text = await resp.text();
      audit(session.email, `UPLOAD ${bucket}`);
      return { statusCode: resp.status, headers: { 'Content-Type': resp.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' }, body: text };
    }

    return json(404, { error: 'not_found', route: sub });
  } catch (e) {
    return json(502, { error: 'gateway_error', detail: String((e && e.message) || e) });
  }
};

// fire-and-forget audit trail into user_logs
function audit(email, action, extra = {}) {
  sbRest('user_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ teacher_email: email, page_path: 'api-gateway', action, result: 'ok', ...extra }),
  }).catch(() => {});
}

function ipHashOf(headers) {
  const ip = headers['x-nf-client-connection-ip']
    || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '0';
  try { return crypto.createHash('sha256').update(`${ip}|${SIGNING_SECRET}`).digest('base64url').slice(0, 22); }
  catch { return null; }
}

// 개인정보처리시스템 접속기록 (비동기)
function logAccess(headers, session, actionType, detail) {
  sbRest('access_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      school_id: session.school_id, teacher_email: session.email,
      action_type: actionType, ip_hash: ipHashOf(headers), detail: (detail || '').slice(0, 300),
    }),
  }).catch(() => {});
}
