/**
 * 셀프 학교 개설 — 무인증. bootstrap_school RPC(service_role)로 테넌트 1개를 만든다.
 * edge/lambda 게이트웨이가 공유. sbRest(pathWithQuery, opts) 는 service_role 로 PostgREST 호출.
 *
 * 남용 방지:
 *  - honeypot 필드(hp) — 채워져 있으면 아무것도 안 만들고 성공한 척
 *  - SIGNUP_CODE 환경변수가 있으면 code 일치 필수
 *  - 도메인 예약어/형식 검사, 중복 검사
 *  - 시간당 신규 학교 20개 초과 시 429
 */

const EDU = new Set(['elem', 'middle', 'high', 'college2', 'college4', 'kinder']);
const DOMAIN_RE = /^[a-z][a-z0-9-]{2,30}$/;
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'static', 'assets', 'cdn', 'q', 'form',
  'demo', 'test', 'kit', 'praygroup', 'onboarding', 'signsup', 'signup', 'start',
  'help', 'support', 'blog', 'status', 'dev', 'staging', 'ns1', 'ns2', 'school',
]);

const enc = encodeURIComponent;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {(p:string,o?:object)=>Promise<Response>} sbRest
 * @param {object} body { domain, name, education_type, admin_email, admin_name, levels?, classes?, short_name?, code?, hp? }
 * @param {string} requiredCode  SIGNUP_CODE (빈 문자열이면 코드 미요구)
 */
export async function signupSchool(sbRest, body, requiredCode) {
  const b = body || {};

  if (b.hp) return { status: 200, body: { ok: true, school_id: null, domain: String(b.domain || '') } };

  if (requiredCode && String(b.code || '').trim() !== requiredCode) {
    return { status: 403, body: { error: 'bad_code' } };
  }

  const domain = String(b.domain || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const eduType = String(b.education_type || '').trim();
  const adminEmail = String(b.admin_email || '').trim().toLowerCase();
  const adminName = String(b.admin_name || '').trim();
  const levels = Math.min(12, Math.max(1, parseInt(b.levels, 10) || 3));
  const classes = Math.min(30, Math.max(1, parseInt(b.classes, 10) || 6));

  if (!DOMAIN_RE.test(domain)) {
    return { status: 400, body: { error: 'bad_domain', hint: '영문 소문자로 시작, 3~31자, 소문자·숫자·하이픈만' } };
  }
  if (RESERVED.has(domain)) return { status: 409, body: { error: 'domain_reserved' } };
  if (!name || name.length > 60) return { status: 400, body: { error: 'bad_name' } };
  if (!EDU.has(eduType)) return { status: 400, body: { error: 'bad_education_type' } };
  if (!emailRe.test(adminEmail)) return { status: 400, body: { error: 'bad_email' } };
  if (!adminName || adminName.length > 40) return { status: 400, body: { error: 'bad_admin_name' } };

  // 도메인 중복
  const dupR = await sbRest(`schools?select=id&domain_name=eq.${enc(domain)}&limit=1`);
  const dup = await dupR.json().catch(() => null);
  if (Array.isArray(dup) && dup[0]) return { status: 409, body: { error: 'domain_taken' } };

  // 전역 스로틀: 최근 1시간 신규 학교 20개 초과 시 거부
  const since = new Date(Date.now() - 3600_000).toISOString();
  try {
    const cntR = await sbRest(`schools?select=id&created_at=gte.${enc(since)}`, {
      headers: { Prefer: 'count=exact', Range: '0-0' },
    });
    const total = parseInt(((cntR.headers.get('content-range') || '').split('/')[1] || '0'), 10) || 0;
    if (total >= 20) return { status: 429, body: { error: 'rate_limited' } };
  } catch { /* 카운트 실패는 무시 */ }

  // 생성
  const rpcR = await sbRest('rpc/bootstrap_school', {
    method: 'POST',
    body: JSON.stringify({
      p_domain: domain, p_name: name, p_education_type: eduType,
      p_admin_email: adminEmail, p_admin_name: adminName,
      p_levels: levels, p_classes: classes,
    }),
  });
  const rpcText = await rpcR.text();
  if (!rpcR.ok) {
    if (/duplicate key|unique|already exists/i.test(rpcText)) return { status: 409, body: { error: 'domain_taken' } };
    return { status: 502, body: { error: 'create_failed', detail: rpcText.slice(0, 300) } };
  }
  let schoolId = null;
  try { schoolId = JSON.parse(rpcText); } catch { /* scalar parse 실패 */ }

  // short_name(선택)
  const shortName = String(b.short_name || '').trim().slice(0, 20);
  if (schoolId && shortName) {
    await sbRest(`schools?id=eq.${schoolId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ short_name: shortName }),
    }).catch(() => {});
  }

  // 기본 설문 토큰
  let surveyToken = null;
  if (schoolId) {
    const tR = await sbRest(`form_tokens?select=token&school_id=eq.${schoolId}&limit=1`);
    surveyToken = ((await tR.json().catch(() => []))[0] || {}).token || null;
  }

  return {
    status: 200,
    body: {
      ok: true,
      school_id: schoolId,
      domain,
      survey_token: surveyToken,
      admin_email: adminEmail,
    },
  };
}
