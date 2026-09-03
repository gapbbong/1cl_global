-- =====================================================================
-- 0004_survey_engine.sql  —  기초조사 엔진
--
--  survey_schema : 학교별 설문 문항 정의 (콘솔에서 편집)
--  form_tokens   : 학생 배포용 링크/QR 토큰 (무인증 접근)
--
--  학생용 폼(q.creat1324.com/f/<token>)은 게이트웨이의 무인증 라우트
--  /api/survey/form, /api/survey/submit 을 사용한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- survey_schema  (학교당 1행)
-- ---------------------------------------------------------------------
create table if not exists public.survey_schema (
  school_id  uuid primary key references public.schools(id) on delete cascade,
  version    int  not null default 1,
  languages  jsonb not null default '["ko"]'::jsonb,      -- ["ko","vi","uz"]
  consent    jsonb not null default '{}'::jsonb,          -- { "ko": "동의 문구..." }
  -- fields[] : { id, label:{ko,..}, type, options?, required, hidden, order, group?, piiLevel, mapTo? }
  fields     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_survey_schema_touch on public.survey_schema;
create trigger trg_survey_schema_touch before update on public.survey_schema
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- form_tokens  (배포 토큰)
-- ---------------------------------------------------------------------
create table if not exists public.form_tokens (
  token        text primary key,
  school_id    uuid not null references public.schools(id) on delete cascade,
  label        text,
  class_filter text,                         -- null = 전교, "1-1" = 특정 반 고정
  active       boolean not null default true,
  open_at      timestamptz,
  close_at     timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_form_tokens_school on public.form_tokens(school_id);

alter table public.survey_schema enable row level security;
alter table public.form_tokens   enable row level security;

-- ---------------------------------------------------------------------
-- 고교 기본 설문 템플릿 seed 함수
-- ---------------------------------------------------------------------
create or replace function public.seed_default_survey(p_school uuid)
returns void language plpgsql as $fn$
begin
  insert into public.survey_schema (school_id, fields)
  values (p_school, $json$[
    {"id":"name","label":{"ko":"성명"},"type":"short","required":true,"order":1,"piiLevel":"normal","mapTo":"name"},
    {"id":"photo","label":{"ko":"사진"},"type":"photo","required":false,"order":2,"piiLevel":"normal","mapTo":"photo_url"},
    {"id":"gender","label":{"ko":"성별"},"type":"select","options":[{"value":"남","label":{"ko":"남"}},{"value":"여","label":{"ko":"여"}},{"value":"기타","label":{"ko":"기타"}}],"required":false,"order":3,"piiLevel":"normal","mapTo":"gender"},
    {"id":"birth_date","label":{"ko":"생년월일"},"type":"date","required":false,"order":4,"piiLevel":"normal","mapTo":"birth_date"},
    {"id":"contact","label":{"ko":"연락처"},"type":"tel","required":false,"order":5,"piiLevel":"normal","mapTo":"contact"},
    {"id":"address","label":{"ko":"집 주소"},"type":"short","required":false,"order":6,"group":"기본","piiLevel":"sensitive","mapTo":"address"},
    {"id":"instagram","label":{"ko":"인스타 ID"},"type":"short","required":false,"order":7,"piiLevel":"normal","mapTo":"instagram_id"},
    {"id":"middle_school","label":{"ko":"출신 중학교"},"type":"short","required":false,"order":8,"piiLevel":"normal","mapTo":"middle_school"},
    {"id":"mbti","label":{"ko":"MBTI (모르면 대략)"},"type":"short","required":false,"order":9,"group":"성향","piiLevel":"normal"},
    {"id":"guardian_primary","label":{"ko":"주보호자 정보 (관계·연락처)"},"type":"long","required":false,"order":10,"group":"가족","piiLevel":"sensitive"},
    {"id":"guardian_secondary","label":{"ko":"보조보호자 정보 (관계·연락처)"},"type":"long","required":false,"order":11,"group":"가족","piiLevel":"sensitive"},
    {"id":"siblings","label":{"ko":"형제 관계 (남·녀 중 몇째)"},"type":"short","required":false,"order":12,"group":"가족","piiLevel":"normal"},
    {"id":"career_hope","label":{"ko":"졸업 후 희망 진로"},"type":"short","required":false,"order":13,"piiLevel":"normal"},
    {"id":"study_concern","label":{"ko":"학습 관련 고민"},"type":"long","required":false,"order":14,"piiLevel":"normal"},
    {"id":"hobby","label":{"ko":"취미 / 특기"},"type":"long","required":false,"order":15,"piiLevel":"normal"},
    {"id":"food","label":{"ko":"좋아하는 / 싫어하는 음식"},"type":"short","required":false,"order":16,"piiLevel":"normal"},
    {"id":"sleep","label":{"ko":"잠드는 시간 / 평균 수면"},"type":"short","required":false,"order":17,"piiLevel":"normal"},
    {"id":"strengths","label":{"ko":"나의 장점 3가지"},"type":"long","required":false,"order":18,"piiLevel":"normal"},
    {"id":"close_friend","label":{"ko":"의지가 되는 친한 친구"},"type":"short","required":false,"order":19,"piiLevel":"normal"},
    {"id":"motto","label":{"ko":"나의 좌우명"},"type":"short","required":false,"order":20,"piiLevel":"normal"},
    {"id":"hard_thing","label":{"ko":"나를 힘들게 하는 것"},"type":"long","required":false,"order":21,"piiLevel":"sensitive"},
    {"id":"allergy","label":{"ko":"알레르기 · 복용약 · 건강 특이사항"},"type":"long","required":false,"order":22,"group":"건강","piiLevel":"sensitive"},
    {"id":"religion","label":{"ko":"종교 활동 · 신앙적 고민 (선택)"},"type":"long","required":false,"order":23,"group":"건강","piiLevel":"sensitive"},
    {"id":"foreign_parent","label":{"ko":"부모님 중 외국인 여부 / 국가"},"type":"short","required":false,"order":24,"piiLevel":"sensitive"},
    {"id":"best_thing","label":{"ko":"최근 1년간 가장 잘한 일"},"type":"long","required":false,"order":25,"piiLevel":"normal"},
    {"id":"regret","label":{"ko":"최근 1년간 고치고 싶은 점"},"type":"long","required":false,"order":26,"piiLevel":"normal"},
    {"id":"message_to_teacher","label":{"ko":"선생님께 드리고 싶은 말 (비공개)"},"type":"long","required":false,"order":27,"piiLevel":"sensitive"}
  ]$json$::jsonb)
  on conflict (school_id) do nothing;
end $fn$;

-- 랜덤 토큰
create or replace function public.gen_form_token()
returns text language sql as $$ select encode(gen_random_bytes(9), 'hex') $$;

-- 기존 학교들에 기본 설문 + 기본 토큰
do $do$
declare s record; v_token text;
begin
  for s in select id from public.schools loop
    perform public.seed_default_survey(s.id);
    if not exists (select 1 from public.form_tokens where school_id = s.id) then
      v_token := public.gen_form_token();
      insert into public.form_tokens (token, school_id, label) values (v_token, s.id, '기본 배포 링크');
    end if;
  end loop;
end $do$;

-- bootstrap_school 이 설문/토큰도 생성하도록 확장
create or replace function public.bootstrap_school(
  p_domain text, p_name text, p_education_type text,
  p_admin_email text, p_admin_name text,
  p_levels int default 3, p_classes int default 6, p_academic_year int default null
) returns uuid language plpgsql security definer as $fn$
declare
  v_school uuid;
  v_year int := coalesce(p_academic_year, extract(year from now())::int);
  lv int; cl int;
begin
  insert into public.schools (domain_name, name, education_type, academic_year)
  values (lower(p_domain), p_name, p_education_type, v_year) returning id into v_school;
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
    (v_school,'nurse','보건교사','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"all","fields":["알레르기","건강특이사항","혈액형"]},"records":{"read":"none","write":"none"}}'::jsonb,'home',false,50),
    (v_school,'gatekeeper','배움터지킴이','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"own_class","types":["attendance"]}}'::jsonb,'attendance',false,60);
  insert into public.teachers (school_id, email, name, role_key, active)
  values (v_school, lower(p_admin_email), p_admin_name, 'admin', true);
  perform public.seed_default_presets(v_school);
  perform public.seed_default_survey(v_school);
  insert into public.form_tokens (token, school_id, label)
  values (public.gen_form_token(), v_school, '기본 배포 링크');
  return v_school;
end $fn$;
