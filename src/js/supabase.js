/**
 * Supabase client — routed through the OneClass API gateway.
 *
 * The browser no longer holds any Supabase key. Every REST / storage-write call
 * goes to /api/* (Netlify Function) which validates the session token and talks
 * to Supabase with the service_role key server-side.
 *
 * Public bucket reads (student photos) still go straight to Supabase — they need
 * no key and proxying every image through a function would be slow.
 */
import { createClient } from '@supabase/supabase-js';
import CryptoJS from 'crypto-js';
import { API_CONFIG } from './config.js';

// Public project origin — safe to expose (not a secret; only public-bucket URLs).
// NOTE: reference specific VITE_ keys only — a bare `import.meta.env` makes vite
// inline the ENTIRE env object (which may contain other secrets) into the bundle.
// GlobalHub uses its OWN Supabase project — never the 경성전자고 DB.
// Must be set via VITE_PUBLIC_SUPABASE_URL at build time.
export const PUBLIC_SUPABASE_URL = import.meta.env.VITE_PUBLIC_SUPABASE_URL || '';
if (!PUBLIC_SUPABASE_URL) {
  console.warn('[GlobalHub] VITE_PUBLIC_SUPABASE_URL 미설정 — 학생 사진 등 public URL이 동작하지 않습니다.');
}

const GATEWAY = `${location.origin}/api`;
const SESSION_KEY = 'oc_session';
const LEGACY_KEY = 'teacher_auth_token';

/**
 * Current tenant subdomain label.
 *  - production:  <domain>.creat1324.com  → "<domain>"
 *  - dev / preview: ?school=<domain> query param, else localStorage('gh_tenant')
 */
export function getTenantDomain() {
  const m = location.hostname.toLowerCase().match(/^([a-z][a-z0-9-]{2,30})\.creat1324\.com$/);
  if (m) return m[1];
  const q = new URLSearchParams(location.search).get('school');
  if (q) { try { localStorage.setItem('gh_tenant', q); } catch {} return q.toLowerCase(); }
  try { return (localStorage.getItem('gh_tenant') || '').toLowerCase(); } catch { return ''; }
}

export function getSessionToken() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; }
}
export function setSessionToken(t) {
  try { t ? localStorage.setItem(SESSION_KEY, t) : localStorage.removeItem(SESSION_KEY); } catch {}
}

function decodeLegacyEmail() {
  try {
    const enc = localStorage.getItem(LEGACY_KEY);
    if (!enc) return '';
    return CryptoJS.AES.decrypt(enc, API_CONFIG.SECRET_KEY).toString(CryptoJS.enc.Utf8) || '';
  } catch { return ''; }
}

/**
 * Exchange a teacher email for a signed session token.
 * Also refreshes the legacy AES token so existing display/stamping code keeps working.
 * Returns { ok, email, role, name } or { ok:false, error }.
 */
export async function loginTeacher(email) {
  const clean = String(email || '').trim().toLowerCase();
  try {
    const r = await fetch(`${GATEWAY}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clean, domain: getTenantDomain() }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body.error || `http_${r.status}` };
    setSessionToken(body.token);
    try { localStorage.setItem(LEGACY_KEY, CryptoJS.AES.encrypt(body.email, API_CONFIG.SECRET_KEY).toString()); } catch {}
    return {
      ok: true, email: body.email, role: body.role, role_key: body.role_key,
      name: body.name, school_id: body.school_id, domain: body.domain,
      homeroom_unit: body.homeroom_unit,
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export function logout() {
  setSessionToken('');
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
}

let _migrating = null;
/** Ensure a gateway session token exists; auto-migrate from the legacy AES token. */
export async function ensureSession() {
  if (getSessionToken()) return getSessionToken();
  if (_migrating) return _migrating;
  const email = decodeLegacyEmail();
  if (!email) return '';
  _migrating = loginTeacher(email).then(r => (r.ok ? getSessionToken() : '')).finally(() => { _migrating = null; });
  return _migrating;
}

/** Decode the (unverified) payload of a gateway session token. */
function decodeToken(token) {
  try {
    const body = String(token).split('.')[0];
    const pad = body.length % 4 ? '='.repeat(4 - (body.length % 4)) : '';
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/') + pad));
    return json && json.exp ? json : null;
  } catch { return null; }
}

/**
 * Validate the stored session. Returns {email,role,name} | {offline:true} | null.
 *
 * Fast path: the token carries its own `exp`; if it's comfortably unexpired we
 * trust it locally and skip the ~350ms round trip to the US-region function.
 * This is safe because the gateway re-verifies the HMAC signature on EVERY real
 * data request — a forged/tampered token can read nothing.
 * We only hit /api/session when there's no usable token (near/after expiry),
 * where a 401 must translate to a forced re-login.
 */
export async function verifySession() {
  let token = await ensureSession();
  if (!token) return null;

  const payload = decodeToken(token);
  if (payload && payload.exp * 1000 > Date.now() + 60_000) {
    return { email: payload.email, role: payload.role, name: payload.name };
  }

  try {
    const r = await fetch(`${GATEWAY}/session`, { headers: { 'x-teacher-token': token } });
    if (r.status === 401) { logout(); return null; }
    if (!r.ok) return { offline: true };
    return await r.json();
  } catch {
    return { offline: true };
  }
}

// supabase-js fetch hook: attach session token; send public-bucket reads straight to Supabase.
const gatewayFetch = async (input, init = {}) => {
  let url = typeof input === 'string' ? input : input.url;
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));

  if (url.includes('/api/storage/v1/object/public/')) {
    url = url.replace(`${GATEWAY}/storage/v1`, `${PUBLIC_SUPABASE_URL}/storage/v1`);
    headers.delete('x-teacher-token'); headers.delete('apikey'); headers.delete('authorization');
    return fetch(url, { ...init, headers });
  }

  const token = await ensureSession();
  if (token) headers.set('x-teacher-token', token);
  return fetch(url, { ...init, headers });
};

export const supabase = createClient(GATEWAY, 'gateway', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: gatewayFetch },
});

/**
 * Realtime (WebSocket) client — Netlify Functions can't proxy WebSockets, so
 * realtime subscriptions must connect straight to Supabase. This needs a real
 * *anon* key (browser-safe, RLS-constrained — NEVER service_role).
 *
 * Phase 2: set VITE_REALTIME_ANON_KEY (a dedicated var — do NOT reuse
 * VITE_SUPABASE_ANON_KEY, which currently holds the legacy service_role value)
 * to a genuine anon key, plus RLS policies that let a teacher's Realtime
 * subscription see rows. Until then realtime stays disabled.
 */
const REALTIME_ANON_KEY = import.meta.env.VITE_REALTIME_ANON_KEY || '';
export const supabaseRealtime = REALTIME_ANON_KEY
  ? createClient(PUBLIC_SUPABASE_URL, REALTIME_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

// Public-bucket URLs must point straight at Supabase (no key, browser-cacheable),
// not at the gateway. Rewrite getPublicUrl's result.
const _storageFrom = supabase.storage.from.bind(supabase.storage);
supabase.storage.from = (bucket) => {
  const api = _storageFrom(bucket);
  const _getPublicUrl = api.getPublicUrl.bind(api);
  api.getPublicUrl = (path, opts) => {
    const res = _getPublicUrl(path, opts);
    try {
      if (res && res.data && res.data.publicUrl) {
        res.data.publicUrl = res.data.publicUrl.replace(`${GATEWAY}/storage/v1`, `${PUBLIC_SUPABASE_URL}/storage/v1`);
      }
    } catch {}
    return res;
  };
  return api;
};
