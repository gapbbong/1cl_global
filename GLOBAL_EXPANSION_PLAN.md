# 원클(OneClass) 타학교 확장 계획 — "GlobalHub"

> 작성일 2026-09-03 · 대상 저장소 `F:\App\1cl_global` · 상태: 계획(draft)

## 0. 확정된 방향 (사용자 결정)

| 항목 | 결정 |
| --- | --- |
| 아키텍처 | **멀티테넌트 단일 배포** — 하나의 Netlify + Supabase에 `schools` 테이블로 여러 학교 수용, 모든 데이터에 `school_id` 격리 |
| 커스터마이징 주체 | **학교 담당교사가 웹 콘솔(GlobalHub 관리자 화면)에서 직접** — 코드 수정 없이 항목 추가/삭제/이동 |
| 기존 서비스 | **경성전자고(v5.08, `1cl_MsGPT` 배포)는 동결·현행 유지.** 신규 학교만 이 신규 코드(`1cl_global`)로 운영. 기존 DB 마이그레이션 불필요 |
| 백엔드 | **Supabase + Netlify 게이트웨이로 통일.** 레거시 GAS/구글시트 경로(`HOW_TO_CUSTOMIZE.md`, `Code.gs`)는 폐기 |

핵심 함의: **데이터 마이그레이션 리스크가 없다.** 경성전자고를 건드리지 않으므로, 신규 코드는 깨끗한 멀티테넌트 스키마로 시작하고 첫 실사용 학교부터 온보딩하면 된다.

---

## 1. 목표와 비(非)범위

### 목표
- 초·중·고·대(2/3년제·4년제) 어디서나 **소스 수정 없이** 담당교사가 학교 구조·명칭·설문·생활기록 항목·권한을 설정.
- 한 코드베이스 / 한 배포로 N개 학교 운영. 학교별 하위도메인(`<domain>.creat1324.com`) 또는 경로로 접속.
- 학생용 기초조사(설문)는 로그인 없이 QR/링크로 수집, 학교별로 문항이 완전히 다름.

### 비범위 (이번 단계에서 안 함)
- 경성전자고 기존 데이터/코드의 이관.
- 학교 간 데이터 공유·통합 통계.
- 결제/요금제, 학교 자가가입(관리자가 수동 승인으로 시작).
- 네이티브 앱(PWA 유지).

---

## 2. 제품 형태

```
1cl_MsGPT  (동결)   → 경성전자고 전용. 버그픽스만. 더 이상 기능 추가 안 함.
1cl_global (신규)   → GlobalHub. 멀티테넌트. 이 계획의 대상.
1cl_MsGPT/index.html → GlobalHub 관리자 콘솔의 프로토타입(참고용). 여기 로직을 정식 코드로 재작성.
```

`1cl_global` 현재 상태: v5.08 경성전자고 코드의 복사본 + 부분적 보안 게이트웨이(`netlify/functions/api.mjs`) + SaaS 스키마 초안(`supabase_schema.sql`, `extend_schema_saas.sql`). 즉 **경성전자고 하드코딩이 그대로 남아 있는 상태**라 이를 걷어내는 것이 1차 작업.

---

## 3. 하드코딩 인벤토리 (변수화 대상)

실제 코드에서 확인된 "경성전자고 전제". 각 항목을 학교 설정값으로 치환한다.

| # | 위치 | 현재 하드코딩 | 설정 키(제안) |
| --- | --- | --- | --- |
| 1 | `src/js/index.js` `renderInitialGrid()` | 학년 `1..3`, 반 `1..6` 이중 루프 | `grades[]`, `classesPerGrade{}` |
| 2 | `src/js/index.js` | 학년별 색상 `hue = grade===1?150:grade===2?210:30` | `theme.gradeColors[]` |
| 3 | `index.html` | `<title>경성전자고 학급 목록</title>`, `<h1 class="school-name">경성전자고</h1>` | `school.name`, `school.shortName` |
| 4 | `index.html` | 안내문 "전문부 이갑종 선생님에게 문의" | `school.supportContact` |
| 5 | `src/js/config.js` | `CURRENT_ACADEMIC_YEAR: 2026` | `school.academicYear` (연 1회 승급) |
| 6 | `src/js/config.js` | `SCRIPT_URL`(GAS), `SECRET_KEY` 평문 | 폐기 / 게이트웨이 환경변수 |
| 7 | `src/js/index.js`, `api.js` | 관리자 이메일 배열 `['gapbbong@naver.com', 'assari@kse.hs.kr', ...]` | `teachers.role='admin'` (DB 기반) |
| 8 | `src/js/index.js`, `api.mjs` | `keeper@kse.hs.kr` 특수 리다이렉트 → `keeper.html` | `role='gatekeeper'` + 역할별 랜딩 설정 |
| 9 | `src/js/api.js` | 기록교사 매핑 `"최지은" → "assari"` | 제거(불필요), 이메일 prefix 일반화 |
| 10 | `supabase_schema.sql` | `user_role` enum: admin/homeroom_teacher/nurse/counselor/subject_teacher/gatekeeper | 학교급별 역할 세트(초·중·고·대 상이) → `roles` 테이블화 |
| 11 | `src/js/api.js` `fetchPresets()` | 잘한일/못한일 fallback 문자열(교내봉사, 두발불량 등 — 고교 생활지도 전용) | `preset_categories`(school_id별) |
| 12 | `src/js/api.js` | `category === '근태'`, 내용 정규식 `/(오전|오후)\s*외출\((\d{2}:\d{2}).../` | `record_types[]` 설정 + 구조화 필드(정규식 파싱 제거) |
| 13 | `src/js/api.js` `mapStudentData()` | `"번호" = student_id.slice(-2)`, `학번 === q(4자리)` 다수 | `studentId.format`(길이·구성), `studentNo` 파생 규칙 |
| 14 | `settings.js`, `settings.html` | "학번 4자리 입력" placeholder, maxlength=4 | `studentId.length` |
| 15 | `1cl_MsGPT/index.html` 프로토타입 | 설문 28문항 배열 하드코딩(`questions=[...]`) | `survey_schema`(school_id별 JSONB) |
| 16 | `class_info` 문자열 `"1-1"` | 전 코드에서 `${grade}-${classNum}` 문자열 파싱 | 유지하되 포맷터 함수로 캡슐화(대학은 "1-A" 등) |
| 17 | `src/js/*` UI 문자열 전반 | 한국어 고정 | i18n 리소스(ko 기본, 학생 설문은 다국어) |
| 18 | `manifest.json`, favicon, splash 이미지 | 원클 브랜딩 | 학교별 로고/색 or 공통 GlobalHub 브랜딩 |
| 19 | `index.html` | Microsoft Clarity 태그 `vqru6iwnq8` | 환경변수 또는 제거 |
| 20 | 햄버거 메뉴 항목(`index.js` `renderDynamicMenu`) | 고정 메뉴 id 리스트 | `school.features[]` + 교사 `menu_config` |

> 부수 발견(계획 외 정리 후보): `1cl_global` 루트에 경성전자고 운영 중 생성된 일회성 스크립트 수백 개(`check_*.js`, `fix_*.js`, `restore_*.js`, CSV/JSON 덤프, `photos.zip` 27MB, `_backup_private/`)가 그대로 커밋되어 있음. 신규 저장소 정리 시 `scripts/legacy/`로 격리하거나 별도 브랜치로 분리 권장.

---

## 4. 아키텍처 개요

```
                    ┌─────────────────────────────────────────┐
  교사(관리자/일반)  │  app.creat1324.com  (GlobalHub 콘솔+운영 SPA) │
  학생(설문)         │  q.creat1324.com/f/<token>  (설문 폼)        │
  학교별 접속        │  <domain>.creat1324.com     (테넌트 진입)     │
                    └───────────────┬─────────────────────────┘
                                    │  fetch (세션 토큰)
                    ┌───────────────▼─────────────────────────┐
                    │  Netlify Functions  /api/*  (게이트웨이)   │
                    │  - /api/login        이메일→서명 세션토큰    │
                    │  - /api/rest/v1/*    PostgREST 패스스루     │
                    │  - school_id 스코프 강제 + 테이블 권한매트릭스 │
                    │  - service_role 키는 여기만 보유            │
                    └───────────────┬─────────────────────────┘
                                    │  service_role
                    ┌───────────────▼─────────────────────────┐
                    │  Supabase (Postgres + Storage + Realtime) │
                    │  모든 테이블에 school_id, RLS 이중 방어      │
                    └─────────────────────────────────────────┘
```

- **테넌트 식별**: 하위도메인(`integration.js`에 이미 파싱 로직 있음) → `schools.domain_name` 조회 → `school_id` 확정. 세션 토큰에 `school_id` 포함.
- **게이트웨이가 신뢰 경계**: 브라우저는 anon key도 안 가짐. 모든 쿼리에 게이트웨이가 `school_id=eq.<세션값>` 필터를 주입/검증.
- **설정 로딩**: 앱 부팅 시 `/api/config` 한 방으로 `school` + `survey_schema` + `preset_categories` + `roles` + `features`를 받아 `window.SCHOOL` 전역에 주입. 이후 모든 렌더가 이 객체 참조.

---

## 5. 데이터 모델 (신규 Supabase 스키마)

### 5.1 신규/변경 테이블

```sql
-- 학교(테넌트)
create table schools (
  id            uuid primary key default gen_random_uuid(),
  domain_name   text unique not null,          -- 하위도메인 (영문 3+)
  name          text not null,
  short_name    text,
  education_type text not null,                -- 'elem' | 'middle' | 'high' | 'college2' | 'college4' | 'kinder'
  academic_year int  not null,
  locale        text default 'ko',
  support_contact text,
  theme         jsonb default '{}'::jsonb,     -- 색상, 로고 URL
  features      jsonb default '[]'::jsonb,     -- 활성 기능 토글 리스트
  status        text default 'active',
  created_at    timestamptz default now()
);

-- 학교 구조(학년/반). 초·중·고·대 모두 표현 가능하게 일반화
create table school_units (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references schools(id) on delete cascade,
  level_label text not null,       -- '1학년' / '1학년' / '신입생' ...
  level_order int  not null,
  class_label text not null,       -- '1반' / 'A반' / '경영1분반'
  class_order int  not null,
  major       text,                -- 학과/전공 (majorMapping 대체)
  unique (school_id, level_order, class_order)
);

-- 학생 (기존 students 확장)
alter table students add column school_id uuid references schools(id);
alter table students add column answers  jsonb default '{}'::jsonb;  -- 설문 응답 통합 저장
-- student_id 포맷은 school_settings.student_id 로 검증

-- 교사 (기존 teachers 확장)
alter table teachers add column school_id uuid references schools(id);
alter table teachers add column role_key  text;   -- roles.key 참조 (enum 제거)

-- 역할 정의 (학교급마다 세트가 다름)
create table roles (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references schools(id) on delete cascade,
  key         text not null,            -- 'admin','homeroom','counselor','nurse','gatekeeper','subject'...
  label       text not null,            -- '담임','상담교사','보건교사','배움터지킴이'...
  permissions jsonb not null,           -- 아래 5.3 권한 스펙
  landing_page text default 'home',
  unique (school_id, key)
);

-- 설문 스키마 (학교별 문항 정의)
create table survey_schema (
  school_id   uuid primary key references schools(id) on delete cascade,
  version     int  default 1,
  languages   jsonb default '["ko"]'::jsonb,
  fields      jsonb not null,           -- 아래 5.2 필드 스펙 배열 (순서 = 노출 순서)
  updated_at  timestamptz default now()
);

-- 생활기록 프리셋 (기존 preset_categories 에 school_id 추가)
alter table preset_categories add column school_id uuid references schools(id);
alter table preset_categories add column axis text default 'good';  -- good/bad/neutral/attendance...

-- 생활기록 타입 (근태 등 특수 로직 일반화)
create table record_types (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references schools(id) on delete cascade,
  key         text not null,            -- 'praise','guidance','attendance','counsel'
  label       text not null,
  polarity    text,                     -- 'positive'|'negative'|'neutral'
  fields      jsonb default '[]'::jsonb, -- 구조화 입력 필드(외출 시작/종료 등) — 정규식 파싱 대체
  visible_to  jsonb default '["all"]'::jsonb,
  unique (school_id, key)
);
```

기존 `life_records`, `surveys`, `access_logs`, `custom_menus`, `student_insights`, `record_comments`, `schedules`, `quiz_scores` → 전부 `school_id` 컬럼 추가 + 인덱스 + RLS.

### 5.2 설문 필드 스펙 (`survey_schema.fields[]`)

```jsonc
{
  "id": "guardian_primary",          // 고정 키 (매핑·조회용, 불변)
  "label": { "ko": "주보호자 정보", "vi": "...", "uz": "..." },
  "type": "short | long | select | photo | number | tel | date | rating",
  "options": [{ "value": "M", "label": { "ko": "남성" } }],  // select 전용
  "required": false,
  "hidden": false,                   // "빼기" = 삭제 대신 hidden
  "order": 12,                        // "이동" = order 재정렬
  "group": "가족",                    // 섹션 묶음(선택)
  "piiLevel": "sensitive | normal",  // 권한/마스킹 판단
  "mapTo": "students.parent_contact" // (선택) 학생 마스터 컬럼 동기화
}
```

- **넣기**: `fields[]`에 항목 push (기본 카탈로그에서 선택 또는 커스텀 신규).
- **빼기**: `hidden=true` (과거 응답 보존). 완전 삭제는 관리자 확인 후.
- **이동**: `order` 값만 갱신. 드래그 앤 드롭 UI.
- **기본 카탈로그**: `1cl_MsGPT/index.html`의 28문항을 "고교 기본 템플릿"으로, 초/중/대용 축약 템플릿 3종을 seed로 제공.

### 5.3 권한 스펙 (`roles.permissions`)

`FUTURE_TASKS.md`의 RBAC 요구를 일반화:

```jsonc
{
  "scope": "all | own_class | none",          // 학생 레코드 접근 범위
  "students": { "read": ["basic","contact"], "write": ["contact"] },
  "survey":   { "read": "all | own_class | fields:[allergy,health]" },
  "records":  { "read": "all | own_class | types:[attendance]",
                "write": "all | own_class | types:[attendance]" },
  "admin":    { "school_settings": false, "survey_schema": false, "roles": false }
}
```

예시 매핑:
- 상담교사 → `survey.read: fields:[알레르기]` 만.
- 배움터지킴이 → `records.read/write: types:[attendance]` 만, `scope: all`.
- 담임 → `scope: own_class`, 전 항목.
- 관리자/생활지도부장 → 전체 + `admin.*: true`.

DB의 RLS는 최후 방어선, 실제 판정은 게이트웨이가 `roles.permissions`로 수행(RLS만으로 필드 단위 제어가 어려움 — `supabase_schema.sql`의 `get_allergy_info()` 같은 SECURITY DEFINER 함수 패턴을 유지).

---

## 6. 커스터마이징 콘솔 (교사·관리자용)

`1cl_MsGPT/index.html` 프로토타입을 정식 SPA 화면으로 재작성. 위치: `app.creat1324.com/admin` (관리자 권한만).

### 화면 구성

| 탭 | 기능 | 대응 테이블 |
| --- | --- | --- |
| **1. 학교 설정** | 학교명/약칭, 학교급, 학년도, 로케일, 지원연락처, 테마(색·로고), 도메인 | `schools` |
| **2. 학년·반 구성** | 학년 추가/삭제, 학년별 반 개수(±), 반 표기(숫자/영문/커스텀), 학과 매핑, 순서 이동 | `school_units` |
| **3. 학번 규칙** | 자릿수, 구성(학년+반+번호 / 자유), 번호 파생 규칙, 검증 정규식 미리보기 | `schools.settings` |
| **4. 설문 문항** | 문항 목록(드래그 정렬), 추가(카탈로그/커스텀), 숨김/삭제, 형식 변경, 필수 토글, 다국어 입력, 실시간 미리보기, QR/링크 발급·재발급 | `survey_schema` |
| **5. 생활기록 항목** | 축(잘한일/못한일/중립/근태) 관리, 프리셋 문구 추가/삭제/정렬, 기록 타입·구조화 필드 | `preset_categories`, `record_types` |
| **6. 역할·권한** | 역할 목록, 역할별 권한 매트릭스 편집, 교사↔역할·담당학급 배정, 관리자 지정 | `roles`, `teachers` |
| **7. 교사 명단** | 교사 이메일 등록/삭제(=인증 화이트리스트), CSV 업로드 | `teachers` |
| **8. 학생 명단** | 명렬 xlsx 업로드(반별), 학적 상태, 승급/졸업 처리 | `students` |
| **9. 기능 토글** | 메뉴/기능 on-off(퀴즈, 3D맵, 캘린더, 알림, 교사프로필 등) | `schools.features` |

### 넣기/빼기/이동 UX 공통 규칙
- 모든 목록은 드래그 핸들(`☷`)로 순서 변경, 토글로 숨김, 휴지통으로 삭제(소프트 삭제 + 30일 복구).
- "미리보기" 패널(우측 슬라이드)로 학생/교사 화면을 즉시 확인 — 프로토타입의 `previewPanel` 재사용.
- 저장은 명시적 "저장" 버튼(프로토타입의 `markSchoolChanged` 패턴). 저장 시 `survey_schema.version`·`schools.updated_at` 증가 → 클라이언트 캐시 무효화.

---

## 7. 학생용 설문 엔진

- 진입: `q.creat1324.com/f/<token>` — `token`은 학교(또는 학교+반)에 매핑. `schools`에 `form_tokens` 테이블 or `survey_schema`에 토큰맵.
- 로그인 없음. 토큰으로 `school_id` + `survey_schema` 로드 → 동적 폼 렌더(프로토타입 `preview()` 로직을 정식화).
- 다국어: `survey_schema.languages` 기반 언어 선택기. 라벨은 필드별 다국어 사전. 미번역 항목은 기본 로케일 폴백.
- 제출: 게이트웨이 `POST /api/survey/submit` → `surveys.data`(원본 JSONB) 저장 + `mapTo` 지정 필드는 `students` 컬럼/`students.answers` 동기화. 중복 제출은 학번+토큰으로 감지.
- 사진 문항: `students-photos` 버킷 업로드(클라이언트 리사이즈 후), `FUTURE_TASKS.md`의 이미지 최적화 요건 적용(장변 기준 축소 + 압축).
- 스팸/오남용 방지: 토큰별 rate limit, 제출 창(open/close) 설정, 관리자 화면에서 제출 현황 모니터링(`check-survey.html` 일반화).

---

## 8. 프론트엔드 리팩터링 전략

### 8.1 설정 로더 (신규 `src/js/school.js`)
```js
export async function loadSchool() {
  const cached = sessionStorage.getItem('SCHOOL');
  // /api/config?v=<version> — 게이트웨이가 도메인/세션으로 school_id 판정
  const cfg = await api('/config');
  window.SCHOOL = cfg;            // { school, units, survey, presets, roles, features, i18n }
  return cfg;
}
export const t = (key) => window.SCHOOL.i18n[key] ?? key;      // i18n
export const classLabel = (u) => `${u.level_label} ${u.class_label}`;
export const classKey = (lvl, cls) => `${lvl}-${cls}`;         // class_info 포맷 캡슐화
```

### 8.2 렌더 일반화 (예: `index.js`)
- `renderInitialGrid`: `1..3 / 1..6` 루프 → `SCHOOL.units` 순회. 학년 컬럼 = `level_order` 그룹.
- 색상: `SCHOOL.theme.gradeColors[level_order % n]` 또는 자동 팔레트 생성.
- 관리자 판정: `SCHOOL.roles[myRole].permissions.admin` (이메일 배열 제거).
- 메뉴: `SCHOOL.features` ∩ 교사 `menu_config`.

### 8.3 i18n
- 1차: UI 전 문자열을 `src/i18n/ko.json` 키로 추출(기존 하드코딩 한국어). 리소스 스캐폴딩만 만들고 ko 100% 유지.
- 2차: 학생 설문만 실제 다국어(베트남어·우즈베크어 등 학교가 지정).
- 교사 UI 다국어는 후순위(대부분 한국 학교 대상).

### 8.4 빌드/배포
- Vite 멀티페이지 유지. `netlify.toml`에 `/api/*` 리다이렉트, 하위도메인 와일드카드(`*.creat1324.com`) 설정.
- 환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SIGNING_SECRET`, `GEMINI_API_KEYS`(이미 `api.mjs`에 있음), `CLARITY_ID`(옵션).
- `src/js/config.js`의 `SCRIPT_URL`/`SECRET_KEY` 제거.

---

## 9. 게이트웨이·인증 변경

`netlify/functions/api.mjs` 확장:
- `login`: 이메일 → `teachers where email AND school_id`(도메인으로 school_id 확정) → 토큰에 `{email, school_id, role_key}` 서명.
- `rest/v1/*` 패스스루: 요청 테이블마다 **`school_id=eq.<토큰값>` 강제 주입**. 세션 school_id와 다른 데이터 접근 시 거부.
- `roles.permissions` 기반 필드/타입 필터링(예: 상담교사가 surveys 조회 시 허용 필드만 select 재작성).
- `config`: 학교 설정 번들 반환(캐시 헤더 + version).
- `survey/submit`: 무인증 허용, 토큰 검증, rate limit.
- RLS: 모든 테넌트 테이블에 `school_id = current_setting('request.jwt.claims')...` 정책 추가(게이트웨이 우회 대비 최소 방어).

---

## 10. 새 학교 온보딩 절차 (운영 런북)

1. 관리자가 `schools` 레코드 생성(도메인, 학교급, 학년도) — 내부 관리자 화면 or SQL.
2. 학교급 템플릿 선택 → `school_units`, `roles`, `survey_schema`, `preset_categories` seed 자동 생성.
3. 담당교사 이메일 1명을 `role='admin'`으로 등록 → 콘솔 로그인.
4. 담당교사가 콘솔에서: 학년·반 확정 → 교사 명단 업로드 → 학생 명렬 업로드 → 설문 문항 조정 → 생활기록 항목 조정 → 권한 배정.
5. 설문 QR 발급 → 학생 배포 → 제출 현황 확인.
6. Netlify에 하위도메인 DNS(와일드카드면 자동).

목표: **3~4단계를 교사가 30분 내 자가 완료.**

---

## 11. 데이터 임포트

- 명렬 xlsx: `class_lists/2026학년도_1-1_명렬.xlsx` 형식 파서 재사용(`xlsx` 패키지 이미 의존성). 콘솔에서 반별 업로드 → 컬럼 매핑 UI → `students` insert.
- 교사 CSV: `Teachers.csv` 형식(학년/반/담임/연락처/부담임...) 파서.
- 학생 사진: zip 업로드 → 파일명↔학번 매칭(기존 `organize_photos_*.mjs` 로직 참고).

---

## 12. 보안·개인정보

- 테넌트 격리: 게이트웨이 school_id 주입 + RLS 이중.
- 민감 필드(알레르기, 종교, 보호자, 건강): `piiLevel: sensitive` → 권한 없는 역할에는 게이트웨이가 응답에서 제거.
- 화면 공유용 이름 마스킹 모드(`FUTURE_TASKS.md` 4번) — 클라이언트 토글.
- 감사 로그: `access_logs`에 school_id 포함, 다운로드/조회 기록.
- 설문은 미성년 개인정보 수집 → 학교별 동의 문구 설정 필드 + 수집 항목 최소화 가이드.
- `SECRET_KEY` 평문 상수 제거, Clarity 태그 옵트인.

---

## 13. 단계별 로드맵

| 마일스톤 | 내용 | 산출물 | 대략 규모 |
| --- | --- | --- | --- |
| **M0 — 정리** | `1cl_global` 저장소 정리: 레거시 스크립트 격리, git 초기화, 경성전자고 브랜딩·상수 목록 확정, 스키마 확정 리뷰 | 정리된 저장소, 최종 ERD, 이 문서 확정 | 1~2일 |
| **M1 — 스키마·게이트웨이** | 멀티테넌트 스키마 마이그레이션 SQL, 게이트웨이 school_id 스코프/`/api/config`/RLS, 시드 스크립트(학교급 4종 템플릿) | `migrations/*.sql`, 확장된 `api.mjs`, seed | 3~5일 |
| **M2 — 설정 로더·렌더 일반화** | `school.js` 로더, `index.js`/`api.js`/`stu-list`/`bulk-record`/`total-records` 하드코딩 제거, class_info 포맷 캡슐화, i18n 스캐폴딩(ko) | 동적 그리드로 뜨는 운영 SPA | 5~8일 |
| **M3 — 관리자 콘솔** | 프로토타입을 정식 SPA로: 학교/학년반/학번/기능토글/교사·학생 명단 탭 | `/admin` 화면 (탭 1·2·3·7·8·9) | 5~8일 |
| **M4 — 설문 엔진** | `survey_schema` CRUD 탭(드래그 정렬·미리보기·다국어), `q.creat1324.com` 동적 폼, 제출·매핑·현황 | 설문 탭(4), 학생 폼, check-survey 일반화 | 5~8일 |
| **M5 — 생활기록·권한** | 프리셋/record_types 탭(5), 역할·권한 매트릭스(6), 게이트웨이 필드 필터, 근태 구조화 입력 | 탭 5·6, RBAC 동작 | 5~8일 |
| **M6 — 파일럿** | 실제 신규 학교 1곳 온보딩, 피드백, 버그픽스, 온보딩 런북 확정 | 파일럿 운영, v1.0 태그 | 1~2주 |

M2까지 끝나면 "경성전자고를 첫 테넌트로 재현" 가능(검증용). 실제 이관은 안 하지만 스키마/렌더 정합성 테스트 데이터로 활용.

---

## 14. 리스크 / 오픈 이슈

| 리스크 | 대응 |
| --- | --- |
| 학교급별 구조 차이(대학 무학년·계절학기, 초등 단반) 예상보다 큼 | `school_units`를 완전 자유형(레벨/클래스 라벨 임의)으로. 파일럿은 고교 1곳으로 좁게 시작 |
| RLS만으로 필드 단위 권한 불가 | 게이트웨이 응답 필터 + SECURITY DEFINER 함수 병행(이미 패턴 존재) |
| 설문 스키마 버전 변경 시 과거 응답 호환 | 필드 `id` 불변 원칙, 삭제 대신 `hidden`, 응답은 원본 JSONB 보존 |
| 하위도메인 와일드카드 SSL/DNS(creat1324.com) | Netlify 와일드카드 도메인 설정 선확인. 안 되면 경로 기반(`/s/<domain>`) 폴백 |
| 프로토타입의 localStorage·인라인 스크립트 난개발 | 정식 코드로 재작성(참고만), 상태는 서버 권威 |
| 레거시 일회성 스크립트가 신규 저장소 오염 | M0에서 `scripts/legacy/` 격리 or 별도 브랜치 |
| 교사 UI 다국어 요구 | 1차 ko 고정, i18n 키만 준비. 실제 번역은 수요 확인 후 |

### 결정 필요 (다음 단계 전)
1. `schools` 도메인: 하위도메인 와일드카드 vs 경로 기반 — Netlify/DNS 확인 후.
2. 학교급 지원 우선순위 — 파일럿 대상 학교급 1개 지정(고교 권장).
3. 관리자 콘솔 URL: 별도 앱(`app.`) vs 운영 SPA 내 `/admin` 라우트.
4. 기존 `1cl_global` git 히스토리 유지 vs 새로 시작(권장: 새로).
5. 브랜딩: 학교별 로고 커스터마이즈 범위 vs 공통 "GlobalHub" 고정.
