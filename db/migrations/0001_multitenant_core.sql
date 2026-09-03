-- =====================================================================
-- 0001_multitenant_core.sql  —  GlobalHub 멀티테넌트 코어 스키마
--
-- 적용 대상: 신규 Supabase 프로젝트 (경성전자고 운영 DB 아님).
-- 이 마이그레이션은 "학교(테넌트) / 학년·반 구조 / 교사 / 역할·권한"만 다룬다.
-- 학생·생활기록·설문 테이블의 school_id 확장은 0003 이후에서 이어간다.
--
-- 신뢰 경계: 브라우저는 Supabase 키를 갖지 않는다. 모든 접근은
-- Netlify 게이트웨이(service_role)가 세션 토큰을 검증하고 school_id를
-- 강제 주입한 뒤 PostgREST로 전달한다. 아래 RLS는 최후 방어선.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. schools  (테넌트)
-- ---------------------------------------------------------------------
create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  domain_name     text unique not null
                    check (domain_name ~ '^[a-z][a-z0-9-]{2,30}$'),
  name            text not null,
  short_name      text,
  -- 'elem' | 'middle' | 'high' | 'college2' | 'college4' | 'kinder'
  education_type  text not null default 'high',
  academic_year   int  not null default extract(year from now())::int,
  locale          text not null default 'ko',
  support_contact text,
  -- 학번 규칙: { "length": 4, "compose": "grade_class_no" | "free", "regex": null }
  student_id_rule jsonb not null default '{"length":4,"compose":"grade_class_no"}'::jsonb,
  -- 화면 테마: { "primary": "#365cf5", "logoUrl": null, "gradeColors": [] }
  theme           jsonb not null default '{}'::jsonb,
  -- 활성 기능 토글: ["quiz","map-3d","calendar","notifications","teacher-profile", ...]
  features        jsonb not null default '["search","bulk-record","check-survey","print-report"]'::jsonb,
  status          text not null default 'active',   -- active | suspended
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.schools is '테넌트(학교) 1행 = 1학교. domain_name 하위도메인으로 식별.';

-- ---------------------------------------------------------------------
-- 2. school_units  (학년 / 반 구조 — 초·중·고·대 모두 표현)
-- ---------------------------------------------------------------------
create table if not exists public.school_units (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  level_label  text not null,                 -- '1학년', '신입생', '3학년' ...
  level_order  int  not null,
  class_label  text not null,                 -- '1반', 'A반', '경영1분반' ...
  class_order  int  not null,
  major        text,                          -- 학과/전공 (majorMapping 대체)
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (school_id, level_order, class_order)
);
create index if not exists idx_school_units_school on public.school_units(school_id);

comment on column public.school_units.major is 'majorMapping 대체 — 반별 학과명';

-- ---------------------------------------------------------------------
-- 3. roles  (학교별 역할 정의 + 권한 매트릭스)
--    enum(user_role)을 없애고 학교마다 자유롭게 역할을 정의한다.
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  key          text not null,                 -- 'admin','homeroom','counselor','nurse','gatekeeper','subject'
  label        text not null,                 -- '관리자','담임','상담교사','보건교사','배움터지킴이','교과교사'
  -- 권한 스펙 (게이트웨이가 해석). 예:
  -- { "scope":"all|own_class|none",
  --   "students":{"read":["basic","contact"],"write":["contact"]},
  --   "survey":{"read":"all|own_class","fields":null|["알레르기"]},
  --   "records":{"read":"all|own_class","write":"own_class","types":null|["attendance"]},
  --   "admin":{"school":false,"units":false,"roles":false,"survey_schema":false,"teachers":false} }
  permissions  jsonb not null default '{}'::jsonb,
  landing_page text not null default 'home',   -- 로그인 후 첫 화면
  is_system    boolean not null default false, -- admin 등 삭제 불가 역할
  sort_order   int not null default 100,
  created_at   timestamptz not null default now(),
  unique (school_id, key)
);
create index if not exists idx_roles_school on public.roles(school_id);

-- ---------------------------------------------------------------------
-- 4. teachers  (신규 정의 — 경성전자고 스키마와 다름)
--    auth.users 의존 제거: 인증은 게이트웨이의 이메일 화이트리스트 방식.
-- ---------------------------------------------------------------------
create table if not exists public.teachers (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  email          text not null,
  name           text not null,
  phone          text,
  role_key       text not null default 'subject',   -- roles.key 참조 (주 역할)
  -- 담당 학급 (담임/부담임). school_units.id 배열.
  homeroom_unit  uuid references public.school_units(id) on delete set null,
  assist_units   uuid[] not null default '{}',
  -- 추가 역할(겸직): ['counselor','gatekeeper'] 처럼 여러 개 가능
  extra_roles    text[] not null default '{}',
  active         boolean not null default true,
  -- 교사 개인 설정 (시작화면/메뉴/알림) — 기존 teachers.settings 계승
  settings       jsonb not null default '{}'::jsonb,
  -- 선생님 프로필 (teacher_profile_proposal.md)
  profile        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (school_id, email)
);
create index if not exists idx_teachers_school on public.teachers(school_id);
create index if not exists idx_teachers_email  on public.teachers(lower(email));

-- ---------------------------------------------------------------------
-- 5. updated_at 자동 갱신 트리거
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_schools_touch  on public.schools;
create trigger trg_schools_touch  before update on public.schools
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_teachers_touch on public.teachers;
create trigger trg_teachers_touch before update on public.teachers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. RLS  (최후 방어선 — 실제 인가는 게이트웨이)
--    게이트웨이는 service_role 로 접속하므로 RLS를 우회한다.
--    anon/authenticated 직결 접근은 전면 차단(정책 없음 = 거부).
-- ---------------------------------------------------------------------
alter table public.schools      enable row level security;
alter table public.school_units enable row level security;
alter table public.roles        enable row level security;
alter table public.teachers     enable row level security;

-- 하위도메인 진입 화면이 학교 존재 여부만 확인할 수 있도록 최소 공개 (이름/도메인/학교급)
drop policy if exists "public school lookup" on public.schools;
create policy "public school lookup" on public.schools
  for select to anon, authenticated using (status = 'active');

-- ---------------------------------------------------------------------
-- 7. 신규 학교 부트스트랩 함수
--    관리자가 학교 1개 + 기본 학년/반 + 역할 세트 + 첫 관리자 교사를 생성.
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_school(
  p_domain        text,
  p_name          text,
  p_education_type text,
  p_admin_email   text,
  p_admin_name    text,
  p_levels        int default 3,      -- 학년 수
  p_classes       int default 6,      -- 학년당 반 수
  p_academic_year int default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_school uuid;
  v_year   int := coalesce(p_academic_year, extract(year from now())::int);
  lv int; cl int;
  v_unit uuid;
begin
  insert into public.schools (domain_name, name, education_type, academic_year)
  values (lower(p_domain), p_name, p_education_type, v_year)
  returning id into v_school;

  -- 학년/반 격자
  for lv in 1..p_levels loop
    for cl in 1..p_classes loop
      insert into public.school_units (school_id, level_label, level_order, class_label, class_order)
      values (v_school, lv || '학년', lv, cl || '반', cl);
    end loop;
  end loop;

  -- 기본 역할 세트 (교육유형 무관 공통 6종 — 라벨은 콘솔에서 수정 가능)
  insert into public.roles (school_id, key, label, permissions, landing_page, is_system, sort_order) values
    (v_school, 'admin',     '관리자',      '{"scope":"all","admin":{"school":true,"units":true,"roles":true,"survey_schema":true,"teachers":true},"students":{"read":["basic","contact","sensitive"],"write":["contact"]},"survey":{"read":"all"},"records":{"read":"all","write":"all"}}'::jsonb, 'home', true, 10),
    (v_school, 'homeroom',  '담임',        '{"scope":"own_class","students":{"read":["basic","contact","sensitive"],"write":["contact"]},"survey":{"read":"own_class"},"records":{"read":"own_class","write":"own_class"}}'::jsonb, 'my_class', false, 20),
    (v_school, 'subject',   '교과교사',    '{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"all"}}'::jsonb, 'home', false, 30),
    (v_school, 'counselor', '상담교사',    '{"scope":"all","students":{"read":["basic","contact"]},"survey":{"read":"all"},"records":{"read":"all","write":"all"}}'::jsonb, 'home', false, 40),
    (v_school, 'nurse',     '보건교사',    '{"scope":"all","students":{"read":["basic"]},"survey":{"read":"all","fields":["알레르기","건강특이사항","혈액형"]},"records":{"read":"none","write":"none"}}'::jsonb, 'home', false, 50),
    (v_school, 'gatekeeper','배움터지킴이','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"own_class","types":["attendance"]}}'::jsonb, 'attendance', false, 60);

  -- 첫 관리자 교사
  insert into public.teachers (school_id, email, name, role_key, active)
  values (v_school, lower(p_admin_email), p_admin_name, 'admin', true);

  return v_school;
end $$;

comment on function public.bootstrap_school is
  '신규 학교 온보딩: 학교 + 학년/반 격자 + 기본 역할 6종 + 첫 관리자 교사 생성. 반환값 = school_id';
