-- =====================================================================
-- 0005_record_types.sql  —  생활기록 타입 + 역할별 가시성
--
--  record_types : 학교별 생활기록 유형 (칭찬/지도/근태/상담/일반 ...)
--     visible_to : ["all"] 또는 역할 key 배열 → 게이트웨이가 조회 시 필터
--     fields     : 구조화 입력 필드 (근태 외출 시작/종료 등) — 정규식 파싱 대체
-- =====================================================================

create table if not exists public.record_types (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  key        text not null,            -- praise|guidance|attendance|counsel|general
  label      text not null,            -- '칭찬','지도','근태','상담','일반' (life_records.category 와 매칭)
  polarity   text not null default 'neutral',  -- positive|negative|neutral|attendance
  fields     jsonb not null default '[]'::jsonb,
  visible_to jsonb not null default '["all"]'::jsonb,
  sort_order int not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, key)
);
create index if not exists idx_record_types_school on public.record_types(school_id);
alter table public.record_types enable row level security;

create or replace function public.seed_default_record_types(p_school uuid)
returns void language plpgsql as $fn$
begin
  insert into public.record_types (school_id, key, label, polarity, visible_to, sort_order) values
    (p_school, 'praise',     '칭찬', 'positive',   '["all"]'::jsonb, 10),
    (p_school, 'guidance',   '지도', 'negative',   '["all"]'::jsonb, 20),
    (p_school, 'attendance', '근태', 'attendance', '["all"]'::jsonb, 30),
    (p_school, 'counsel',    '상담', 'neutral',    '["admin","counselor"]'::jsonb, 40),
    (p_school, 'general',    '일반', 'neutral',    '["all"]'::jsonb, 50)
  on conflict (school_id, key) do nothing;

  -- 근태 구조화 필드
  update public.record_types
     set fields = $j$[
       {"id":"kind","label":"구분","type":"select","options":["지각","조퇴","외출","결석"]},
       {"id":"start","label":"시작 시각","type":"time"},
       {"id":"end","label":"종료 시각","type":"time"},
       {"id":"reason","label":"사유","type":"short"}
     ]$j$::jsonb
   where school_id = p_school and key = 'attendance' and fields = '[]'::jsonb;
end $fn$;

-- 기존 학교에 시드 + 역할 권한 정합성 보정
do $do$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.seed_default_record_types(s.id);
    -- 보건교사: 설문 중 건강 관련 필드만 (필드 id 기준)
    update public.roles
       set permissions = jsonb_set(permissions, '{survey}',
             '{"read":"all","fields":["allergy","health_note","religion"]}'::jsonb)
     where school_id = s.id and key = 'nurse';
    -- 배움터지킴이: 생활기록 중 근태만 읽기/쓰기
    update public.roles
       set permissions = jsonb_set(permissions, '{records}',
             '{"read":"all","write":"own_class","types":["근태"]}'::jsonb)
     where school_id = s.id and key = 'gatekeeper';
    -- 교과교사: 상담 제외 전체 (record_types.visible_to 가 처리하므로 read=all 유지)
  end loop;
end $do$;

-- bootstrap_school 확장
create or replace function public.bootstrap_school(
  p_domain text, p_name text, p_education_type text,
  p_admin_email text, p_admin_name text,
  p_levels int default 3, p_classes int default 6, p_academic_year int default null
) returns uuid language plpgsql security definer as $fn$
declare
  v_school uuid; v_year int := coalesce(p_academic_year, extract(year from now())::int); lv int; cl int;
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
