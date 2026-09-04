# 규정 대응 체크리스트 — 원클(신규 학교)

> 경성전자고(`1cl_MsGPT`)는 이 문서 범위 밖. 신규 코드베이스(`1cl_global`)만 해당.

## 저장 위치

- Supabase 프로젝트 `ogbwvbuqwvuozxxhfalj` — **AWS `ap-northeast-2`(서울)**. 국내 저장 요건 충족.
- 저장 시 암호화: Supabase 기본 AES-256(at rest). 전송: 전 구간 HTTPS/TLS.
- 파일(사진): Storage 버킷 `student-photos`(공개 링크는 게이트웨이 경유), `evidence-photos`(비공개).

## 코드로 제공하는 안전조치

| 항목 | 구현 |
| --- | --- |
| 접근권한 최소화 | `roles.permissions` — 역할별로 연락처/민감정보/설문/기록 필드 제한. 게이트웨이가 응답 후필터링 |
| 테넌트 격리 | 모든 쿼리에 `school_id` 강제 주입 (한 학교가 타교 데이터 접근 불가) |
| 접속기록 | `access_logs` — 특정 학생/설문/기록 조회 시 자동 기록(계정·일시·업무·IP해시). `user_logs` — 쓰기·관리 작업 |
| 접속지 정보 | 원본 IP 미저장. `sha256(ip + 서명시크릿)` 앞 22자만 |
| 보유기간 파기 | `purge_expired_data()` — 해당 학년도+N년 경과 학생/설문/기록/이력 삭제. `schools.privacy.retention_years` |
| 접속기록 파기 | `purge_old_access_logs()` — 보관연수(`access_log_years`, 기본 1년) 경과분 삭제 |
| 정보주체 권리 | `GET /api/student-export?pid=` 열람·이동, `DELETE /api/db/students?pid=` (관리자) 삭제 |
| 동의 | 설문 제출 전 화면 동의 + `consents` 테이블 이력(동의자·관계·버전·시각·IP해시) |

## 관리자 콘솔 — "개인정보" 탭

- 보존기간·동의 필수 여부·동의 문구·자동파기 on/off 설정
- 접속기록 조회(최근 N건)
- 학년말 일괄 파기 (먼저 dry-run 으로 건수 확인 후 실행)
- 개인정보 보호책임자 정보

## 교육청·학교 제출용 문서

| 파일 | 용도 |
| --- | --- |
| `docs/PRIVACY.md` | 개인정보 처리방침 (홈페이지·가정통신문 게시) |
| `docs/consent-form-template.md` | 학부모 동의서 (서면 동의 필요 시) |
| `docs/dpa-template.md` | 개인정보 처리 위탁계약서 (학교 ↔ 운영자) |

## 운영자 온보딩 체크

- [ ] 학교로부터 위탁계약서(`dpa-template.md`) 서명본 수령
- [ ] 학교가 처리방침(`PRIVACY.md`) 게시 확인
- [ ] 콘솔 "개인정보" 탭에서 보존기간·보호책임자 정보 입력 안내
- [ ] 설문 문항에서 불필요한 민감정보 제거 안내(최소수집)
- [ ] (선택) `.github/workflows` 에 야간 자동 파기 스케줄 활성화

## 자동 파기 스케줄 (선택)

`SITE_URL` + 관리자 토큰 발급 후 GitHub Action 또는 pg_cron 으로
`purge_expired_data(school_id, false)` / `purge_old_access_logs(school_id, false)` 를
학기말·연 1회 이상 실행. 수동으로는 콘솔 "개인정보" 탭 버튼.
