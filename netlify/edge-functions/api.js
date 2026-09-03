/**
 * OneClass secure API gateway — Netlify EDGE function (Deno, runs at the PoP
 * nearest the user; Seoul/Tokyo for KR traffic instead of us-east-1 Lambda).
 *
 * Behaviour is identical to netlify/functions/api.mjs — same routes, same
 * authorization matrix, same HMAC token format (a token issued by either
 * implementation verifies in the other, so the cutover needs no re-login).
 * The Lambda version is kept as a fallback; flip netlify.toml to switch back.
 *
 * Env (must be set for the deploy context):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_SIGNING_SECRET
 */

import { surveyForm, surveySubmit, surveyPhoto } from '../lib/survey.mjs';
import { loadRoleContext, scopeStudentsQuery, filterBody, isPrivileged } from '../lib/rolefilter.mjs';

const FILTERED_TABLES = new Set(['students', 'surveys', 'life_records']);

const env = (k) => {
  try { if (typeof Netlify !== 'undefined') return Netlify.env.get(k); } catch {}
  try { return Deno.env.get(k); } catch {}
  return undefined;
};

const SUPABASE_URL = (env('SUPABASE_URL') || '').replace(/\/+$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY') || '';
const SIGNING_SECRET = env('AUTH_SIGNING_SECRET') || '';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h

// Gemini keys live server-side only. Comma-separated; rotated on 429.
const GEMINI_KEYS = (env('GEMINI_API_KEYS') || env('VITE_GEMINI_API_KEYS') || '')
  .split(',').map((k) => k.trim()).filter(Boolean);

const WRITABLE_BUCKETS = new Set(['evidence-photos']);

const TABLE_RULES = {
  schools:             { read: true,  write: ['PATCH'] },
  school_units:        { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  roles:               { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  record_types:        { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  survey_schema:       { read: true,  write: ['POST', 'PATCH'] },
  form_tokens:         { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  students:            { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  teachers:            { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  surveys:             { read: true,  write: ['POST', 'PATCH'] },
  life_records:        { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  record_comments:     { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  custom_menus:        { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  student_insights:    { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  schedules:           { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  quiz_scores:         { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  preset_categories:   { read: true,  write: ['POST', 'PATCH', 'DELETE'] },
  student_history:     { read: true,  write: [] },
  teacher_history:     { read: true,  write: [] },
  class_record_counts: { read: true,  write: [] },
  user_logs:           { read: false, write: ['POST'] },
  access_logs:         { read: false, write: ['POST'] },
};

// Tenant-scoped tables: every request is force-filtered / stamped with the
// session's school_id so one school can never read or write another's rows.
// `schools` scopes on `id`; everything else on `school_id`.
const SCOPED_TABLES = new Set([
  'schools', 'school_units', 'roles', 'record_types', 'survey_schema', 'form_tokens',
  'students', 'teachers', 'surveys', 'life_records', 'record_comments',
  'custom_menus', 'student_insights', 'schedules', 'quiz_scores',
  'preset_categories', 'class_record_counts',
]);

// Mutations on these tables require the caller's role_key === 'admin'.
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
  qs.append(scopeColumn(table), `eq.${schoolId}`); // AND-ed by PostgREST — client can't widen
  return `?${qs.toString()}`;
}

function scopedBody(table, bodyText, schoolId) {
  if (table === 'schools') return bodyText; // scoped by id filter, no stamp
  try {
    const parsed = JSON.parse(bodyText);
    const stamp = (o) => (o && typeof o === 'object' ? { ...o, school_id: schoolId } : o);
    return JSON.stringify(Array.isArray(parsed) ? parsed.map(stamp) : stamp(parsed));
  } catch {
    return bodyText;
  }
}

// Resolve the tenant subdomain label from an explicit value or a hostname.
function tenantFromHost(host) {
  if (!host) return '';
  const m = String(host).toLowerCase().match(/^([a-z][a-z0-9-]{2,30})\.creat1324\.com$/);
  return m ? m[1] : '';
}

const FORWARD_HEADERS = ['accept', 'prefer', 'range', 'content-type', 'content-profile', 'accept-profile'];

// ---- base64url helpers ---------------------------------------------------
function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function strToB64url(str) {
  return bytesToB64url(new TextEncoder().encode(str));
}
function b64urlToBytes(b64) {
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- session token (stateless HMAC-SHA256, Web Crypto) ------------------
let _keyPromise = null;
function hmacKey() {
  if (!_keyPromise) {
    _keyPromise = crypto.subtle.importKey(
      'raw', new TextEncoder().encode(SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
  }
  return _keyPromise;
}
async function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const body = strToB64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`;
}
async function verifyToken(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 1) return null;
  const [body, sig] = token.split('.');
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(), b64urlToBytes(sig), new TextEncoder().encode(body));
  } catch { return null; }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); } catch { return null; }
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---- supabase REST helper (service role) --------------------------------
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

const json = (status, obj, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

function audit(email, action) {
  sbRest('user_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ teacher_email: email, page_path: 'api-gateway', action }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
export default async (request) => {
  if (!SUPABASE_URL || !SERVICE_KEY || !SIGNING_SECRET) {
    return json(500, { error: 'server_misconfigured' });
  }

  const url = new URL(request.url);
  const method = request.method;
  const search = url.search; // includes leading "?" or ""
  const sub = url.pathname.replace(/^\/+/, '').replace(/^api\//, '').replace(/^\/+/, '');
  const origin = request.headers.get('origin') || '*';

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,x-teacher-token,apikey,content-type,accept,prefer,range,x-client-info,x-upsert,cache-control',
        'Access-Control-Expose-Headers': 'content-range,content-profile',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // ---- public bucket reads: 302 straight to Supabase ----
    if (sub.startsWith('storage/v1/object/public/') && (method === 'GET' || method === 'HEAD')) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${SUPABASE_URL}/${sub}`, 'Cache-Control': 'public, max-age=300' },
      });
    }

    // ---- POST /api/login  { email, domain? } ----
    if (sub === 'login' && method === 'POST') {
      let email = '', domain = '';
      try {
        const b = JSON.parse(await request.text() || '{}');
        email = String(b.email || '').trim().toLowerCase();
        domain = String(b.domain || '').trim().toLowerCase();
      } catch {}
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'invalid_email' });

      // tenant: explicit domain wins, else derive from Origin/Referer host
      domain = domain
        || tenantFromHost(new URL(request.headers.get('origin') || 'http://x').hostname)
        || tenantFromHost(request.headers.get('referer') ? new URL(request.headers.get('referer')).hostname : '');
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
      const token = await signToken({
        email: t.email, name: t.name || '',
        school_id: schoolId, domain,
        role_key: roleKey, role: roleKey,          // `role` kept for back-compat
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
      const { status, body } = await surveyForm(sbRest, url.searchParams.get('token'));
      return json(status, body, { 'Cache-Control': 'no-store' });
    }
    if (sub === 'survey/submit' && method === 'POST') {
      let b = {};
      try { b = JSON.parse(await request.text() || '{}'); } catch {}
      const { status, body } = await surveySubmit(sbRest, b);
      return json(status, body);
    }
    if (sub === 'survey/photo' && method === 'POST') {
      const { status, body } = await surveyPhoto(
        sbRest, SUPABASE_URL, SERVICE_KEY,
        url.searchParams.get('token'), url.searchParams.get('sid'),
        request.headers.get('content-type'), await request.arrayBuffer(),
      );
      return json(status, body);
    }

    // ---- everything below requires a valid session token ----
    const token = request.headers.get('x-teacher-token') ||
      (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const session = await verifyToken(token);
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
      // survey field labels only (no responses) — pages use this to render 상세 기초조사 순서/라벨
      const svFields = (Array.isArray(sv) && sv[0] && sv[0].fields || [])
        .filter((f) => !f.hidden).sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((f) => ({ id: f.id, label: f.label, type: f.type, group: f.group, order: f.order, piiLevel: f.piiLevel }));
      return json(200, {
        school: Array.isArray(sc) ? sc[0] || null : null,
        units: Array.isArray(un) ? un : [],
        roles,
        survey: { fields: svFields, languages: (Array.isArray(sv) && sv[0] && sv[0].languages) || ['ko'] },
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
      try { b = JSON.parse(await request.text() || '{}'); } catch {}
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
        if (gr.status === 429) { last = gt; continue; } // rate limited on this key → rotate
        audit(session.email, `GEMINI ${model}`);
        return new Response(gt, {
          status: gr.status,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      return new Response(last || '{"error":{"message":"all keys rate limited"}}', {
        status: 429, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // ---- PostgREST passthrough ----
    if (sub.startsWith('rest/v1/')) {
      const restPath = sub.slice('rest/v1/'.length);
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

      // tenant isolation
      let scopedSearchStr = search;
      if (SCOPED_TABLES.has(table)) {
        if (!session.school_id) return json(409, { error: 'legacy_token_no_tenant' });
        scopedSearchStr = scopedSearch(table, search, session.school_id);
      }

      // role-based filtering (GET only): load perms + record_types, scope students query
      let roleCtx = null;
      if ((method === 'GET') && FILTERED_TABLES.has(table)) {
        roleCtx = await loadRoleContext(sbRest, session.school_id, session.role_key || session.role);
        if (table === 'students') {
          scopedSearchStr = scopeStudentsQuery(scopedSearchStr, roleCtx.perms, session.role_key || session.role, session.homeroom);
        }
      }

      const fwd = {};
      for (const h of FORWARD_HEADERS) {
        const v = request.headers.get(h);
        if (v != null) fwd[h[0].toUpperCase() + h.slice(1)] = v;
      }

      let outBody;
      if (['POST', 'PATCH'].includes(method)) {
        outBody = await request.text();
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
        try { text = filterBody(table, text, { ...roleCtx, roleKey: session.role_key || session.role }); } catch { /* fail-open on parse only */ }
      }

      if (method !== 'GET' && method !== 'HEAD') audit(session.email, `${method} ${table}`);
      return new Response(text, { status: resp.status, headers: out });
    }

    // ---- authenticated storage upload proxy ----
    if (sub.startsWith('storage/v1/object/')) {
      const rest = sub.slice('storage/v1/object/'.length);
      const bucket = rest.split('/')[0];
      if (!WRITABLE_BUCKETS.has(bucket)) return json(403, { error: 'bucket_forbidden', bucket });
      if (!['POST', 'PUT'].includes(method)) return json(405, { error: 'method_not_allowed' });

      const upHeaders = {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': request.headers.get('content-type') || 'application/octet-stream',
      };
      const xu = request.headers.get('x-upsert'); if (xu) upHeaders['x-upsert'] = xu;
      const cc = request.headers.get('cache-control'); if (cc) upHeaders['cache-control'] = cc;

      const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${rest}`, {
        method, headers: upHeaders, body: await request.arrayBuffer(),
      });
      const text = await resp.text();
      audit(session.email, `UPLOAD ${bucket}`);
      return new Response(text, {
        status: resp.status,
        headers: { 'Content-Type': resp.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    return json(404, { error: 'not_found', route: sub });
  } catch (e) {
    return json(502, { error: 'gateway_error', detail: String((e && e.message) || e) });
  }
};

export const config = { path: '/api/*' };
