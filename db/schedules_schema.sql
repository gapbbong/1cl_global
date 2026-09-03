-- 1. 일정 테이블 생성
CREATE TABLE IF NOT EXISTS public.schedules (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL, -- 'academic', 'creative', 'monthly', 'planning'
    type_name TEXT NOT NULL, -- '학사', '창체', '월중', '기획'
    dept TEXT, -- 기획 회의 부서명
    color TEXT, -- 배경색 (Hex)
    font_color TEXT, -- 글자색 (Hex)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(date, title, type) -- 중복 방지 (날짜, 제목, 타입 조합)
);

-- 2. RLS 활성화 및 조회 정책 설정
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- 누구나 일정 조회 가능 (학교 홈페이지 특성)
DROP POLICY IF EXISTS "Anyone can view schedules" ON public.schedules;
CREATE POLICY "Anyone can view schedules" ON public.schedules FOR SELECT USING (true);

-- 관리자(admin)만 일정 수정 가능 (GAS에서 Service Key 사용 시 무시될 수 있으나 보안상 추가)
DROP POLICY IF EXISTS "Admins can manage schedules" ON public.schedules;
CREATE POLICY "Admins can manage schedules" ON public.schedules 
    FOR ALL USING (
        (SELECT role FROM public.teachers WHERE id = auth.uid()) = 'admin'
    );
