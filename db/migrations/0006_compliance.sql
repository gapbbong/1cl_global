-- =====================================================================
-- 0006_compliance.sql  —  개인정보 규정 대응 (신규 학교 전용)
--
-- 전제: DB 는 이미 국내 리전(aws-1-ap-northeast-2 / 서울)에 있다.
-- 이 마이그레이션이 추가하는 것:
--   1) schools.privacy — 학교별 개인정보 정책(보존기간·동의·처리자정보)
--   2) consents — 학부모/학생 동의 이력
--   3) user_logs / access_logs 컬럼 확장 — 접속기록(개인정보처리시스템)
--   4) purge_expired_data() — 보존기간 만료 데이터 파기
--   5) purge_old_access_logs() — 1년(설정 시 2년) 경과 접속기록 정리
--
-- 근거: 개인정보 보호법 제21조(파기), 제29조(안전조치),
--       시행령 제30조(접속기록 1년/민감·고유식별정보 또는 10만명↑ 2년).
-- =====================================================================

-- ── 1. schools.privacy ────────────────────────────────────────────────
alter table public.schools
  add column if not exists privacy jsonb not null default jsonb_build_object(
    'retention_years',  1,      -- 해당 학년도 종료 후 N년 경과 시 학생 개인정보 파기 대상
    'purge_enabled',    false,  -- 자동 파기 on/off (관리자가 명시적으로 켜야 동작)
    'consent_required', true,   -- 설문 제출 전 동의 필수
    'consent_text',     '',     -- 동의 안내 문구 (비면 게이트웨이 기본 문구)
    'consent_version',  1,      -- 문구 변경 시 올려서 재동의 유도
    'log_reads',        true,   -- 민감정보 열람도 접속기록에 남김
    'access_log_years', 1,      -- 접속기록 보관연수 (민감정보·대규모면 2 로)
    'controller_name',  '',     -- 개인정보처리자 (학교명/부서)
    'dpo_name',         '',     -- 개인정보 보호책임자
    'dpo_contact',      ''      -- 보호책임자 연락처(이메일/전화)
  );

comment on column public.schools.privacy is
  '학교별 개인정보 정책. 게이트웨이·콘솔·파기함수가 해석.';

-- ── 2. consents (동의 이력) ───────────────────────────────────────────
create table if not exists public.consents (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_pid  uuid references public.students(pid) on delete cascade,
  student_ref  text,                                  -- 학번(학생 생성 전 제출 대비)
  scope        text not null default 'survey',        -- 'survey' | 'records' | ...
  version      int  not null default 1,
  agreed       boolean not null default true,
  agent_name   text,                                  -- 동의자 이름
  agent_role   text default 'guardian',               -- 'guardian' | 'student'
  ip_hash      text,                                  -- sha256(ip + 서버 시크릿). 원본 IP 저장 안 함
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_consents_school  on public.consents(school_id);
create index if not exists idx_consents_student on public.consents(student_pid);
alter table public.consents enable row level security;

-- ── 3. 접속기록 컬럼 확장 ─────────────────────────────────────────────
alter table public.user_logs
  add column if not exists target_type text,     -- 'student' | 'survey' | 'life_record' | ...
  add column if not exists target_id   text,     -- 대상 식별자(학번/pid 등)
  add column if not exists ip_hash     text,
  add column if not exists result      text;     -- 'ok' | 'denied' | 'error'
create index if not exists idx_user_logs_school_time on public.user_logs(school_id, created_at desc);

alter table public.access_logs
  add column if not exists ip_hash    text,
  add column if not exists detail     text;
create index if not exists idx_access_logs_school_time on public.access_logs(school_id, accessed_at desc);
create index if not exists idx_access_logs_student on public.access_logs(student_pid);

-- ── 4. 보존기간 만료 데이터 파기 ──────────────────────────────────────
-- academic_year <= (올해 - retention_years) 인 학생 및 그 하위 데이터(설문·기록·
-- 댓글·인사이트·동의: FK on delete cascade)를 삭제. 이력 테이블도 함께 정리.
create or replace function public.purge_expired_data(p_school uuid, p_dry_run boolean default true)
returns jsonb language plpgsql security definer as $fn$
declare
  v_years  int;
  v_cutoff int;
  v_students int; v_surveys int; v_records int; v_history int;
begin
  select coalesce((privacy->>'retention_years')::int, 1) into v_years
    from public.schools where id = p_school;
  if v_years is null then
    raise exception 'school not found: %', p_school;
  end if;
  v_cutoff := extract(year from now())::int - v_years;

  select count(*) into v_students from public.students
    where school_id = p_school and academic_year <= v_cutoff;
  select count(*) into v_surveys from public.surveys s
    join public.students st on st.pid = s.student_pid
    where s.school_id = p_school and st.academic_year <= v_cutoff;
  select count(*) into v_records from public.life_records l
    join public.students st on st.pid = l.student_pid
    where l.school_id = p_school and st.academic_year <= v_cutoff;
  select count(*) into v_history from public.student_history
    where school_id = p_school and coalesce(academic_year, 0) <= v_cutoff;

  if not p_dry_run then
    delete from public.students       where school_id = p_school and academic_year <= v_cutoff;
    delete from public.student_history where school_id = p_school and coalesce(academic_year, 0) <= v_cutoff;
    insert into public.user_logs (school_id, teacher_email, page_path, action, target_type, result)
      values (p_school, 'system', 'purge', 'PURGE_EXPIRED',
              'cutoff_year:' || v_cutoff, 'ok');
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'cutoff_year', v_cutoff, 'retention_years', v_years,
    'students', v_students, 'surveys', v_surveys,
    'life_records', v_records, 'student_history', v_history
  );
end $fn$;

comment on function public.purge_expired_data is
  '보존기간(schools.privacy.retention_years) 만료 학생/설문/기록/이력 파기. p_dry_run=true 면 건수만.';

-- ── 5. 접속기록 정리 (보관연수 경과분 삭제) ───────────────────────────
create or replace function public.purge_old_access_logs(p_school uuid, p_dry_run boolean default true)
returns jsonb language plpgsql security definer as $fn$
declare
  v_years int;
  v_before timestamptz;
  v_ul int; v_al int;
begin
  select coalesce((privacy->>'access_log_years')::int, 1) into v_years
    from public.schools where id = p_school;
  v_before := now() - make_interval(years => coalesce(v_years, 1));

  select count(*) into v_ul from public.user_logs   where school_id = p_school and created_at  < v_before;
  select count(*) into v_al from public.access_logs where school_id = p_school and accessed_at < v_before;

  if not p_dry_run then
    delete from public.user_logs   where school_id = p_school and created_at  < v_before;
    delete from public.access_logs where school_id = p_school and accessed_at < v_before;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'before', v_before,
                            'user_logs', v_ul, 'access_logs', v_al);
end $fn$;

comment on function public.purge_old_access_logs is
  '보관연수(schools.privacy.access_log_years, 기본 1년) 경과 접속기록 삭제.';

-- ── 6. bootstrap_school 확장 — 신규 학교에 privacy 기본값 주입 ─────────
-- (default 로도 채워지지만, controller_name 을 학교명으로 초기화)
create or replace function public.bootstrap_school(
  p_domain text, p_name text, p_education_type text,
  p_admin_email text, p_admin_name text,
  p_levels int default 3, p_classes int default 6, p_academic_year int default null
) returns uuid language plpgsql security definer as $fn$
declare
  v_school uuid; v_year int := coalesce(p_academic_year, extract(year from now())::int); lv int; cl int;
begin
  insert into public.schools (domain_name, name, education_type, academic_year, privacy)
  values (
    lower(p_domain), p_name, p_education_type, v_year,
    jsonb_build_object(
      'retention_years', 1, 'purge_enabled', false,
      'consent_required', true, 'consent_text', '', 'consent_version', 1,
      'log_reads', true, 'access_log_years', 1,
      'controller_name', p_name, 'dpo_name', p_admin_name, 'dpo_contact', lower(p_admin_email)
    )
  ) returning id into v_school;
  for lv in 1..p_levels loop
    for cl in 1..p_classes loop
      insert into public.school_units (school_id, level_label, level_order, class_label, class_order)
      values (v_school, lv || '학년', lv, cl || '반', cl);
    end loop;
  end loop;
  insert into public.roles (school_id, key, label, permissions, landing_page, is_system, sort_order) values
    (v_school,'admin','관리자','{"scope":"all","admin":{"school":true,"units":true,"roles":true,"survey_schema":true,"teachers":true},"students":{"read":["basic","contact","sensitive"],"write":["contact"]},"survey":{"read":"all"},"records":{"read":"all","write":"all"}}'::jsonb,'home',true,10),
    (v_school,'homeroom','담임','{"scope":"own_class","students":{"read":["basic","contact","sensitive"],"write":["contact"]},"survey":{"read":"own_class"},"records":{"read":"own_class","write":"own_class"}}'::jsonb,'my_class',false,20),
    (v_school,'subject','교과교사','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"all"}}'::jsonb,'home',false,30),
    (v_school,'counselor','상담교사','{"scope":"all","students":{"read":["basic","contact"]},"survey":{"read":"all"},"records":{"read":"all","write":"all"}}'::jsonb,'home',false,40),
    (v_school,'nurse','보건교사','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"all","fields":["allergy","health_note","religion"]},"records":{"read":"none","write":"none"}}'::jsonb,'home',false,50),
    (v_school,'gatekeeper','배움터지킴이','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"own_class","types":["근태"]}}'::jsonb,'attendance',false,60);
  insert into public.teachers (school_id, email, name, role_key, active)
  values (v_school, lower(p_admin_email), p_admin_name, 'admin', true);
  perform public.seed_default_presets(v_school);
  perform public.seed_default_survey(v_school);
  perform public.seed_default_record_types(v_school);
  insert into public.form_tokens (token, school_id, label)
  values (public.gen_form_token(), v_school, '기본 배포 링크');
  return v_school;
end $fn$;

-- ── 7. 기존 학교 privacy.controller_name 백필 ─────────────────────────
update public.schools
  set privacy = privacy
    || jsonb_build_object('controller_name', name)
  where coalesce(privacy->>'controller_name', '') = '';
