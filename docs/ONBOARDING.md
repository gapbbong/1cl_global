# 신규 학교 온보딩

> GlobalHub는 **경성전자고와 별개인 신규 Supabase 프로젝트**에서 운영한다.
> 경성전자고 DB(1cl_MsGPT)는 절대 재사용하지 않는다.

## 1. 최초 1회 — 인프라

1. 새 Supabase 프로젝트 생성.
2. `db/migrations/` 를 순번대로 SQL Editor에서 실행 (`0001_multitenant_core.sql` → …).
3. Netlify 사이트에 환경변수 설정:
   - `SUPABASE_URL` = 신규 프로젝트 URL
   - `SUPABASE_SERVICE_ROLE_KEY` = 신규 프로젝트 service_role 키
   - `AUTH_SIGNING_SECRET` = 랜덤 48바이트 (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
   - 빌드 환경변수 `VITE_PUBLIC_SUPABASE_URL` = 신규 프로젝트 URL
   - (선택) `GEMINI_API_KEYS`
4. `*.creat1324.com` 와일드카드 도메인을 Netlify에 연결.

## 2. 학교 1곳 추가

Supabase SQL Editor에서 (값만 바꿔):

```sql
select public.bootstrap_school(
  p_domain         => 'hanbit',          -- 하위도메인 → hanbit.creat1324.com
  p_name           => '한빛고등학교',
  p_education_type => 'high',             -- elem|middle|high|college2|college4|kinder
  p_admin_email    => 'teacher@hanbit.hs.kr',
  p_admin_name     => '김담당',
  p_levels         => 3,                  -- 학년 수
  p_classes        => 6                   -- 학년당 반 수
);
```

이 한 번으로 생성됨: 학교 + 학년/반 격자 + 기본 역할 6종(관리자·담임·교과교사·상담교사·보건교사·배움터지킴이) + 첫 관리자 교사.

## 3. 담당교사가 웹 콘솔에서 마무리

`https://hanbit.creat1324.com/admin-console.html` 접속 → 관리자 이메일로 로그인.

| 탭 | 할 일 |
| --- | --- |
| 학교 설정 | 학교명·학교급·학년도·학번 자릿수·기능 노출 확인/수정 |
| 학년·반 구조 | 반 개수 조정, 반/학년 이름 변경(예: `A반`), 학과 입력 |
| 교사 | 교사 이메일·이름·역할·담임 반 등록 (여기 등록된 이메일만 로그인 가능) |
| 역할·권한 | 역할별 접근 범위 조정, 필요시 커스텀 역할 추가 |

이후(M4~) 설문 문항 / 생활기록 항목 탭이 추가된다.

## 로컬 개발에서 테넌트 지정

하위도메인이 없으므로 `?school=<domain>` 쿼리로 지정:
`http://127.0.0.1:5173/admin-console.html?school=hanbit`
(한 번 접속하면 `localStorage.gh_tenant` 에 기억됨)

## 현재 상태 (2026-09-03)

- **Supabase 프로젝트**: `ogbwvbuqwvuozxxhfalj` (계정 gapbbongs@gmail.com / org "gapbbongs" / ap-northeast-2)
  경성전자고 운영 DB(`pwyflwjtafarkwbejoen`)와 완전 별개.
- `0001_multitenant_core.sql` + `0003_student_data.sql` 적용 완료.
  0003 = students / life_records / surveys / record_comments / custom_menus / student_insights /
  schedules / quiz_scores / preset_categories / user_logs / access_logs / class_record_counts(뷰),
  전부 `school_id` + RLS. `bootstrap_school` 이 기본 생활기록 프리셋(칭찬/지도 각 6종)도 생성.
- 데모 학교: domain **demo**, `school_id 33631ac8-aa22-4415-842d-f76a3ddfaa07`,
  3학년 × 4반(12 units), 역할 6종, 교사 3명
  (`gapbbong@gmail.com` = admin, `gapbbongs@gmail.com` = admin, `homeroom1@demo.hs.kr` = 담임 1-1),
  데모 학생 10명(1101~1105, 1201~1205) + 설문/기록.
- `0004_survey_engine.sql` 적용: `survey_schema`(고교 27문항 seed), `form_tokens`,
  storage 버킷 `student-photos`(공개)·`evidence-photos`(비공개).
  데모 배포 토큰: **`fb1f013ad828baeed1`** → 학생용 폼 `?token=`.

### 생활기록 · 역할별 열람 (M5)

- `0005_record_types.sql` 적용: `record_types`(칭찬/지도/근태/상담/일반), `visible_to` 로 유형별 열람 역할 제한.
  상담(counsel) = `["admin","counselor"]` — 다른 역할에는 상담 기록이 안 보임.
- 게이트웨이가 조회 응답을 역할로 필터: 연락처/민감정보 마스킹, 설문 필드 화이트리스트,
  생활기록 유형 필터, `own_class` 학생 쿼리 스코프.
- 콘솔 **생활기록 항목** 탭: 프리셋(잘한일/못한일) + 기록 유형·열람 권한.
- 검증(데모): 교과교사=연락처✗·설문✗, 보건교사=설문 중 allergy/health_note만, 지킴이=근태만.

### 설문 (M4)

| 항목 | 위치 |
| --- | --- |
| 문항 편집 | 콘솔 → **설문 문항** 탭 (넣기/빼기/순서/숨김/필수/민감/타입, 언어, QR·토큰) |
| 학생용 폼 | `http://127.0.0.1:5173/survey-form.html?token=<토큰>` (프로덕션: `q.creat1324.com/f/<토큰>`) — 로그인 없음 |
| 제출 처리 | 게이트웨이 `/api/survey/submit` — 학번으로 학생 찾기/생성 → `surveys` 저장 → `mapTo` 필드를 `students` 컬럼에 동기화 |
| 제출 현황 | 콘솔 밖 앱: **기초조사 확인**(check-survey.html) |

### 데모 학교 접속 정보

| 항목 | 값 |
| --- | --- |
| 관리자 콘솔 | `http://127.0.0.1:5173/admin-console.html?school=demo` (프로덕션: `https://demo.creat1324.com/admin-console.html`) |
| 교사 개인 설정 | `http://127.0.0.1:5173/settings.html?school=demo` |
| 앱 홈 | `http://127.0.0.1:5173/index.html?school=demo` |
| **인증 이메일 (로그인 = 화이트리스트, 실제 메일 발송 없음)** | `gapbbong@gmail.com` (관리자) · `gapbbongs@gmail.com` (관리자) · `homeroom1@demo.hs.kr` (담임, 1-1) |

교사·이메일은 콘솔의 **교사 탭**에서 추가/삭제한다. 여기 없는 이메일로는 로그인 불가.

## 로컬에서 콘솔 띄우기 (netlify-cli 불필요)

```bash
# 1. .env 에 service_role 키 채우기
#    Supabase → Settings → API Keys → "Legacy anon, service_role" 탭 → service_role [Reveal] → 복사
#    → .env 의 SUPABASE_SERVICE_ROLE_KEY= 에 붙여넣기

# 2. 게이트웨이
node scripts/dev-gateway.mjs

# 3. 다른 터미널에서 SPA
npm run dev

# 4. 브라우저
#    http://127.0.0.1:5173/index.html?school=demo   → gapbbong@gmail.com 로 로그인
#    → 햄버거 메뉴 → "⚙️ 학교 설정 콘솔"
#    또는 직접:  http://127.0.0.1:5173/admin-console.html?school=demo
```
