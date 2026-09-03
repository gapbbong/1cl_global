# 배포 — GitHub → Netlify 자동 배포 + creat1324.com DNS

## 0. 개요

```
GitHub  gapbbong/1cl_global  ──push──▶  Netlify (자동 빌드/배포)  [프로젝트: 1cl-global]
                                          ├─ 정적: dist/  (vite build)
                                          ├─ /api/*  →  edge function (netlify/edge-functions/api.js)
                                          └─ 도메인: <school>.creat1324.com  (Vercel DNS → Netlify)
```

**⚠ DNS 위치**: `creat1324.com` 의 네임서버는 **가비아가 아니라 Vercel**(`ns1.vercel-dns.com`).
등록기관만 가비아이고 DNS 레코드는 **Vercel 대시보드**(vercel.com → gapbbongs-projects →
Domains → creat1324.com)에서 관리한다. 가비아 DNS 관리 패널에 넣는 값은 적용되지 않는다.
apex(`creat1324.com`)+`www` 는 티스토리 블로그, `praygroup`·`kit` 등 다른 서비스도 이 도메인을
공유 중이므로 **기존 레코드는 건드리지 말 것**.

## 1. GitHub 저장소

1. GitHub에서 빈 저장소 생성: **`gapbbong/1cl_global`** (README·gitignore·license 체크 해제).
2. 로컬에서 푸시 (원격은 이미 설정됨):
   ```bash
   git push -u origin main
   ```
   (인증: GitHub PAT 또는 `gh auth login`, 또는 SSH 원격으로 변경
   `git remote set-url origin git@github.com:gapbbong/1cl_global.git`)

## 2. Netlify

### 2-1. 사이트 연결
1. Netlify → **Add new site → Import an existing project → GitHub → `1cl_global`**.
2. 빌드 설정은 `netlify.toml` 에서 자동 인식 (Build command `npm run build`, Publish `dist`).
3. Deploy.

### 2-2. 환경변수 (Site configuration → Environment variables)

| 키 | 값 |
| --- | --- |
| `SUPABASE_URL` | `https://ogbwvbuqwvuozxxhfalj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API Keys → Legacy → service_role (Reveal) |
| `AUTH_SIGNING_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` 로 생성 |
| `VITE_PUBLIC_SUPABASE_URL` | `https://ogbwvbuqwvuozxxhfalj.supabase.co` |
| `GEMINI_API_KEYS` | (선택, AI 분석용) |

설정 후 **Deploys → Trigger deploy → Clear cache and deploy**.

### 2-3. 도메인  (프로젝트 `1cl-global`)
Netlify → **Domain management → Add a domain → Add a domain you already own**:
- **primary**: `demo.creat1324.com` — "Add subdomain" 으로 추가 (apex/www 안 붙음)
- **domain alias**: `q.creat1324.com`, 그리고 학교마다 `<school>.creat1324.com`
- apex `creat1324.com` / `www` 는 **절대 넣지 않는다** (티스토리 소유 → SAN 인증서 전체가 실패)
- SSL: SSL/TLS certificate → **Verify DNS configuration** → **Provision certificate**
  (DNS 전파 직후엔 몇 번 실패할 수 있음. Netlify가 자동 재시도하며 보통 수 분~30분 내 발급)

**와일드카드 주의**: Netlify 무료 플랜은 `*.creat1324.com` 을 도메인으로 받지 않는다(입력 시 `*` 무시됨).
→ 학교를 온보딩할 때마다 2가지를 한다:
   1. **Vercel DNS**: `<school>` `CNAME` → `1cl-global.netlify.app`
   2. **Netlify**: Domain management → Add domain alias → `<school>.creat1324.com`
   (`scripts/onboard.mjs` 실행 시 이 안내가 출력된다)
→ 이 반복이 싫으면 (a) Netlify Pro($19/mo, 와일드카드 도메인) 또는
   (b) creat1324.com 앞단에 Cloudflare(무료, 프록시 + 와일드카드 SSL).

Netlify가 각 도메인에 Let's Encrypt SSL을 자동 발급 (DNS 전파 후 수 분).

## 3. Vercel DNS (creat1324.com)

vercel.com → **gapbbongs-projects → Domains → creat1324.com → DNS Records → Add**:

| Name | Type | Value | 비고 |
| --- | --- | --- | --- |
| `demo` | CNAME | `1cl-global.netlify.app` | ✅ 추가됨 |
| `q` | CNAME | `1cl-global.netlify.app` | ✅ 추가됨 |
| `<school>` | CNAME | `1cl-global.netlify.app` | 학교 추가 시마다 |

- 기존 레코드(apex ALIAS→tistory, `www`, `praygroup`, `*` Vercel 자동관리 등)는 **그대로 둔다**.
- `*` 와일드카드는 Vercel이 자동관리(잠금)라 건드리지 않는다. 그래서 명시적 서브도메인 레코드가 필요.
- Vercel DNS는 전파가 빠름(1~5분).

확인:
```bash
nslookup demo.creat1324.com          # → 1cl-global.netlify.app
curl -I https://demo.creat1324.com/api/survey/form   # → 400/200 (SSL 발급 후)
```

## 4. 첫 학교 온보딩

```bash
node scripts/onboard.mjs <domain> "<학교명>" <학교급> <관리자이메일> "<관리자이름>" [학년수] [반수]
# 예: node scripts/onboard.mjs hanbit "한빛중학교" middle teacher@hanbit.ms.kr 김담당 3 5
```
학교급: `elem` `middle` `high` `college2` `college4` `kinder`

이후: `https://<domain>.creat1324.com/admin-console.html` 에서 관리자 이메일로 로그인
→ 교사 등록 → 학생 명렬 xlsx 업로드 → 설문 QR 배포.

## 5. Keep-Alive (선택)

Supabase 무료 플랜은 7일 무접속 시 일시중지. `.github/workflows/keep_alive.yml` 이
5일마다 게이트웨이를 ping 한다. 저장소 **Settings → Secrets and variables → Actions → Variables** 에
`SITE_URL = https://<사이트이름>.netlify.app` 추가하면 활성화.

## 이미 준비된 것

- `netlify.toml` — 빌드/edge function/`/api/*`·`/f/*` 리다이렉트
- `db/migrations/0001~0005` — 신규 Supabase(`ogbwvbuqwvuozxxhfalj`)에 **적용 완료**
- storage 버킷 `student-photos`(공개)·`evidence-photos`(비공개) — 생성 완료
- 데모 학교 `demo`(고교)·`hanbit`(중학교) — 생성 완료
