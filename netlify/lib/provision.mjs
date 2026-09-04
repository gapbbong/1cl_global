/**
 * 테넌트 하위도메인 자동 연결 — Vercel DNS + Netlify 도메인/SSL API.
 * edge/lambda 게이트웨이 + scripts/onboard.mjs 가 공유. fetch 만 사용(isomorphic).
 *
 * 필요한 환경변수 (모두 있어야 자동화 동작; 하나라도 없으면 skip 하고 수동 안내):
 *   VERCEL_API_TOKEN   — vercel.com → Account Settings → Tokens
 *   VERCEL_TEAM_ID     — creat1324.com 이 팀(gapbbongs-projects) 소속이면 필요. team id 또는 slug
 *   NETLIFY_API_TOKEN  — app.netlify.com → User settings → Applications → Personal access tokens
 *   NETLIFY_SITE_ID    — 1cl-global 사이트의 API ID (Site configuration → General → Site information)
 */

const ROOT_DOMAIN = 'creat1324.com';
const NETLIFY_TARGET = '1cl-global.netlify.app';

export function provisionConfig(env) {
  return {
    vercelToken: env('VERCEL_API_TOKEN') || '',
    vercelTeam: env('VERCEL_TEAM_ID') || '',
    netlifyToken: env('NETLIFY_API_TOKEN') || '',
    netlifySiteId: env('NETLIFY_SITE_ID') || '',
  };
}

export function canAutoProvision(cfg) {
  return !!(cfg.vercelToken && cfg.netlifyToken && cfg.netlifySiteId);
}

const teamQS = (team) => (team ? (/^team_/.test(team) ? `?teamId=${encodeURIComponent(team)}` : `?slug=${encodeURIComponent(team)}`) : '');

async function vercelAddCname(domain, cfg) {
  const url = `https://api.vercel.com/v2/domains/${ROOT_DOMAIN}/records${teamQS(cfg.vercelTeam)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.vercelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: domain, type: 'CNAME', value: NETLIFY_TARGET, ttl: 60 }),
  });
  const t = await r.text();
  if (r.ok) return { dns: 'ok' };
  if (/already exists|record with the same/i.test(t)) return { dns: 'exists' };
  return { dns: 'error', dnsDetail: `${r.status} ${t.slice(0, 200)}` };
}

async function netlifyAddAlias(fqdn, cfg) {
  const base = `https://api.netlify.com/api/v1/sites/${encodeURIComponent(cfg.netlifySiteId)}`;
  const h = { Authorization: `Bearer ${cfg.netlifyToken}`, 'Content-Type': 'application/json' };

  const sr = await fetch(base, { headers: h });
  const site = await sr.json().catch(() => null);
  if (!sr.ok || !site) return { alias: 'error', aliasDetail: `site fetch ${sr.status}` };

  const aliases = Array.isArray(site.domain_aliases) ? site.domain_aliases.slice() : [];
  if (aliases.includes(fqdn) || site.custom_domain === fqdn) return { alias: 'exists' };

  aliases.push(fqdn);
  const pr = await fetch(base, { method: 'PATCH', headers: h, body: JSON.stringify({ domain_aliases: aliases }) });
  const pt = await pr.text();
  if (!pr.ok) return { alias: 'error', aliasDetail: `${pr.status} ${pt.slice(0, 200)}` };

  // 인증서 재발급 트리거 (모든 alias 포함하는 SAN 인증서 재생성)
  let ssl = 'skipped';
  try {
    const cr = await fetch(`${base}/ssl`, { method: 'POST', headers: h });
    ssl = cr.ok ? 'triggered' : `error ${cr.status}`;
  } catch { ssl = 'error'; }
  return { alias: 'ok', ssl };
}

/**
 * @param {string} domain  학교 하위도메인 라벨 (예: "hanbit")
 * @param {object} cfg  provisionConfig() 결과
 * @returns {{ok:boolean, fqdn:string, dns:string, alias:string, ssl?:string, detail?:string}}
 */
export async function provisionTenantDomain(domain, cfg) {
  const fqdn = `${domain}.${ROOT_DOMAIN}`;
  if (!canAutoProvision(cfg)) {
    return { ok: false, fqdn, dns: 'skipped', alias: 'skipped', detail: 'no_provision_credentials' };
  }
  const out = { ok: false, fqdn };
  try {
    Object.assign(out, await vercelAddCname(domain, cfg));
    Object.assign(out, await netlifyAddAlias(fqdn, cfg));
  } catch (e) {
    out.detail = String((e && e.message) || e);
  }
  out.ok = (out.dns === 'ok' || out.dns === 'exists') && (out.alias === 'ok' || out.alias === 'exists');
  return out;
}
