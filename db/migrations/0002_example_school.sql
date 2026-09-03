-- =====================================================================
-- 0002_example_school.sql  —  온보딩 예시 (신규 학교 1곳 생성)
--
-- 실제 운영에서는 이 파일을 그대로 적용하지 말고, 값만 바꿔 실행하거나
-- 관리자 콘솔의 온보딩 절차를 사용한다.
-- =====================================================================

-- 예시: "데모고등학교" 를 domain "demo" 로 생성.
--   학년 3개 × 반 4개, 첫 관리자 = 본인 이메일.
select public.bootstrap_school(
  p_domain         => 'demo',
  p_name           => '데모고등학교',
  p_education_type => 'high',
  p_admin_email    => 'admin@demo.hs.kr',
  p_admin_name     => '데모 관리자',
  p_levels         => 3,
  p_classes        => 4
);

-- 확인
-- select * from public.schools;
-- select level_label, class_label, major from public.school_units order by level_order, class_order;
-- select key, label, landing_page from public.roles order by sort_order;
-- select email, name, role_key from public.teachers;
