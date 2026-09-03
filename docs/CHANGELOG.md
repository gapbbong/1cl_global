# 변경 이력 — GlobalHub 초기 구축

> 저장소를 배포용으로 정리하며 커밋 히스토리를 스쿼시했습니다.
> 최초 구축 과정(M0~M7)의 요약을 남깁니다.

## M0 — 저장소 정리
경성전자고 운영 중 쌓인 일회성 스크립트·데이터 373개를 `_legacy/`로 격리, git 초기화, `db/` `docs/` `README` 신설.

## M1 — 멀티테넌트 코어
`db/migrations/0001` — `schools` / `school_units` / `roles`(권한 매트릭스 JSONB) / `teachers`.
게이트웨이가 모든 테넌트 테이블에 `school_id` 강제 주입/필터, `GET /api/config` 설정 번들.
관리자 콘솔 4탭(학교/학년반/교사/역할권한).

## M2 — 하드코딩 제거
`src/js/school.js` 설정 로더. 홈 화면 3학년×6반 루프 → `school_units` 순회.
관리자 이메일 배열 → 역할 기반 판정. `keeper@kse.hs.kr` → gatekeeper 역할.
학번 규칙·학과 매핑 변수화. check-survey/class-analysis/print-report/quiz/search 셀렉트 동적화.
GAS(`SCRIPT_URL`) 경로 폐기. 로컬 dev-gateway(`scripts/dev-gateway.mjs`) + vite 프록시.

## M3 — 학생/기록/설문 스키마
`db/migrations/0003` — `students` / `life_records` / `surveys` + 10개 부수 테이블
+ `class_record_counts` 뷰, 전부 `school_id` + RLS.

## M4 — 설문 엔진
`db/migrations/0004` — `survey_schema`(고교 27문항 seed) / `form_tokens` + storage 버킷.
게이트웨이 무인증 `/api/survey/{form,submit,photo}`. 학생용 폼 `survey-form.html`(동적 렌더 + `mapTo` 동기화).
콘솔 **설문 문항** 탭(문항 편집·순서·QR·언어).

## M5 — record_types + 역할별 필드 필터
`db/migrations/0005` — `record_types`(칭찬/지도/근태/상담/일반) + `visible_to`.
`netlify/lib/rolefilter.mjs` — 조회 응답을 역할로 필터(연락처/민감정보 마스킹, 설문 필드 화이트리스트,
기록 유형 가시성, own_class 학생 쿼리 스코프). 콘솔 **생활기록 항목** 탭.

## M6 — 온보딩
`scripts/onboard.mjs` — `bootstrap_school` RPC 1커맨드 학교 생성.
콘솔 **학생 명단** 탭 — 명렬 xlsx 파싱·컬럼 자동매핑·시트명 반 감지·미리보기·병합 업로드.
`docs/DEPLOY.md`.

## M7 — 폴리시
`/api/config`에 설문 필드 라벨 + record_types 포함. 학생 팝업 상세 기초조사가 학교 설문 스키마
순서·라벨로 표시(행 메타 누출 제거). 교사 CSV/xlsx 일괄 등록.

## 부수 수정
- `/api/config` SW·HTTP 캐시로 인한 테넌트 혼선 → SW `/api/*` 우회 + `no-store`
- supabase-js upsert `?columns=` 화이트리스트가 주입된 `school_id`를 버리던 문제
- `students` DELETE 관리자 한정
- 인증 실패 메시지 구체화(no_tenant/school_not_found 등)
