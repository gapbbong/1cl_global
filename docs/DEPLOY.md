# 배포 (Netlify + Supabase)

## 1. Supabase (최초 1회)

1. 신규 프로젝트 생성 (현재: `ogbwvbuqwvuozxxhfalj`, 서울 리전).
2. `db/migrations/` 를 순번대로 SQL Editor에서 실행: `0001` → `0002`(예시, 건너뛰어도 됨) → `0003` → `0004` → `0005`.
3. Storage 버킷은 `0003`/`0004` 가 생성 (`student-photos` 공개, `evidence-photos` 비공개).

## 2. Netlify

### 환경변수 (Site settings → Environment variables)

| 키 | 값 | 범위 |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 (Legacy API keys 탭) | Functions |
| `AUTH_SIGNING_SECRET` | 랜덤 48바이트 (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) | Functions |
| `VITE_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Build |
| `GEMINI_API_KEYS` | 콤마구분 (선택 — AI 분석용) | Functions |

### 도메인

- 기본 앱: `app.creat1324.com` (또는 Netlify 기본 도메인)
- **와일드카드**: `*.creat1324.com` 를 Netlify 도메인으로 추가 → 각 학교가 `<domain>.creat1324.com` 으로 접속.
  게이트웨이가 hostname 의 서브도메인으로 테넌트를 판별한다 (`tenantFromHost`).
- 학생 설문: `q.creat1324.com` (같은 사이트, `/f/<token>` 경로 → `survey-form.html` 로 리라이트하거나
  `survey-form.html?token=` 직접 사용).

### netlify.toml

이미 설정됨: `/api/*` → edge function(`netlify/edge-functions/api.js`), 폴백 lambda(`netlify/functions/api.mjs`).
`SECRETS_SCAN_OMIT_PATHS` 에 `_legacy/**` 포함.

## 3. 신규 학교 온보딩

```bash
node scripts/onboard.mjs <domain> "<학교명>" <학교급> <관리자이메일> "<관리자이름>" [학년수] [반수]
# 예: node scripts/onboard.mjs hanbit "한빛중학교" middle teacher@hanbit.ms.kr 김담당 3 5
```

`bootstrap_school` RPC 한 번으로 생성: 학교 + 학년/반 격자 + 역할 6종 + 첫 관리자 교사
+ 생활기록 프리셋 + 설문 27문항 + 기록 유형 + 배포 토큰.

이후 담당교사가 콘솔(`https://<domain>.creat1324.com/admin-console.html`)에서:
학년·반 확인 → **교사 탭** 등록 → **학생 명단 탭** 에서 명렬 xlsx 업로드 → **설문 문항 탭** 조정·QR 배포.

## 로컬 개발

`docs/ONBOARDING.md` 참고. netlify-cli 없이 `scripts/dev-gateway.mjs` + `npm run dev`.
