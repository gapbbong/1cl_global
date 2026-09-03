-- 1. 전공/역할 정의 (Enums)
CREATE TYPE user_role AS ENUM ('admin', 'homeroom_teacher', 'nurse', 'counselor', 'subject_teacher', 'gatekeeper');

-- 2. 학생 마스터 테이블 (Student Master with Permanent ID)
CREATE TABLE public.students (
    pid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id TEXT NOT NULL, -- 학번 (연도별로 가변적)
    name TEXT NOT NULL,
    birth_date DATE,
    gender TEXT,
    contact TEXT,
    parent_contact TEXT,
    address TEXT,
    instagram_id TEXT,
    photo_url TEXT,
    academic_year INTEGER NOT NULL, -- 해당 학년도
    class_info TEXT NOT NULL, -- 학년/반 (예: 1-1)
    status TEXT DEFAULT 'active', -- 상태 (active, graduated, transferred)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 교사 테이블 (Teachers & Roles)
CREATE TABLE public.teachers (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role user_role DEFAULT 'subject_teacher',
    assigned_class TEXT, -- 담당 학급 (예: 1-1)
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 생활기록 테이블 (Life Records with Auto-logging)
CREATE TABLE public.life_records (
    id BIGSERIAL PRIMARY KEY,
    student_pid UUID REFERENCES public.students(pid) ON DELETE CASCADE,
    teacher_id UUID REFERENCES public.teachers(id),
    teacher_email_prefix TEXT, -- 기록 교사 식별용 (email 앞부분)
    category TEXT NOT NULL, -- (예: 지도, 칭찬, 상담 등)
    content TEXT NOT NULL,
    is_positive BOOLEAN DEFAULT true, -- 긍정/부정 여부 (성장 그래프용)
    photos TEXT[], -- 첨부 사진 URL 배열 (반성문 등)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 기초조사 테이블 (Basic Survey Data)
CREATE TABLE public.surveys (
    id BIGSERIAL PRIMARY KEY,
    student_pid UUID REFERENCES public.students(pid) ON DELETE CASCADE,
    data JSONB NOT NULL, -- 전체 설문 응답 데이터
    submitted_at TIMESTAMPTZ DEFAULT now()
);

-- 6. 행적 로그 테이블 (Security Audit Logs)
CREATE TABLE public.access_logs (
    id BIGSERIAL PRIMARY KEY,
    teacher_id UUID REFERENCES public.teachers(id),
    student_pid UUID REFERENCES public.students(pid),
    action_type TEXT NOT NULL, -- (view, create, update, download)
    accessed_at TIMESTAMPTZ DEFAULT now()
);

-- 7. 생활기록 선택 항목 (Presets) 테이블
CREATE TABLE IF NOT EXISTS public.preset_categories (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL, -- 'good' (잘한 일) 또는 'bad' (못한 일)
    item_name TEXT NOT NULL, -- 항목명 (예: "지각", "솔선수범")
    display_order INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(type, item_name)
);

-- 8. Row Level Security (RLS) 설정
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.life_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preset_categories ENABLE ROW LEVEL SECURITY;

-- [정책 0] 공통 항목(Presets) 조회 정책 (누구나 가능)
CREATE POLICY "Anyone can view presets" ON public.preset_categories FOR SELECT USING (true);

-- [정책 1] 학생 정보 조회 정책 (모든 교사는 기본 정보 열람 가능, 상세는 권한별 상이)
CREATE POLICY "Student access policy" ON public.students
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'admin' OR 
        class_info = (SELECT assigned_class FROM public.teachers WHERE id = auth.uid()) OR
        EXISTS (SELECT 1 FROM public.teachers WHERE id = auth.uid() AND role IN ('gatekeeper', 'nurse', 'counselor'))
    );

-- [정책 2] 생활기록 조회/작성 정책
CREATE POLICY "Record access policy" ON public.life_records
    FOR ALL USING (
        -- 1. 관리자 및 상담교사는 모든 기록 접근
        (SELECT role FROM public.teachers WHERE id = auth.uid()) IN ('admin', 'counselor') OR 
        -- 2. 본인이 작성한 기록
        teacher_id = auth.uid() OR
        -- 3. 담임 학급 학생의 기록
        student_pid IN (SELECT pid FROM public.students WHERE class_info = (SELECT assigned_class FROM public.teachers WHERE id = auth.uid())) OR
        -- 4. 지킴이 선생님은 '지각', '외출', '복장', '태도' 등 출결/생활지도 카테고리만 접근
        (
            (SELECT role FROM public.teachers WHERE id = auth.uid()) = 'gatekeeper' AND
            category IN ('지각', '외출', '결석', '복장', '태도', '생활지도')
        )
    );

-- [정책 3] 설문 데이터 조회 정책 (보건교사 필터링은 보안 뷰/함수 권장, 여기서는 기본 담임/관리자 위주)
CREATE POLICY "Survey access policy" ON public.surveys
    FOR SELECT USING (
        (SELECT role FROM public.teachers WHERE id = auth.uid()) IN ('admin', 'counselor') OR 
        student_pid IN (SELECT pid FROM public.students WHERE class_info = (SELECT assigned_class FROM public.teachers WHERE id = auth.uid()))
    );

-- [정책 4] 보건교사용 알레르기 정보 반환을 위한 보안 함수 (필드 제한)
CREATE OR REPLACE FUNCTION get_allergy_info()
RETURNS TABLE (student_name TEXT, class_info TEXT, allergy TEXT, health_note TEXT, blood_type TEXT) 
SECURITY DEFINER
AS $$
BEGIN
  IF (SELECT role FROM public.teachers WHERE id = auth.uid()) IN ('admin', 'counselor', 'nurse') THEN
    RETURN QUERY 
    SELECT s.name, s.class_info, 
           (sur.data->>'알레르기')::TEXT, 
           (sur.data->>'건강특이사항')::TEXT,
           (sur.data->>'혈액형')::TEXT
    FROM public.students s
    JOIN public.surveys sur ON s.pid = sur.student_pid;
  ELSE
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 8. Auth 가입 시 자동 Teacher 프로필 생성 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.teachers (id, email, name, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'name', '선생님'), 'subject_teacher');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 9. Storage RLS 설정 및 정책
-- (Storage Bucket 'student-photos', 'evidence-photos' 가 생성되었음을 가정)
-- 모든 인증된 교사는 사진 조회 가능, 업로드는 본인 역할에 따라 제한
CREATE POLICY "Authenticated users can preview photos"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id IN ('student-photos', 'evidence-photos') );

CREATE POLICY "Teachers can upload student photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id IN ('student-photos', 'evidence-photos') );

-- 10. AI 학생 통합 인사이트 테이블
CREATE TABLE public.student_insights (
    id BIGSERIAL PRIMARY KEY,
    student_pid UUID REFERENCES public.students(pid) ON DELETE CASCADE,
    insight_type TEXT NOT NULL, -- 'total', 'summary', etc.
    content JSONB NOT NULL,     -- 통합 분석 결과 전문
    analyzed_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 설정 및 정책 (분석 리포트 조회/생성)
ALTER TABLE public.student_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Insight select policy" ON public.student_insights
    FOR SELECT USING (
        (SELECT role FROM public.teachers WHERE id = auth.uid()) IN ('admin', 'counselor', 'homeroom_teacher', 'subject_teacher', 'nurse')
    );

CREATE POLICY "Insight insert policy" ON public.student_insights
    FOR INSERT WITH CHECK (
        (SELECT role FROM public.teachers WHERE id = auth.uid()) IN ('admin', 'counselor', 'homeroom_teacher', 'subject_teacher')
    );
