# 배포 — GitHub → Netlify 자동 배포 + 가비아 DNS

## 0. 개요

```
GitHub  gapbbong/1cl_global  ──push──▶  Netlify (자동 빌드/배포)
                                          ├─ 정적: dist/  (vite build)
                                          ├─ /api/*  →  edge function (netlify/edge-functions/api.js)
                                          └─ 도메인: *.creat1324.com  (가비아 DNS → Netlify)
```

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

### 2-3. 도메인  (프로젝트 `1cl-global` — 이미 추가됨)
Netlify → **Domain management → Add a domain / Add domain alias**:
- `creat1324.com` (primary) + `www.creat1324.com`
- `demo.creat1324.com`, `q.creat1324.com` (도메인 alias)

**와일드카드 주의**: Netlify 무료 플랜은 `*.creat1324.com` 을 도메인으로 받지 않는다(입력 시 `*` 무시됨).
→ 새 학교를 온보딩할 때마다 그 학교 도메인 하나를 **Add domain alias** 로 등록해야
   Let's Encrypt 인증서가 발급된다 (`scripts/onboard.mjs` 실행 시 안내 출력).
   DNS 는 가비아의 와일드카드 CNAME(`*`) 하나로 이미 커버되므로 DNS 추가는 불필요.
→ 와일드카드 SSL이 꼭 필요하면 (a) Netlify Pro($19/mo) 또는
   (b) 앞단에 Cloudflare(무료, 프록시 + 와일드카드 SSL) 를 둔다.

Netlify가 각 도메인에 Let's Encrypt SSL을 자동 발급 (DNS 3. 완료 후 수 분).

## 3. 가비아 DNS

가비아 **My가비아 → 도메인 → DNS 정보 → DNS 관리**:

| 타입 | 호스트 | 값 | TTL |
| --- | --- | --- | --- |
| A | `@` | `75.2.60.5` | 600 |
| CNAME | `www` | `1cl-global.netlify.app.` | 600 |
| CNAME | `*` | `1cl-global.netlify.app.` | 600 |

- 값 끝의 `.` 포함. 가비아 UI가 자동으로 붙이면 생략 가능.
- 와일드카드 `*` CNAME 하나로 `demo.creat1324.com`, `q.creat1324.com`, 모든 학교 서브도메인의 **DNS** 가 처리됨
  (단 SSL은 위 2-3 참고 — 학교마다 Netlify alias 등록 필요).
- 가비아는 apex(`@`) 에 CNAME/ALIAS 불가 → A 레코드(`75.2.60.5`) 사용.
- 전파: 보통 10분~1시간 (가비아 최대 24시간).

확인:
```bash
nslookup demo.creat1324.com     # → netlify.app 로 CNAME 되어야 함
curl -I https://demo.creat1324.com   # → 200 (SSL 발급 후)
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
