/**
 * 신규 학교 온보딩 CLI — bootstrap_school RPC 를 service_role 로 호출.
 *
 *   node scripts/onboard.mjs <domain> <학교명> <학교급> <관리자이메일> <관리자이름> [학년수] [반수]
 *   node scripts/onboard.mjs hanbit "한빛고등학교" high teacher@hanbit.hs.kr 김담당 3 6
 *
 * 학교급: elem | middle | high | college2 | college4 | kinder
 * .env 의 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 사용.
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const [domain, name, edu, adminEmail, adminName, levels = '3', classes = '6'] = process.argv.slice(2);
if (!domain || !name || !edu || !adminEmail || !adminName) {
  console.error('사용법: node scripts/onboard.mjs <domain> <학교명> <학교급> <관리자이메일> <관리자이름> [학년수] [반수]');
  process.exit(1);
}
const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!URL || !KEY || KEY.startsWith('PASTE')) { console.error('.env 의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 확인하세요.'); process.exit(1); }

const rpc = (fn, args) => fetch(`${URL}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
});

const r = await rpc('bootstrap_school', {
  p_domain: domain, p_name: name, p_education_type: edu,
  p_admin_email: adminEmail, p_admin_name: adminName,
  p_levels: Number(levels), p_classes: Number(classes),
});
const body = await r.text();
if (!r.ok) { console.error('실패:', r.status, body); process.exit(1); }

const schoolId = JSON.parse(body);
const tk = await fetch(`${URL}/rest/v1/form_tokens?select=token&school_id=eq.${schoolId}&limit=1`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
}).then((x) => x.json()).catch(() => []);

console.log(`\n  ✓ "${name}" 생성 완료`);
console.log(`    school_id : ${schoolId}`);
console.log(`    도메인     : ${domain}  →  https://${domain}.creat1324.com`);
console.log(`    관리자     : ${adminEmail}  (이 이메일로 콘솔 로그인)`);
console.log(`    콘솔       : https://${domain}.creat1324.com/admin-console.html`);
console.log(`    설문 링크  : ${tk[0] ? `https://q.creat1324.com/f/${tk[0].token}` : '(없음)'}`);
console.log(`\n  ⚠ Netlify 무료 플랜은 와일드카드 도메인을 지원하지 않습니다.`);
console.log(`     새 학교 도메인을 한 번 등록해야 SSL이 발급됩니다:`);
console.log(`     Netlify → 1cl-global → Domain management → Add domain alias → "${domain}.creat1324.com"`);
console.log(`     (가비아 DNS의 와일드카드 CNAME(*)이 이미 있으면 DNS 추가는 불필요)`);
console.log(`\n  다음: 콘솔 로그인 → 학년·반 확인 → 교사 등록 → 학생 명단(xlsx) 업로드 → 설문 QR 배포\n`);
