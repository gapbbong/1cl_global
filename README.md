# GlobalHub (원클 / OneClass — 멀티테넌트)

초·중·고·대 어디서나 담당교사가 **웹 콘솔에서** 학교 구조·명칭·설문·생활기록 항목·권한을 설정해 쓰는 학급 관리 서비스.
하나의 Netlify + Supabase 배포에 여러 학교(`schools`)를 `school_id`로 격리 수용한다.

> 경성전자고 운영본(v5.08)은 별도 저장소(`1cl_MsGPT`)에서 동결 유지. 이 저장소는 신규 멀티테넌트 코드.

## 저장소 구조

```
src/            운영 SPA (Vite 멀티페이지). css/ js/
*.html          각 페이지 진입점
netlify/        서버리스 게이트웨이 (functions/api.mjs = 신뢰 경계)
db/             스키마 및 마이그레이션
  migrations/   순번 SQL (0001_*, 0002_* ...)
docs/           설계 문서
  ../GLOBAL_EXPANSION_PLAN.md   전체 확장 계획 (M0~M6)
_legacy/        경성전자고 운영 중 쌓인 일회성 스크립트·데이터·구 PHP/GAS 백엔드.
                실행/참고용 아카이브. 신규 코드는 여기에 의존하지 않는다.
public/         정적 자산 (manifest, icons, service-worker)
```

## 개발

```bash
npm install
npm run dev        # vite 개발 서버
npm run build      # dist/ 생성
npm run lint
```

환경변수(`.env`, Netlify 대시보드): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`AUTH_SIGNING_SECRET`(32자+), `GEMINI_API_KEYS`(콤마구분, 선택).

## 진행 상태

- [x] **M0** 저장소 정리 (레거시 격리, git 초기화)
- [x] **M1** 멀티테넌트 스키마(`db/migrations/0001`) + 게이트웨이 school_id 스코프 + `/api/config`
      · 신규 Supabase 프로젝트에 적용 완료 + 데모 학교(domain `demo`) 생성 — [ONBOARDING.md](docs/ONBOARDING.md)
- [x] **M2** 하드코딩 제거 — `school.js` 헬퍼(isAdmin/canManageClass/studentIdParts/classOptions/majorOf),
      홈·check-survey·class-analysis·print-report·quiz·quiz-start·search 의 학년·반·학과 셀렉트를 school_units 기반으로,
      관리자 이메일 배열 삭제→역할/권한, keeper 이메일→gatekeeper 역할, getTeacherProfile 신규 스키마 정규화.
      (owner 배치 패널·근태 정규식·map-3d 실 위치는 M5 이후)
- [x] **M3(1차)** 관리자 콘솔 `admin-console.html` — 학교/학년·반/교사/역할·권한. 설문·생활기록 탭은 M4~M5
- [x] **M3(2차)** `db/migrations/0003` — students/life_records/surveys + record_comments/custom_menus/
      student_insights/schedules/quiz_scores/preset_categories/user_logs/access_logs + `class_record_counts` 뷰,
      전부 `school_id` + RLS. 신규 Supabase에 적용, 데모 학생 10명 시드, stu-list/총기록 검증 완료.
- [x] **M4** 설문 엔진 — `db/migrations/0004` (survey_schema / form_tokens + 고교 27문항 seed + storage 버킷),
      게이트웨이 무인증 `/api/survey/{form,submit,photo}`, 학생용 폼 `survey-form.html`(동적 렌더 + mapTo 동기화),
      콘솔 **설문 문항** 탭(문항 편집·순서·숨김·QR/토큰·언어). 신규 Supabase 적용 + 종단 검증 완료.
- [x] **M5** 생활기록·권한 매트릭스 — `db/migrations/0005` (record_types + visible_to),
      게이트웨이 `rolefilter.mjs`(students 연락처/민감 마스킹, surveys 필드 화이트리스트·read:none,
      life_records visible_to·types, own_class 학생 쿼리 스코프), 콘솔 **생활기록 항목** 탭.
      검증: 교과/보건/지킴이가 각자 허용된 subset만 조회.
- [x] **M6** 온보딩 — `scripts/onboard.mjs`(1커맨드 학교 생성), 콘솔 **학생 명단** 탭(xlsx 업로드·컬럼 자동매핑·
      시트명 반 감지·미리보기·재업로드 병합, 반별 학생 상태/삭제), [DEPLOY.md](docs/DEPLOY.md).
      검증: `한빛중학교` 온보딩 + 22명 명렬 업로드.
      부수 수정: `/api/config` SW·HTTP 캐시로 인한 테넌트 혼선, upsert `columns=` 화이트리스트가
      주입된 school_id 를 버리던 문제, students DELETE(관리자 한정).
- [x] **M7** 폴리시 — `/api/config` 에 설문 필드 라벨 + record_types 포함, 학생 팝업 상세 기초조사가
      학교 설문 스키마 순서·라벨로 표시(행 메타 누출 제거), 교사 CSV/xlsx 일괄 등록.

자세한 내용: [GLOBAL_EXPANSION_PLAN.md](GLOBAL_EXPANSION_PLAN.md)
