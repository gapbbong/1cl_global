-- =====================================================================
-- 0003_student_data.sql  —  학생 / 생활기록 / 기초조사 + school_id
--
-- 0001(schools/school_units/roles/teachers) 위에 얹는다.
-- 모든 테넌트 테이블에 school_id (게이트웨이가 강제 주입/필터).
-- RLS: 정책 없음 = anon/authenticated 직결 접근 전면 차단.
--      실제 접근은 Netlify 게이트웨이(service_role)만.
-- =====================================================================

-- ---------------------------------------------------------------------
-- students  (학생 마스터 — 영구 PID)
-- ---------------------------------------------------------------------
create table if not exists public.students (
  pid            uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  student_id     text not null,                 -- 학번 (연도별 가변)
  name           text not null,
  birth_date     date,
  gender         text,
  contact        text,
  parent_contact text,
  parent_relation text,
  address        text,
  instagram_id   text,
  middle_school  text,
  photo_url      text,                          -- student_photos 버킷 경로
  academic_year  int  not null,
  class_info     text not null,                 -- "1-1" (school_units 좌표)
  status         text not null default 'active',-- active|graduated|transferred|withdrawn|expelled
  answers        jsonb not null default '{}'::jsonb,  -- 기초조사 통합 응답
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (school_id, academic_year, student_id)
);
create index if not exists idx_students_class on public.students(school_id, academic_year, class_info);
create index if not exists idx_students_sid   on public.students(school_id, student_id);

-- ---------------------------------------------------------------------
-- life_records  (생활기록)
-- ---------------------------------------------------------------------
create table if not exists public.life_records (
  id                   bigint generated always as identity primary key,
  school_id            uuid not null references public.schools(id) on delete cascade,
  student_pid          uuid not null references public.students(pid) on delete cascade,
  teacher_id           uuid references public.teachers(id) on delete set null,
  teacher_email_prefix text,                    -- 기록자 식별 (email local-part)
  category             text not null,           -- 칭찬/지도/근태/상담 ...
  content              text not null default '',
  is_positive          boolean not null default true,
  photos               text[],                  -- 증빙(반성문 등) URL 배열
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_lr_school  on public.life_records(school_id);
create index if not exists idx_lr_student on public.life_records(student_pid);
create index if not exists idx_lr_cat     on public.life_records(school_id, category);

-- ---------------------------------------------------------------------
-- surveys  (기초조사 원본)
-- ---------------------------------------------------------------------
create table if not exists public.surveys (
  id           bigint generated always as identity primary key,
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_pid  uuid not null references public.students(pid) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);
create index if not exists idx_surveys_student on public.surveys(student_pid);

-- ---------------------------------------------------------------------
-- record_comments  (기록 리액션/댓글)
-- ---------------------------------------------------------------------
create table if not exists public.record_comments (
  id                   bigint generated always as identity primary key,
  school_id            uuid not null references public.schools(id) on delete cascade,
  record_id            bigint not null references public.life_records(id) on delete cascade,
  teacher_email_prefix text,
  type                 text not null default 'comment',  -- reaction|comment
  content              text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_rc_record on public.record_comments(record_id);

-- ---------------------------------------------------------------------
-- custom_menus  (교사 개인 학생 그룹)
-- ---------------------------------------------------------------------
create table if not exists public.custom_menus (
  id            bigint generated always as identity primary key,
  school_id     uuid not null references public.schools(id) on delete cascade,
  teacher_email text not null,
  name          text not null,
  student_pids  uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cm_teacher on public.custom_menus(school_id, teacher_email);

-- ---------------------------------------------------------------------
-- student_insights  (AI 통합 인사이트)
-- ---------------------------------------------------------------------
create table if not exists public.student_insights (
  id           bigint generated always as identity primary key,
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_pid  uuid not null references public.students(pid) on delete cascade,
  insight_type text not null,
  content      jsonb not null,
  analyzed_at  timestamptz not null default now()
);
create index if not exists idx_si_student on public.student_insights(student_pid);

-- ---------------------------------------------------------------------
-- schedules  (학사/창체 일정 — 캘린더)
-- ---------------------------------------------------------------------
create table if not exists public.schedules (
  id         bigint generated always as identity primary key,
  school_id  uuid not null references public.schools(id) on delete cascade,
  date       date not null,
  title      text not null,
  type       text not null,           -- academic|creative|monthly|planning
  type_name  text,
  dept       text,
  color      text,
  font_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, date, title, type)
);
create index if not exists idx_sched_date on public.schedules(school_id, date);

-- ---------------------------------------------------------------------
-- quiz_scores  (인물 퀴즈 점수)
-- ---------------------------------------------------------------------
create table if not exists public.quiz_scores (
  id             bigint generated always as identity primary key,
  school_id      uuid not null references public.schools(id) on delete cascade,
  teacher_email  text not null,
  score          int  not null default 0,
  correct_count  int  default 0,
  total_count    int  default 0,
  academic_year  text,
  last_played_at timestamptz not null default now(),
  unique (school_id, teacher_email)
);

-- ---------------------------------------------------------------------
-- preset_categories  (생활기록 선택 항목) + school_id
-- ---------------------------------------------------------------------
create table if not exists public.preset_categories (
  id            bigint generated always as identity primary key,
  school_id     uuid not null references public.schools(id) on delete cascade,
  type          text not null,            -- good|bad
  item_name     text not null,
  display_order int,
  created_at    timestamptz not null default now(),
  unique (school_id, type, item_name)
);

-- ---------------------------------------------------------------------
-- user_logs / access_logs  (분석·감사 — school_id nullable: 게이트웨이 audit 호환)
-- ---------------------------------------------------------------------
create table if not exists public.user_logs (
  id            bigint generated always as identity primary key,
  school_id     uuid references public.schools(id) on delete cascade,
  teacher_email text,
  page_path     text,
  action        text default 'page_view',
  created_at    timestamptz not null default now()
);
create index if not exists idx_ul_email on public.user_logs(teacher_email);

create table if not exists public.access_logs (
  id          bigint generated always as identity primary key,
  school_id   uuid references public.schools(id) on delete cascade,
  teacher_email text,
  student_pid uuid,
  action_type text not null,
  accessed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 이력 테이블 (읽기 전용, 아카이브용 — 최소 스키마)
-- ---------------------------------------------------------------------
create table if not exists public.student_history (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_pid uuid, academic_year int, class_info text, name text, student_id text,
  snapshot_at timestamptz not null default now()
);
create table if not exists public.teacher_history (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_email text, academic_year int, role_key text, homeroom text,
  snapshot_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- class_record_counts  (대시보드 집계 뷰)
-- ---------------------------------------------------------------------
create or replace view public.class_record_counts as
  select l.school_id,
         s.academic_year,
         s.class_info,
         count(*)::int as cnt
  from public.life_records l
  join public.students s on s.pid = l.student_pid
  where coalesce(l.category, '') <> '상담'
  group by l.school_id, s.academic_year, s.class_info;

-- ---------------------------------------------------------------------
-- updated_at 트리거
-- ---------------------------------------------------------------------
drop trigger if exists trg_students_touch on public.students;
create trigger trg_students_touch before update on public.students
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_life_records_touch on public.life_records;
create trigger trg_life_records_touch before update on public.life_records
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS (정책 없음 = 직결 접근 거부; 게이트웨이 service_role 만 통과)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'students','life_records','surveys','record_comments','custom_menus',
    'student_insights','schedules','quiz_scores','preset_categories',
    'user_logs','access_logs','student_history','teacher_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 기본 생활기록 프리셋 시드 (학교 생성 시 자동으로 넣도록 bootstrap 확장)
-- ---------------------------------------------------------------------
create or replace function public.seed_default_presets(p_school uuid)
returns void language plpgsql as $$
begin
  insert into public.preset_categories (school_id, type, item_name, display_order)
  select p_school, 'good', v.name, v.ord from (values
    ('기본생활 우수',1),('자기주도학습',2),('예의바름',3),('수업태도 우수',4),('솔선수범',5),('교우관계 원만',6)
  ) as v(name, ord)
  on conflict (school_id, type, item_name) do nothing;
  insert into public.preset_categories (school_id, type, item_name, display_order)
  select p_school, 'bad', v.name, v.ord from (values
    ('지각',1),('복장 불량',2),('수업태도 불량',3),('휴대폰 무단사용',4),('무단외출',5),('language 부적절',6)
  ) as v(name, ord)
  on conflict (school_id, type, item_name) do nothing;
end $$;

-- 이미 만들어진 학교들에도 프리셋 채우기
do $$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.seed_default_presets(s.id);
  end loop;
end $$;

-- 앞으로 bootstrap_school 이 프리셋도 함께 생성
create or replace function public.bootstrap_school(
  p_domain text, p_name text, p_education_type text,
  p_admin_email text, p_admin_name text,
  p_levels int default 3, p_classes int default 6, p_academic_year int default null
) returns uuid
language plpgsql security definer
as $$
declare
  v_school uuid;
  v_year   int := coalesce(p_academic_year, extract(year from now())::int);
  lv int; cl int;
begin
  insert into public.schools (domain_name, name, education_type, academic_year)
  values (lower(p_domain), p_name, p_education_type, v_year)
  returning id into v_school;

  for lv in 1..p_levels loop
    for cl in 1..p_classes loop
      insert into public.school_units (school_id, level_label, level_order, class_label, class_order)
      values (v_school, lv || '학년', lv, cl || '반', cl);
    end loop;
  end loop;

  insert into public.roles (school_id, key, label, permissions, landing_page, is_system, sort_order) values
    (v_school, 'admin',     '관리자',      '{"scope":"all","admin":{"school":true,"units":true,"roles":true,"survey_schema":true,"teachers":true},"students":{"read":["basic","contact","sensitive"],"write":["contact"]},"survey":{"read":"all"},"records":{"read":"all","write":"all"}}'::jsonb, 'home', true, 10),
    (v_school, 'homeroom',  '담임',        '{"scope":"own_class","students":{"read":["basic","contact","sensitive"],"write":["contact"]},"survey":{"read":"own_class"},"records":{"read":"own_class","write":"own_class"}}'::jsonb, 'my_class', false, 20),
    (v_school, 'subject',   '교과교사',    '{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"all"}}'::jsonb, 'home', false, 30),
    (v_school, 'counselor', '상담교사',    '{"scope":"all","students":{"read":["basic","contact"]},"survey":{"read":"all"},"records":{"read":"all","write":"all"}}'::jsonb, 'home', false, 40),
    (v_school, 'nurse',     '보건교사',    '{"scope":"all","students":{"read":["basic"]},"survey":{"read":"all","fields":["알레르기","건강특이사항","혈액형"]},"records":{"read":"none","write":"none"}}'::jsonb, 'home', false, 50),
    (v_school, 'gatekeeper','배움터지킴이','{"scope":"all","students":{"read":["basic"]},"survey":{"read":"none"},"records":{"read":"all","write":"own_class","types":["attendance"]}}'::jsonb, 'attendance', false, 60);

  insert into public.teachers (school_id, email, name, role_key, active)
  values (v_school, lower(p_admin_email), p_admin_name, 'admin', true);

  perform public.seed_default_presets(v_school);
  return v_school;
end $$;
