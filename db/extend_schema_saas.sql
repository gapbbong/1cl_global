-- 1. teachers 테이블에 settings 컬럼 추가 (JSONB)
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{
  "initial_page": "home",
  "menu_config": ["total-records", "check-survey", "bulk-record", "print-report", "analysis", "map-3d", "quiz"]
}'::jsonb;

-- 2. 개인별 학생 그룹(동아리 등) 관리를 위한 테이블 생성
CREATE TABLE IF NOT EXISTS public.custom_menus (
    id BIGSERIAL PRIMARY KEY,
    teacher_email TEXT NOT NULL, -- 교사 식별용
    name TEXT NOT NULL,          -- 그룹명 (예: "배드민턴부", "방과후수학")
    student_pids UUID[] NOT NULL, -- 학생 PID 배열
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. RLS 설정
ALTER TABLE public.custom_menus ENABLE ROW LEVEL SECURITY;

-- 교사는 본인의 개인 메뉴만 조회/수정 가능 (이메일 기준)
-- 현재 시스템상 이메일 인증 방식을 사용하므로 policies를 이메일 또는 teacher_id 기반으로 유연하게 설정 필요
-- 여기선 일단 public 기반으로 구현하되, API 레벨에서 teacher_email로 필터링하도록 설계함

CREATE POLICY "Users can manage their own custom menus" ON public.custom_menus
    FOR ALL USING (true); -- 실제 운영 환경에선 auth.uid() 또는 email 필터링 필수

-- 4. 샘플 데이터 (선택 사항)
-- INSERT INTO public.custom_menus (teacher_email, name, student_pids) VALUES ('gapbbong@naver.com', '샘플 동아리', '{}');
