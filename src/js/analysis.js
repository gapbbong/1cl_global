import { supabase, supabaseRealtime, getSessionToken } from './supabase.js';
import { API_CONFIG } from './config.js';
import { extractDriveId, getThumbnailUrl } from './utils.js';

let currentStudent = null;
let currentInsight = {}; // 부분적 업데이트를 위해 객체로 관리
let currentMode = 'individual'; // 'individual' or 'class'
let currentClassInfo = null;
let analysisChart = null;

document.addEventListener("DOMContentLoaded", () => {
    initModeToggle();
    initSearch();
    initClassSelect();
    initTeacherAuth(); // 교사 권한 초기화 추가
    initOwnerBatch(); // 소유자 전용 배치 분석 초기화

    // 활동 로그 기록
    (async () => {
        const { getCurrentTeacherEmail, logPageView } = await import('./api.js');
        const myEmail = getCurrentTeacherEmail();
        if (myEmail) {
            logPageView(myEmail, "AI 통합 분석");
        }
    })();

    // Check URL parameters for direct student search
    const urlParams = new URLSearchParams(window.location.search);
    const sid = urlParams.get("sid");
    if (sid) {
        document.getElementById("search-id").value = sid;
        setTimeout(() => document.getElementById("search-apply-btn").click(), 100);
    }
});

let currentTeacher = null; // 현재 접속한 교사 정보

// 교사 권한 정보 초기화
async function initTeacherAuth() {
    try {
        const encryptedToken = localStorage.getItem('teacher_auth_token');
        if (!encryptedToken) return;

        const bytes = CryptoJS.AES.decrypt(encryptedToken, API_CONFIG.SECRET_KEY);
        const teacherEmail = bytes.toString(CryptoJS.enc.Utf8);

        if (teacherEmail) {
            console.log("Teacher auth token found.");
            const { data, error } = await supabase
                .from('teachers')
                .select('name, email, role, assigned_class, sub_grade, sub_class')
                .eq('email', teacherEmail.trim().toLowerCase())
                .maybeSingle();

            if (!error && data) {
                currentTeacher = data;
                console.log("Teacher Auth Initialized (Role):", currentTeacher.role);
            } else {
                console.warn("Teacher record not found for the given token.");
            }
        }
    } catch (e) {
        console.error("Teacher Auth Initialization Failed:", e);
    }
}

// 분석 권한 체크 (전체 권한 여부 반환)
function hasFullAnalysisAccess(student) {
    if (!currentTeacher) return false;

    // [M2] 관리자 권한(role/permissions) 기반
    if (currentTeacher.role === 'admin' || Object.values(currentTeacher.permissions?.admin || {}).some(Boolean)) return true;

    // 2. 상담 교사 (counselor)
    if (currentTeacher.role === 'counselor') return true;

    // 3. 해당 학급 담임교사
    if (currentTeacher.assigned_class && currentTeacher.assigned_class === student.class_info) return true;

    // 4. 해당 학급 부담임교사
    if (currentTeacher.sub_grade && currentTeacher.sub_class) {
        const subClassInfo = `${currentTeacher.sub_grade}-${currentTeacher.sub_class}`;
        if (subClassInfo === student.class_info) return true;
    }

    return false;
}

// 0. 모드 전환
function initModeToggle() {
    const radios = document.querySelectorAll('input[name="analysis-mode"]');
    const indContainer = document.getElementById("individual-search-container");
    const clsContainer = document.getElementById("class-select-container");
    const welcomeText = document.querySelector("#welcome-view h2");

    radios.forEach(r => {
        r.addEventListener("change", (e) => {
            currentMode = e.target.value;
            if (currentMode === 'individual') {
                indContainer.style.display = "flex";
                clsContainer.style.display = "none";
                welcomeText.innerText = "학생을 선택하여 분석을 시작하세요";
            } else {
                indContainer.style.display = "none";
                clsContainer.style.display = "flex";
                welcomeText.innerText = "분석할 학급을 선택하여 분석을 시작하세요";
            }
            // 뷰 초기화
            document.getElementById("welcome-view").style.display = "block";
            document.getElementById("result-view").style.display = "none";
            currentInsight = {};
        });
    });
}

// 0-1. 학급 목록 로드
async function initClassSelect() {
    const dropdown = document.getElementById("class-dropdown");
    const analyzeBtn = document.getElementById("class-analyze-btn");

    try {
        const { data, error } = await supabase
            .from('students')
            .select('class_info')
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
            .neq('class_info', null);

        if (!error && data) {
            const uniqueClasses = [...new Set(data.map(item => item.class_info))].sort();
            uniqueClasses.forEach(cls => {
                const opt = document.createElement("option");
                opt.value = cls;
                opt.textContent = cls + " 학급";
                dropdown.appendChild(opt);
            });
        }

        dropdown.addEventListener("change", (e) => {
            analyzeBtn.disabled = !e.target.value;
        });

        analyzeBtn.addEventListener("click", () => {
            if (dropdown.value) loadClassAnalysis(dropdown.value);
        });
    } catch (e) {
        console.error("클래스 목록 로드 오류", e);
    }
}

// 1. 학생 검색 기능 (학번/이름 통합 및 연동)
function initSearch() {
    const primaryInput = document.getElementById("search-id"); // 앞쪽: 학번 또는 이름
    const secondaryInput = document.getElementById("search-name"); // 뒷쪽: 연동 정보 (학번 -> 이름, 이름 -> 학번)
    const applyBtn = document.getElementById("search-apply-btn");
    const recordBtn = document.getElementById("search-record-btn");
    const resultsDropdown = document.getElementById("search-results");

    let isInternalUpdate = false;

    // 앞쪽 입력칸 이벤트 (통합 검색)
    primaryInput.addEventListener("input", async (e) => {
        if (isInternalUpdate) return;
        const query = e.target.value.trim();

        if (query.length === 0) {
            secondaryInput.value = "";
            resultsDropdown.style.display = "none";
            window._lastSelectedStudent = null;
            return;
        }

        // 1. 학번 입력 감지 (숫자 4자리)
        if (/^\d{4}$/.test(query)) {
            try {
                const { data } = await supabase
                    .from('students')
                    .select('pid, name, student_id')
                    .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
                    .eq('student_id', query)
                    .maybeSingle();

                if (data) {
                    secondaryInput.value = data.name;
                    resultsDropdown.style.display = "none";
                    if (recordBtn) recordBtn.style.display = "block";
                    // 현재 선택된 학생 정보 임시 저장
                    window._lastSelectedStudent = data;
                } else {
                    secondaryInput.value = "기록 없음";
                    if (recordBtn) recordBtn.style.display = "none";
                }
            } catch (err) {
                console.error("ID lookup failed:", err);
            }
            return;
        }

        // 2. 이름 입력 감지 (2글자 이상)
        if (query.length >= 2 && !/^\d+$/.test(query)) {
            const { data } = await supabase
                .from('students')
                .select('pid, student_id, name, class_info, gender, photo_url')
                .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR)
                .ilike('name', `%${query}%`)
                .limit(10);

            if (data && data.length > 0) {
                renderSearchResults(data, query);

                // 정확히 일치하는 이름이 1명뿐일 때 뒷칸에 학번 채우기
                const exactMatches = data.filter(s => s.name === query);
                if (exactMatches.length === 1) {
                    secondaryInput.value = exactMatches[0].student_id;
                    secondaryInput.style.backgroundColor = "#f1f5f9";
                    if (recordBtn) recordBtn.style.display = "block";
                    window._lastSelectedStudent = exactMatches[0];
                } else if (exactMatches.length > 1) {
                    secondaryInput.value = "동명이인 선택 필요";
                    secondaryInput.style.backgroundColor = "#fff5f5";
                    if (recordBtn) recordBtn.style.display = "none";
                } else {
                    secondaryInput.value = "검색 중...";
                    if (recordBtn) recordBtn.style.display = "none";
                }
            } else {
                resultsDropdown.style.display = "none";
                secondaryInput.value = "결과 없음";
                if (recordBtn) recordBtn.style.display = "none";
            }
        } else {
            resultsDropdown.style.display = "none";
            if (recordBtn) recordBtn.style.display = "none";
        }
    });

    // 조회 버튼 클릭 및 엔터키 처리
    const handleLookup = async () => {
        const primaryVal = primaryInput.value.trim();
        const secondaryVal = secondaryInput.value.trim();

        if (!primaryVal) return alert("학번 또는 이름을 입력해주세요.");

        // 이미 연동된 정보가 있다면 해당 pid로 로드 시도
        // (정확한 연동을 위해 DB 재확인)
        let queryBuilder = supabase.from('students')
            .select('*') // pid 외 다른 정보도 필요할 수 있음
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR);

        if (/^\d{4}$/.test(primaryVal)) {
            queryBuilder = queryBuilder.eq('student_id', primaryVal);
        } else {
            queryBuilder = queryBuilder.eq('name', primaryVal);
            if (/^\d{4}$/.test(secondaryVal)) {
                queryBuilder = queryBuilder.eq('student_id', secondaryVal);
            }
        }

        const { data } = await queryBuilder.limit(2);

        if (!data || data.length === 0) {
            alert("학생을 찾을 수 없습니다. 입력을 확인해주세요.");
            return;
        }

        if (data.length === 1) {
            window._lastSelectedStudent = data[0];
            loadStudentAnalysis(data[0].pid);
            resultsDropdown.style.display = "none";
            if (recordBtn) recordBtn.style.display = "block";
        } else {
            // 동명이인 등의 경우 드롭다운에서 선택 유도
            alert("동명이인이 있습니다. 아래 목록에서 매칭되는 학생을 선택해주세요.");
            primaryInput.dispatchEvent(new Event('input')); // 드롭다운 다시 띄우기
        }
    };

    applyBtn.addEventListener("click", handleLookup);
    if (recordBtn) {
        recordBtn.addEventListener("click", () => {
            if (window._lastSelectedStudent) {
                window.goToRecord(window._lastSelectedStudent);
            } else {
                alert("학생을 먼저 선택하거나 조회해주세요.");
            }
        });
    }

    primaryInput.addEventListener("keydown", (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLookup();
        }
    });

    // 뒷쪽 입력칸(출력용) 클릭 시 앞쪽으로 포커스 유도
    secondaryInput.addEventListener("click", () => primaryInput.focus());
}

function renderSearchResults(students, queryName = "") {
    const resultsDropdown = document.getElementById("search-results");
    const primaryInput = document.getElementById("search-id");
    const secondaryInput = document.getElementById("search-name");

    // 정확히 이름이 일치하는 동명이인 체크
    const exactMatches = students.filter(s => s.name === queryName);
    const isDuplicateName = exactMatches.length > 1;

    let html = "";
    if (isDuplicateName) {
        html += `
            <div style="padding:12px 16px; background:#fff5f5; color:#e53e3e; font-size:0.9rem; font-weight:bold; border-bottom:1px solid #fed7d7; display:flex; align-items:center; gap:8px;">
                <span>⚠️ 동명이인이 있습니다. 학생을 선택해주세요.</span>
            </div>
        `;
    }

    // 그리드 컨테이너 시작
    html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px;">`;

    html += students.map(s => {
        let photoUrl = "";
        const driveId = extractDriveId(s.photo_url || "");
        if (driveId) {
            photoUrl = getThumbnailUrl(driveId);
        } else if (s.photo_url && s.photo_url.startsWith('http')) {
            photoUrl = s.photo_url;
        }

        // 사진 크기 대폭 확대 (기존 56px -> 96px)
        let photoHtml = photoUrl
            ? `<div style="width:96px; height:96px; border-radius:16px; background:#f8fafc; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; border:1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);"><img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='👤'"></div>`
            : `<div style="width:96px; height:96px; border-radius:16px; background:#f8fafc; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; border:1px solid #e2e8f0; font-size: 2.5rem; color: #cbd5e1;">👤</div>`;

        return `
            <div class="search-item" data-pid="${s.pid}" data-sid="${s.student_id}" data-name="${s.name}" 
                style="display:flex; align-items:center; gap:20px; padding:20px; border:1px solid #edf2f7; border-radius:20px; cursor:pointer; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); background: white; min-height: 130px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                ${photoHtml}
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight:800; color:#1a202c; font-size:1.2rem; margin-bottom:6px; letter-spacing: -0.02em;">${s.name}</div>
                    <div style="color:#4a5568; font-size:1rem; font-weight: 500; margin-bottom:4px;">학번: ${s.student_id}</div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="display: inline-block; padding: 4px 10px; background: #edf2f7; border-radius: 8px; color: #718096; font-size:0.9rem; font-weight: 600;">${s.class_info}</div>
                        <button class="record-quick-btn" data-pid="${s.pid}" data-sid="${s.student_id}" data-name="${s.name}" 
                            style="padding: 4px 10px; background: #f0fdf4; border: 1px solid #bcf0da; color: #166534; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer;">📝 기록</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    html += `</div>`; // 그리드 컨테이너 종료

    resultsDropdown.innerHTML = html;

    // 드롭다운 너비 및 스타일 조정
    resultsDropdown.style.width = "100%";
    resultsDropdown.style.maxWidth = "600px";
    resultsDropdown.style.display = "block";

    resultsDropdown.querySelectorAll(".search-item").forEach(item => {
        item.addEventListener("mouseenter", () => {
            item.style.borderColor = "#4A90E2";
            item.style.backgroundColor = "#f0f7ff";
            item.style.transform = "translateY(-1px)";
            item.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1)";
        });
        item.addEventListener("mouseleave", () => {
            item.style.borderColor = "#edf2f7";
            item.style.backgroundColor = "white";
            item.style.transform = "translateY(0)";
            item.style.boxShadow = "none";
        });
        item.addEventListener("click", () => {
            const pid = item.getAttribute("data-pid");
            const sid = item.getAttribute("data-sid");
            const name = item.getAttribute("data-name");

            // 앞쪽(Source)에 이름, 뒷쪽(Target)에 학번을 채워줌 (또는 그 반대로 해도 되지만 일관성을 위함)
            // 사용자가 이름을 쳤다면 [이름] [학번]이 되고, 학번을 쳤다면 [학번] [이름]이 되는 식
            const currentVal = primaryInput.value.trim();
            if (/^\d+$/.test(currentVal)) {
                primaryInput.value = sid;
                secondaryInput.value = name;
            } else {
                primaryInput.value = name;
                secondaryInput.value = sid;
            }

            secondaryInput.style.backgroundColor = "#f1f5f9";
            loadStudentAnalysis(pid);
            resultsDropdown.style.display = "none";
        });

        const qBtn = item.querySelector(".record-quick-btn");
        if (qBtn) {
            qBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const student = {
                    name: qBtn.getAttribute("data-name"),
                    student_id: qBtn.getAttribute("data-sid")
                };
                window.goToRecord(student);
            });
        }
    });
}


// 2. 학생 분석 데이터 로드 (캐시 우선)
async function loadStudentAnalysis(pid) {
    document.getElementById("welcome-view").style.display = "none";
    document.getElementById("loading-view").style.display = "block";
    document.getElementById("result-view").style.display = "none";

    const { data: student } = await supabase.from('students').select('*').eq('pid', pid).single();
    if (!student) return alert("학생 정보를 찾을 수 없습니다.");
    currentStudent = student;
    window._lastSelectedStudent = student; // 생활기록 이동을 위해 전역 변수 업데이트

    // 동급생 캐싱 (이전/다음 버튼용)
    if (!window.currentClassStudents || window.currentClassStudents.length === 0 || window.currentClassStudents[0].class_info !== student.class_info) {
        const { data: classmates } = await supabase.from('students')
            .select('pid, student_id, name, class_info, academic_year')
            .eq('class_info', student.class_info)
            .eq('academic_year', student.academic_year)
            .order('student_id', { ascending: true });
        window.currentClassStudents = classmates || [];
    }

    // 이전/다음 학생 이동 전역 함수 정의
    window.navigateAdjacentStudent = (dir) => {
        if (!currentStudent || !window.currentClassStudents) return;
        const idx = window.currentClassStudents.findIndex(s => s.pid === currentStudent.pid);
        if (idx === -1) return;
        const targetIdx = idx + dir;
        if (targetIdx >= 0 && targetIdx < window.currentClassStudents.length) {
            window.scrollTo(0, 0); // 페이지 상단으로 이동
            loadStudentAnalysis(window.currentClassStudents[targetIdx].pid);
        }
    };

    const { data: insight } = await supabase
        .from('student_insights')
        .select('*')
        .eq('student_pid', pid)
        .order('analyzed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (insight) {
        document.getElementById("loading-view").style.display = "none";
        currentInsight = insight.content;
        renderResultView();

        const fullAccess = hasFullAnalysisAccess(student);

        // 캐시 데이터 로드 시 권한에 따라 섹션 업데이트
        // 권한에 따른 섹션 업데이트
        updateSectionUI('summary', currentInsight, currentInsight.tags, fullAccess);
        updateSectionUI('stats', currentInsight.stats, null, true); // 다면평가는 항상 노출
        updateSectionUI('profile', currentInsight.holistic_analysis, currentInsight.group_role, true); // 프로파일 항상 노출
        updateSectionUI('detective', currentInsight.detective || {}, null, fullAccess);
        updateSectionUI('action', currentInsight.action || "분석 데이터가 없습니다.", null, fullAccess);

        // 시급도 렌더링 (권한 체크 포함됨)
        renderCounselingPriority(currentInsight.counseling_priority, fullAccess);

        renderChart();
    } else {
        // 기초조사 데이터 유무 선제 확인 (.limit(1) 추가하여 중복 설문 시에도 오류 방지)
        const { data: survey } = await supabase.from('surveys').select('id').eq('student_pid', pid).limit(1).maybeSingle();
        if (!survey) {
            document.getElementById("loading-view").style.display = "none";
            alert("해당 학생의 기초조사(설문) 데이터가 없습니다. 분석을 진행할 수 없습니다.");
            document.getElementById("welcome-view").style.display = "block";
            return;
        }

        await runBatchAIAnalysis(pid);
    }
}

// Batch AI Analysis (Sequential steps for better UX)
async function runBatchAIAnalysis(pid) {
    // 1. Prepare Data
    const [surveyRes, recordsRes] = await Promise.all([
        supabase.from('surveys').select('data').eq('student_pid', pid).order('submitted_at', { ascending: false }).limit(1),
        supabase.from('life_records').select('category, content, is_positive').eq('student_pid', pid).order('created_at', { ascending: false }).limit(10)
    ]);

    const surveyData = surveyRes.data?.[0]?.data || {};
    const recordsData = (recordsRes.data || []).filter(r => r.content && r.content.trim().length > 9);

    // UI 스켈레톤 렌더링 지연 (완전한 로딩바 노출을 위함)
    document.getElementById("result-view").style.display = "none";
    currentInsight = {};

    const commonContext = `
        학생: ${currentStudent.name} (${currentStudent.class_info})
        성별: ${currentStudent.gender}
        기록: ${JSON.stringify(recordsData)}
        설문: ${JSON.stringify(surveyData)}
    `;

    try {
        // AI 호출 시작 전 상태 메시지 및 프로그레스 바 시뮬레이션
        const pBar = document.getElementById("ai-progress-bar");
        const pText = document.getElementById("ai-progress-text");
        const pPercent = document.getElementById("ai-progress-percent");

        // 프로그레스 바 초기화
        let progress = 0;
        if (pBar) pBar.style.width = "0%";
        if (pText) pText.innerText = "학생 기록 및 설문 데이터 종합 중...";
        if (pPercent) pPercent.innerText = "0%";

        // 가짜 진행률 시뮬레이션 인터벌
        const progressInterval = setInterval(() => {
            if (progress < 90) {
                // 천천히 90%까지 증가
                progress += Math.floor(Math.random() * 5) + 1;
                if (progress > 90) progress = 90;

                if (progress > 20 && progress <= 40) {
                    pText.innerText = "제미나이 2.5 Flash 모델 응답 대기 중...";
                } else if (progress > 40 && progress <= 70) {


                    pText.innerText = "다면 평가 지표 추출 및 분석 중...";
                } else if (progress > 70) {
                    pText.innerText = "거의 완료되었습니다. 결과 요약 중...";
                }

                if (pBar) pBar.style.width = `${progress}%`;
                if (pPercent) pPercent.innerText = `${progress}%`;
            }
        }, 500);

        const promptText = `
        다음 [데이터]를 바탕으로 학생의 특성을 전인적(Holistic) 관점에서 분석하여 JSON 형식으로만 답변해줘.
        JSON 이외의 텍스트(설명 등)는 절대 포함하지 마.

        {
          "summary": "학생의 전반적인 특징을 요약한 3줄 문장",
          "student_type": "학생의 핵심 성향 (1~2단어)",
          "tags": ["키워드1", "키워드2", "키워드3"],
          "counseling_priority": {
            "level": "시급/주의/관심/안정 중 택1",
            "reason": "해당 순위로 판단한 AI 소견 (1문장)"
          },
          "holistic_analysis": {
            "career": "목표지향형/탐색형/방황형 중 택1",
            "disposition": "내향 집중형/외향 활동형/균형형 중 택1",
            "family": "보호 안정형/정서 의존형/책임 조기성숙형 중 택1",
            "hobby_life": "경쟁 몰입형/창작 몰입형/소비형 중 택1",
            "rhythm": "건강 안정형/수면 부족형 중 택1",
            "emotion": "자기 인식형/고민 내재형/도움 요청형 중 택1"
          },
          "group_role": "리더형/전략가형/실행형/분위기 메이커형/자료 탐색형/책임 분산형/독주형 중 택1",
          "stats": {"study": 85, "routine": 70, "emotion": 90, "social": 80, "self": 75, "resilience": 88},
          "detective": {"clues": ["단서1", "단서2"], "deduction": "추론 의견"},
          "action": "교사를 위한 조언"
        }
        
        [데이터]
        ${commonContext}`;

        // 단 한 번의 호출로 통합 데이터 수신
        const fullData = await callGeminiAPI(promptText, "", 'gemini-2.5-flash');

        // 인터벌 정리 및 완료 상태(100%) 표시
        clearInterval(progressInterval);
        if (pBar) pBar.style.width = "100%";
        if (pText) pText.innerText = "분석 완료! 결과를 화면에 적용합니다.";
        if (pPercent) pPercent.innerText = "100%";

        currentInsight = fullData;

        // 시각적 박진감을 위해 약간의 시차를 두고 UI 업데이트
        const fullAccess = hasFullAnalysisAccess(currentStudent);

        setTimeout(() => {
            document.getElementById("loading-view").style.display = "none";
            renderResultView();
        }, 100);

        setTimeout(() => {
            updateSectionUI('summary', currentInsight, currentInsight.tags, fullAccess);
        }, 400);

        setTimeout(() => {
            updateSectionUI('stats', currentInsight.stats, null, true);
            updateSectionUI('profile', currentInsight.holistic_analysis, currentInsight.group_role, true);
            renderChart();
        }, 700);

        setTimeout(() => {
            renderCounselingPriority(currentInsight.counseling_priority, fullAccess);
            updateSectionUI('detective', currentInsight.detective, null, fullAccess);
        }, 1000);

        setTimeout(() => {
            updateSectionUI('action', currentInsight.action, null, fullAccess);
        }, 1300);

        // DB 저장
        await supabase.from('student_insights').insert([{ student_pid: pid, insight_type: 'omni', content: currentInsight }]);

    } catch (err) {
        if (typeof progressInterval !== 'undefined') clearInterval(progressInterval);
        console.error("AI Analysis Failed", err);

        const pBar = document.getElementById("ai-progress-bar");
        const pText = document.getElementById("ai-progress-text");
        if (pBar) {
            pBar.style.background = "#d63031";
            pBar.style.width = "100%";
        }
        if (pText) {
            pText.style.color = "#d63031";
            // [업데이트] 429 에러 메시지 상세화
            if (err.status === 429) {
                pText.innerText = `한도 초과 (API Quota Exceeded). ${err.retryAfter || 20}초 후 다시 시도해주세요.`;
            } else {
                pText.innerText = "분석 실패 (API 한도/키 오류)";
            }
        }

        const sections = ['summary', 'stats', 'detective', 'garden', 'action'];
        sections.forEach(sec => {
            const el = document.getElementById(`sec-${sec}`);
            if (el && el.classList.contains('loading-section')) {
                el.classList.remove('loading-section');
                el.innerHTML = `<h3 style="color:#d63031;">⚠️ 분석 오류</h3><p style="color:#636e72; font-size:0.9rem;">${err.status === 429 ? 'API 한도가 초과되었습니다.' : 'AI 연동 중 문제가 발생했습니다.'}</p>`;
            }
        });
    }
}

// 3. Class Analysis
async function loadClassAnalysis(classInfo) {
    document.getElementById("welcome-view").style.display = "none";
    document.getElementById("loading-view").style.display = "block";
    document.getElementById("result-view").style.display = "none";

    currentStudent = null;
    currentClassInfo = classInfo;
    currentInsight = {};

    await runBatchClassAnalysis(classInfo);
}

async function runBatchClassAnalysis(classInfo) {
    const { data: students } = await supabase.from('students').select('pid, name, student_id').eq('class_info', classInfo);
    const pids = students.map(s => s.pid);

    const [surveyRes, recordsRes] = await Promise.all([
        supabase.from('surveys').select('student_pid, data').in('student_pid', pids),
        supabase.from('life_records').select('student_pid, category, content, is_positive').in('student_pid', pids)
    ]);

    const classDataSnippet = students.map(st => ({
        name: st.name,
        records: (recordsRes.data || []).filter(r => r.student_pid === st.pid && r.content.length > 9).map(r => r.content)
    }));

    // UI 스켈레톤 지연 처리
    document.getElementById("result-view").style.display = "none";

    const commonContext = `학급명: ${classInfo}, 데이터: ${JSON.stringify(classDataSnippet)}`;

    try {
        // AI 호출 시작 전 상태 메시지 및 프로그레스 바 시뮬레이션
        const pBar = document.getElementById("ai-progress-bar");
        const pText = document.getElementById("ai-progress-text");
        const pPercent = document.getElementById("ai-progress-percent");

        let progress = 0;
        if (pBar) pBar.style.width = "0%";
        if (pText) pText.innerText = "학급 전체 데이터 수집 및 분석 준비...";
        if (pPercent) pPercent.innerText = "0%";

        const progressInterval = setInterval(() => {
            if (progress < 90) {
                progress += Math.floor(Math.random() * 5) + 1;
                if (progress > 90) progress = 90;

                if (progress > 20 && progress <= 40) {
                    pText.innerText = "제미나이 2.5 Flash 응답 대기 중...";
                } else if (progress > 40 && progress <= 70) {
                    pText.innerText = "학급 공통 특이점 및 패턴 추출 중...";
                } else if (progress > 70) {
                    pText.innerText = "거의 완료되었습니다. 결과 정리 중...";
                }

                if (pBar) pBar.style.width = `${progress}%`;
                if (pPercent) pPercent.innerText = `${progress}%`;
            }
        }, 500);
        const promptText = `
        다음 학급 [데이터]를 분석하여 JSON 형식으로만 답변해줘. 다른 설명 없이 오직 JSON만 출력해.
        {
          "summary": "학급 전체 분위기 요약 (3줄)",
          "tags": ["태그1", "태그2", "태그3"],
          "detective": {"clues": ["공통 패턴1", "공통 패턴2"], "deduction": "학급 전체 해석"},
          "garden": {"species": "숲/정원 비유 이름", "condition": "운영 제안"},
          "action": "교사 팁"
        }
        [데이터]
        ${commonContext}`;

        const fullData = await callGeminiAPI(promptText, "", 'gemini-2.5-flash');


        clearInterval(progressInterval);
        if (pBar) pBar.style.width = "100%";
        if (pText) pText.innerText = "학급 분석 완료! 화면을 구성합니다.";
        if (pPercent) pPercent.innerText = "100%";

        setTimeout(() => {
            document.getElementById("loading-view").style.display = "none";
            renderResultView();
            updateSectionUI('summary', fullData.summary, fullData.tags);
            updateSectionUI('detective', fullData.detective);
            updateSectionUI('garden', fullData.garden);
            updateSectionUI('action', fullData.action);
        }, 800);
    } catch (e) {
        if (typeof progressInterval !== 'undefined') clearInterval(progressInterval);
        console.error("Class Analysis Error", e);
        const sections = ['summary', 'detective', 'garden', 'action'];
        sections.forEach(sec => {
            const el = document.getElementById(`sec-${sec}`);
            if (el && el.classList.contains('loading-section')) {
                el.classList.remove('loading-section');
                el.innerHTML = `<h3 style="color:#d63031;">⚠️ 분석 오류</h3><p style="color:#636e72; font-size:0.9rem;">학급 분석 중 오류가 발생했습니다.</p>`;
            }
        });
    }
}

// Helper: Call Gemini
async function callGeminiAPI(prompt, context, targetModel = 'gemini-2.0-flash') {
    // Gemini 키는 서버(게이트웨이)에만 있음. 브라우저는 /api/gemini 로만 호출한다.
    try {
        const response = await fetch(`${location.origin}/api/gemini`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-teacher-token': getSessionToken(),
            },
            body: JSON.stringify({ model: targetModel, prompt, context: context || "" })
        });

        const res = await response.json();

        if (res.error) {
            const msg = (res.error && res.error.message) || String(res.error);
            if (response.status === 429) {
                const errorDetail = { status: 429, message: msg, retryAfter: 0 };
                const match = msg.match(/retry in ([\d.]+)s/);
                if (match) errorDetail.retryAfter = parseFloat(match[1]);
                throw errorDetail;
            }
            throw new Error(msg);
        }
        if (!res.candidates || !res.candidates[0].content.parts[0].text) throw new Error("AI 응답 형식이 올바르지 않습니다.");

        if (res.usageMetadata) {
            const { promptTokenCount, candidatesTokenCount, totalTokenCount, cachedContentTokenCount } = res.usageMetadata;
            const actualCandidates = candidatesTokenCount || (totalTokenCount - (promptTokenCount + (cachedContentTokenCount || 0)));

            console.log("-----------------------------------------");
            console.log(`🤖 [Gemini API Usage Detail - ${targetModel}]`);
            console.log(`- Prompt (New Content): ${promptTokenCount}`);
            if (cachedContentTokenCount) {
                console.log(`- Cached (Reused Content): ${cachedContentTokenCount}`);
            }
            console.log(`- Candidates (Response): ${actualCandidates}`);
            console.log(`- TOTAL Tokens: ${totalTokenCount}`);
            console.log("-----------------------------------------");
        }

        let text = res.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(text);
    } catch (err) {
        console.error("Gemini API Call Error:", err);
        throw err;
    }
}

// 생활기록 페이지로 이동
window.goToRecord = function (student) {
    if (!student) return;
    const name = encodeURIComponent(student.name);
    const num = encodeURIComponent(student.student_id);
    window.location.href = `record.html?num=${num}&name=${name}`;
};




// UI: Initial Result View (Skeleton)
function renderResultView() {
    document.getElementById("result-view").style.display = "block";
    const photoMini = document.getElementById("student-photo-mini");
    const headerName = document.getElementById("view-student-name");
    const headerInfo = document.getElementById("view-student-info");

    if (currentStudent) {
        headerName.innerText = currentStudent.name;
        headerInfo.innerText = `${currentStudent.student_id || ''}`.trim();

        // 사진 처리 로직 개선 (Drive ID 지원)
        let photoUrl = "";
        const driveId = extractDriveId(currentStudent.photo_url);
        if (driveId) {
            photoUrl = getThumbnailUrl(driveId);
        } else if (currentStudent.photo_url && currentStudent.photo_url.startsWith('http')) {
            photoUrl = currentStudent.photo_url;
        } else if (currentStudent.photo_url) {
            const { data } = supabase.storage.from('student_photos').getPublicUrl(currentStudent.photo_url);
            photoUrl = data.publicUrl;
        }

        if (photoUrl) {
            photoMini.innerHTML = `<img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.src='https://ovpcrjovaypvnstzptvi.supabase.co/storage/v1/object/public/student_photos/default-avatar.png'; this.onerror=null; this.parentElement.innerHTML='👤';">`;
        } else {
            photoMini.innerHTML = "👤";
        }

        // [추가] 생활기록 버튼 주입 (분석 버튼은 이미 다른 곳에 있을 수 있지만, 헤더 카드에 통합)
        const actionArea = document.getElementById("header-action-area");
        if (actionArea) {
            actionArea.innerHTML = ""; // 기존 버튼 제거

            const recordBtn = document.createElement("button");
            recordBtn.className = "btn-survey-view";
            recordBtn.style.background = "#ffffff";
            recordBtn.style.color = "#0f52ba";
            recordBtn.innerHTML = "📝 생활기록 바로가기";
            recordBtn.onclick = (e) => {
                e.stopPropagation();
                window.goToRecord(currentStudent);
            };
            actionArea.appendChild(recordBtn);
        }
    } else {
        headerName.innerText = `${currentClassInfo} 학급 전체`;
        headerInfo.innerText = "통합 분석";
        photoMini.innerHTML = "🏫";

        // 학급 전체 모드일 때는 이동 버튼 및 클릭 숨김 (css/js 제어)
        const navControls = document.getElementById("student-nav-controls");
        if (navControls) navControls.style.display = "none";
        const linkDiv = document.getElementById("student-profile-link");
        if (linkDiv) linkDiv.style.cursor = "default";
    }

    // 개별 학생 모드일 때만 이동 버튼 활성화
    if (currentStudent && window.currentClassStudents && window.currentClassStudents.length > 0) {
        const idx = window.currentClassStudents.findIndex(s => s.pid === currentStudent.pid);
        const prevBtn = document.getElementById("prev-btn");
        const nextBtn = document.getElementById("next-btn");
        const navControls = document.getElementById("student-nav-controls");
        const linkDiv = document.getElementById("student-profile-link");

        if (navControls) navControls.style.display = "flex";

        if (prevBtn) {
            prevBtn.style.visibility = idx > 0 ? "visible" : "hidden";
            prevBtn.onclick = () => window.navigateAdjacentStudent(-1);
        }
        if (nextBtn) {
            nextBtn.style.visibility = idx < window.currentClassStudents.length - 1 ? "visible" : "hidden";
            nextBtn.onclick = () => window.navigateAdjacentStudent(+1);
        }
        if (linkDiv) {
            linkDiv.style.cursor = "pointer";
            linkDiv.onclick = () => {
                window.location.href = `record.html?num=${currentStudent.student_id || ''}&name=${encodeURIComponent(currentStudent.name)}`;
            };
        }
    }

    document.getElementById("lens-content").innerHTML = `
        <div id="sec-counseling" style="margin-bottom: 25px;"></div>
        <div id="sec-summary" class="result-card loading-section"><h3>⭐ AI 핵심 요약</h3><div class="mini-spinner"></div><p class="status-text">분석 중...</p></div>
        <div id="sec-profile" class="result-card loading-section"><h3>🌈 전인적 분석 프로파일</h3><div class="mini-spinner"></div></div>
        <div id="sec-stats" class="result-card loading-section" style="${currentMode === 'class' ? 'display:none' : ''}"><h3>📊 다면 평가 수치</h3><div class="mini-spinner"></div></div>
        <div id="sec-detective" class="result-card loading-section"><h3>🕵️ 특이점 추론</h3><div class="mini-spinner"></div></div>
        <div id="sec-action" class="result-card loading-section"><h3>💡 추천 액션 플랜</h3><div class="mini-spinner"></div></div>
    `;
}
// 재분석 버튼 이벤트 리스너
const reBtn = document.getElementById("re-analyze-btn");
if (reBtn) {
    reBtn.onclick = () => {
        if (currentStudent && confirm(`${currentStudent.name} 학생의 최신 기록을 바탕으로 다시 분석을 시작할까요?`)) {
            runBatchAIAnalysis(currentStudent.pid);
        }
    };
}

// UI: Update specific section
function updateSectionUI(type, data, extra, hasAccess = true) {
    const el = document.getElementById(`sec-${type}`);
    if (!el) return;
    el.classList.remove('loading-section');

    // 권한이 없는 경우 마스킹 처리 (단, 프로파일과 스태츠는 예외로 보여줌)
    const needsAccess = ['summary', 'detective', 'action', 'counseling'];
    if (needsAccess.includes(type) && !hasAccess) {
        let title = "";
        switch (type) {
            case 'summary': title = "⭐ AI 핵심 요약"; break;
            case 'detective': title = "🕵️ 특이점 추론"; break;
            case 'action': title = "💡 추천 액션 플랜"; break;
            case 'counseling': title = "상담 시급도"; break;
        }
        el.innerHTML = `<h3 style="color:#94a3b8; margin-top:0;">${title}</h3>
    <div style="background:#f1f5f9; padding:20px; border-radius:12px; border:1px dashed #cbd5e1; text-align:center;">
        <p style="color:#64748b; font-size:0.95rem; margin:0;">🔒 이 정보는 담당 교사, 상담 교사 또는 관리자만 볼 수 있습니다.</p>
    </div>`;
        return;
    }

    switch (type) {
        case 'summary':
            let summaryText = "";
            let studentType = "";

            if (typeof data === 'string') {
                summaryText = data;
            } else if (data && typeof data === 'object') {
                summaryText = data.summary || data.text || "";
                studentType = data.student_type || "";
            }

            const typeBadgeHtml = studentType ? `<div style="margin-top: 10px; margin-bottom: 12px;"><span style="background:linear-gradient(135deg, #FF9A9E, #FECFEF); color:#D81B60; padding:6px 12px; border-radius:20px; font-size:0.95rem; font-weight:800; border:1px solid #FF80AB; display:inline-flex; align-items:center; gap:6px;">✨ ${studentType}</span></div>` : '';
            el.innerHTML = `<h3 style="color:#4A90E2; margin-top:0;">⭐ AI 핵심 요약</h3>
                            ${typeBadgeHtml}
                            <p style="font-size:1.05rem; line-height:1.7; word-break:keep-all; color:#333; background:#f8fafc; padding:16px; border-radius:12px; margin:0 0 12px 0;">${summaryText}</p>
                            <div>${(extra || []).map(t => `<span class="badge" style="background:var(--ai-primary); color:white; padding:4px 8px; border-radius:4px; font-size:0.85rem; margin-right:6px;">#${t}</span>`).join('')}</div>`;
            break;
        case 'profile':
            renderHolisticProfile(data, extra);
            break;
        case 'stats':
            el.innerHTML = `<h3 style="color:#4A90E2; margin-top:0;">📊 다면 평가 수치</h3>
    <div style="height:300px; display:flex; justify-content:center; align-items:center; background:#f8fafc; border-radius:12px; padding:10px;"><canvas id="aiStatsChart"></canvas></div>`;
            break;
        case 'detective':
            if (!data || !data.clues) {
                el.innerHTML = `<h3 style="color:#D35400; margin-top:0;">🕵️ 특이점 추론(Detective)</h3> <p style="padding:10px; color:#94a3b8;">데이터가 없습니다.</p>`;
                break;
            }
            el.innerHTML = `<h3 style="color:#D35400; margin-top:0;">🕵️ 특이점 추론(Detective)</h3>
    <div style="background:#fdf6e3; padding:16px; border-radius:12px; border-left:4px solid #D35400; font-size:0.95rem; line-height:1.6; color:#444; word-break:keep-all;">
        <p style="font-weight:bold; margin:0 0 8px 0; color:#D35400;">발견된 단서 (Clues)</p>
        <ul style="margin:0 0 12px 0; padding-left:24px; color:#555; word-break:keep-all;">${(data.clues || []).map(c => `<li style="margin-bottom:4px;">${c}</li>`).join('')}</ul>
        <p style="margin:12px 0 4px 0; font-weight:bold; border-top:1px dashed #ccc; padding-top:10px; color:#D35400;">추론 결과</p>
        <p style="margin:0; word-break:keep-all;">${data.deduction}</p>
    </div>`;
            break;
        case 'action':
            el.innerHTML = `<h3 style="color:var(--ai-primary); margin-top:0;">💡 교사를 위한 추천 액션 플랜</h3>
    <p style="font-size:1.05rem; font-weight:bold; word-break:keep-all; color:#333; line-height:1.7; background:#eef2ff; padding:16px; border-radius:12px; margin:0; border:1px solid #cce4f7;">${data || "추천 액션이 없습니다."}</p>`;
            break;
    }
    el.classList.add('fade-in');
}

// UI: Radar Chart
function renderChart() {
    const ctx = document.getElementById('aiStatsChart')?.getContext('2d');
    if (!ctx || !currentInsight.stats) return;
    if (analysisChart) analysisChart.destroy();

    const s = currentInsight.stats;
    // 차트 레이블 설정 (크고 진하게)
    analysisChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['학업', '루틴', '정서', '사회성', '자아성찰', '회복탄력성'],
            datasets: [{
                label: 'AI 분석',
                data: [s.study, s.routine, s.emotion, s.social, s.self, s.resilience],
                backgroundColor: 'rgba(74, 144, 226, 0.2)',
                borderColor: '#4A90E2',
                borderWidth: 2
            }]
        },
        options: {
            scales: {
                r: {
                    suggestedMin: 0,
                    suggestedMax: 100,
                    ticks: { display: false },
                    pointLabels: {
                        font: {
                            size: 22, // 기존보다 약 2~3배 확대 (충분히 크게)
                            weight: '900', // 더 두껍게
                            family: 'Pretendard'
                        },
                        color: '#1e293b'
                    }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// 상담 시급도 배너 렌더링
function renderCounselingPriority(priority, hasAccess = true) {
    const el = document.getElementById("sec-counseling");
    if (!el) return;
    if (!priority) {
        el.innerHTML = "";
        return;
    }

    if (!hasAccess) {
        updateSectionUI('counseling', null, null, false);
        return;
    }

    const levels = [
        { id: '시급', color: '#e11d48', icon: '🔴' },
        { id: '주의', color: '#ea580c', icon: '🟠' },
        { id: '관심', color: '#ca8a04', icon: '🟡' },
        { id: '안정', color: '#16a34a', icon: '🟢' }
    ];

    const currentLevel = priority.level;
    const bgInfo = {
        '시급': { bg: '#fff1f2', border: '#fda4af' },
        '주의': { bg: '#fff7ed', border: '#fdba74' },
        '관심': { bg: '#fefce8', border: '#fef08a' },
        '안정': { bg: '#f0fdf4', border: '#bbf7d0' }
    };
    const highlight = bgInfo[currentLevel] || bgInfo['안정'];

    let html = `
        <div style="background:${highlight.bg}; border:2px solid ${highlight.border}; border-radius:16px; padding:18px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px; flex-wrap:wrap; gap:10px;">
                <div style="font-weight:800; color:#1e293b; font-size:1rem;">상담 시급도</div>
                <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.5); padding:4px 12px; border-radius:20px; border:1px solid rgba(0,0,0,0.03);">
    `;

    levels.forEach((lvl, index) => {
        const isActive = lvl.id === currentLevel;
        html += `
            <span style="font-size:0.95rem; display:flex; align-items:center; gap:4px; ${isActive ? `color:${lvl.color}; font-weight:900;` : 'color:#94a3b8; font-weight:400;'}">
                ${isActive ? lvl.icon : ''} ${lvl.id}
            </span>
            ${index < levels.length - 1 ? '<span style="color:#cbd5e1; margin:0 2px; font-weight:100;">/</span>' : ''}
        `;
    });

    html += `
                </div>
            </div>
            <div style="color:#475569; font-size:0.95rem; line-height:1.5;">
                <span style="display:inline-block; background:${highlight.border}; color:#fff; padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:bold; margin-right:6px; vertical-align:middle;">AI 소견</span>
                <span style="vertical-align:middle;">${priority.reason}</span>
            </div>
        </div>
    `;

    el.innerHTML = html;
}

// 전인적 프로파일 및 모둠 역할 렌더링
function renderHolisticProfile(analysis, role) {
    const el = document.getElementById("sec-profile");
    if (!el) return;
    el.classList.remove('loading-section');

    if (!analysis) {
        el.innerHTML = `<h3 style="color:#94a3b8; margin-top:0;">🌈 전인적 분석 프로파일</h3>
            <p style="color:#94a3b8; font-size:0.9rem; text-align:center; padding:20px; background:#f8fafc; border-radius:12px; border:1px dashed #cbd5e1;">구버전 분석 데이터입니다. 새로운 분석을 실행하면 전인적 프로파일이 표시됩니다.</p>`;
        return;
    }

    const config = [
        { key: 'career', label: '🎯 학습 동기 & 진로', items: ['목표지향형', '탐색형', '방황형'] },
        { key: 'disposition', label: '🧠 성향 & 에너지', items: ['내향 집중형', '외향 활동형', '균형형'] },
        { key: 'family', label: '🏠 가정 환경 기반', items: ['보호 안정형', '정서 의존형', '책임 조기성숙형'] },
        { key: 'hobby_life', label: '🎮 몰입 에너지', items: ['경쟁 몰입형', '창작 몰입형', '소비형'] },
        { key: 'rhythm', label: '🌙 생활 리듬', items: ['건강 안정형', '수면 부족형'] },
        { key: 'emotion', label: '💛 정서 유형', items: ['자기 인식형', '고민 내재형', '도움 요청형'] }
    ];

    let html = '<h3 style="color:#4A90E2; margin-top:0;">🌈 전인적 분석 프로파일</h3>';
    html += '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:15px;">';

    config.forEach(cfg => {
        const selected = analysis[cfg.key];
        html += `
                <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
                <div style="font-size:0.85rem; color:#64748b; margin-bottom:8px;">${cfg.label}</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${cfg.items.map(item => {
            const isActive = item === selected;
            return `<span style="padding:4px 10px; border-radius:8px; font-size:0.9rem; ${isActive ? 'background:#4A90E2; color:#fff; font-weight:bold; box-shadow:0 2px 4px rgba(74,144,226,0.3);' : 'background:#f1f5f9; color:#94a3b8;'}">${item}</span>`;
        }).join('')}
                </div>
                </div>
            `;
    });
    html += '</div>';

    if (role) {
        html += `
            <div style="margin-top:20px; background:linear-gradient(to right, #f0f7ff, #fdf2f8); border-radius:12px; padding:16px; border:1px solid #bae6fd;">
                <div style="font-weight:bold; color:#0369a1; margin-bottom:8px;">👥 모둠 활동 추천 역할</div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="background:#0369a1; color:#fff; padding:4px 12px; border-radius:20px; font-weight:bold;">${role}</span>
                    <span style="color:#0c4a6e; font-size:0.95rem;">활동 시 위 역할을 맡을 때 가장 높은 시너지를 낼 수 있습니다.</span>
                </div>
                </div>
            </div>
            `;
    }

    el.innerHTML = html;
}

/**
 * 소유자 전용 배치 분석 시스템 (Batch Engine)
 */
let isBatchRunning = false;
let isProcessingNext = false; // [추가] 중복 실행 방지 플래그
let batchQueue = [];
let batchCurrentIndex = 0;
let stopRequested = false;

function initOwnerBatch() {
    const startBtn = document.getElementById("batch-start-btn");
    const stopBtn = document.getElementById("batch-stop-btn");

    if (!startBtn || !stopBtn) return;

    // 권한 체크 후 UI 표시 여부 결정 (소유자 이메일 검증)
    const checkOwnerInternal = setInterval(() => {
        // 1. currentTeacher 객체가 있는 경우 (Supabase 연동 성공)
        if (currentTeacher) {
            clearInterval(checkOwnerInternal);
            // [M2] 관리자 권한자에게만 일괄 엔진 패널 노출
            if (currentTeacher.role === 'admin' || Object.values(currentTeacher.permissions?.admin || {}).some(Boolean)) {
                document.getElementById("owner-batch-panel").style.display = "block";
                console.log("👑 Owner Batch Engine Initialized (via DB)");
            }
        }
    }, 1000);

    startBtn.addEventListener("click", startBatchAnalysis);
    stopBtn.addEventListener("click", () => {
        stopRequested = true;
        updateBatchUI("중단 요청 중...", "stop");
    });

    // Gemini 키는 서버에서 관리됨 — 브라우저 키 입력 UI 제거
    const resetKeyBtn = document.getElementById("batch-reset-key-btn");
    if (resetKeyBtn) resetKeyBtn.style.display = "none";

    // 실시간 모니터링 구독 시작
    subscribeToNewSurveys();
}

/**
 * 실시간 설문 제출 모니터링 (소유자 전용)
 */
function subscribeToNewSurveys() {
    if (!supabaseRealtime) return; // realtime disabled (no anon key configured)
    supabaseRealtime
        .channel('public:surveys-realtime-batch')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'surveys' }, async (payload) => {
            // 엔진이 실행 중이 아니면 무시
            if (!isBatchRunning || stopRequested) return;

            const newSurvey = payload.new;
            const pid = newSurvey.student_pid;

            // 이미 큐에 있거나 현재 분석 중인지 확인
            if (batchQueue.some(s => s.pid === pid)) return;

            try {
                // 학생 정보 가져오기 (현재 학년도 확인)
                const { data: student } = await supabase
                    .from('students')
                    .select('pid, student_id, name, academic_year')
                    .eq('pid', pid)
                    .single();

                if (student && student.academic_year === API_CONFIG.CURRENT_ACADEMIC_YEAR) {
                    console.log(`[Realtime] 새 제출 감지: ${student.name}. 대기열 추가.`);

                    const wasIdle = batchCurrentIndex >= batchQueue.length;
                    batchQueue.push(student);

                    // [수정] 작업이 대기 상태였고, 현재 프로세스가 돌고 있지 않을 때만 깨움
                    if (wasIdle && !isProcessingNext) {
                        console.log("[Realtime] 배치 프로세스 재개...");
                        processNextInBatch();
                    }
                }
            } catch (err) {
                console.error("[Realtime Subscription Error]", err);
            }
        })
        .subscribe();
}

function updateBatchUI(statusText, state) {
    const badge = document.getElementById("batch-status-badge");
    const progressText = document.getElementById("batch-progress-text");
    const startBtn = document.getElementById("batch-start-btn");
    const stopBtn = document.getElementById("batch-stop-btn");

    if (statusText) progressText.innerText = statusText;

    if (state === "running") {
        badge.innerText = "분석 중";
        badge.className = "status-badge running";
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else if (state === "stop") {
        badge.innerText = "대기 중";
        badge.className = "status-badge";
        startBtn.disabled = false;
        stopBtn.disabled = true;
        isBatchRunning = false;
    }
}

async function startBatchAnalysis() {
    if (isBatchRunning) return;

    isBatchRunning = true;
    stopRequested = false;

    updateBatchUI("미분석 학생 조회 중...", "running");
    document.getElementById("batch-progress-container").style.display = "block";
    document.getElementById("overall-status-board").style.display = "block";

    try {
        // 1. 현재 학년도의 모든 학생 가져오기
        const { data: students, error: sError } = await supabase
            .from('students')
            .select('pid, student_id, name, class_info')
            .eq('academic_year', API_CONFIG.CURRENT_ACADEMIC_YEAR);

        if (sError) throw sError;

        // 2. 이미 분석된 PID 목록 가져오기
        const { data: insights } = await supabase
            .from('student_insights')
            .select('student_pid');

        const analyzedSet = new Set(insights.map(i => i.student_pid));

        // 3. 설문 제출 완료 학생 중 미분석자 필터링
        const { data: surveys } = await supabase
            .from('surveys')
            .select('student_pid')
            .order('submitted_at', { ascending: true });

        const submissionSet = new Set(surveys.map(s => s.student_pid));

        batchQueue = students.filter(s => submissionSet.has(s.pid) && !analyzedSet.has(s.pid));

        // 반별 통계 및 현황판 초기화
        initClassStatusBoard(students, submissionSet, analyzedSet);

        if (batchQueue.length === 0) {
            alert("분석할 새로운 대상이 없습니다.");
            updateBatchUI("모든 학생 분석 완료", "stop");
            return;
        }

        batchCurrentIndex = 0;
        await processNextInBatch();

    } catch (e) {
        console.error("Batch Analysis Start Failed:", e);
        alert("배치 분석 준비 중 오류가 발생했습니다.");
        updateBatchUI("오류 발생", "stop");
    }
}

// 배치 엔진 상태 관리
let batchFailureCount = 0; // 특정 학생 실패 횟수 카운트

async function processNextInBatch() {
    if (stopRequested) {
        updateBatchUI("분석 중단됨", "stop");
        isProcessingNext = false; // 플래그 해제
        return;
    }

    // 이미 실행 중인 경우 중복 실행 방지 (핵심!: 429 원인 해결)
    if (isProcessingNext) {
        console.log("[Batch] 이미 다른 프로세스가 진행 중입니다. 대기합니다.");
        return;
    }
    isProcessingNext = true;

    if (batchCurrentIndex >= batchQueue.length) {
        // 모든 현재 대기열 처리 완료. 실시간 대기 모드로 전환.
        document.getElementById("batch-status-badge").innerText = "제출 대기 중";
        document.getElementById("batch-status-badge").className = "status-badge running";
        document.getElementById("batch-progress-text").innerText = "새로운 설문 제출을 실시간으로 기다리고 있습니다...";
        document.getElementById("batch-current-target").innerText = "모든 현재 제출자 분석 완료. 대기 중...";
        isProcessingNext = false; // 대기 모드로 전환 시 플래그 해제
        return;
    }

    const student = batchQueue[batchCurrentIndex];
    const total = batchQueue.length;
    const currentNum = batchCurrentIndex + 1;
    const progressPerc = Math.round((currentNum / total) * 100);

    // 반별 카운트 및 UI 업데이트 로직
    let classStatusText = "";
    if (student.class_info && window.batchClassStats && window.batchClassStats[student.class_info]) {
        window.batchClassStats[student.class_info].current_session++;
        const cStats = window.batchClassStats[student.class_info];
        // 학생이름 옆에 붙일 텍스트도 학급 전체 기준으로 변경
        classStatusText = ` (${student.class_info} ${cStats.done + cStats.current_session}명 / 전체 ${cStats.class_total}명)`;
    }

    // UI 업데이트
    document.getElementById("batch-progress-bar").style.width = `${progressPerc}% `;
    document.getElementById("batch-progress-percent").innerText = `${currentNum}/${total}`;
    document.getElementById("batch-current-target").innerText = `현재: ${student.student_id} ${student.name} 분석 중...${classStatusText}`;
    document.getElementById("batch-status-badge").innerText = `진행 중 (${progressPerc}%)`;

    // 현황판 UI 해당 반 슬롯 업데이트
    if (student.class_info) updateSlotStatus(student.class_info, 'progress');

    try {
        await runSilentAIAnalysis(student.pid, student.name);

        batchCurrentIndex++;
        batchFailureCount = 0; // 성공 시 실패 카운트 초기화

        // 12초 대기 (쿼터 준수를 위해 대폭 증가)
        let secondsLeft = 12;
        const countdownTimer = setInterval(() => {
            if (secondsLeft > 0 && !stopRequested) {
                document.getElementById("batch-progress-text").innerText = `안전 대기 중... (${secondsLeft}초)`;
                secondsLeft--;
            } else {
                clearInterval(countdownTimer);
            }
        }, 1000);

        setTimeout(() => {
            isProcessingNext = false; // 대기 종료 후 플래그 해제
            processNextInBatch();
        }, 12500);

    } catch (err) {
        console.error(`Batch Error (${student.name}):`, err);
        batchFailureCount++;

        if (err.status === 429) {
            // 429 에러(한도 초과) 시 자동 재시도 로직
            const waitSec = Math.ceil(err.retryAfter || 20) + 10; // 안내된 시간 + 10초 여유
            let remain = waitSec;

            const retryTimer = setInterval(() => {
                if (remain > 0 && !stopRequested) {
                    document.getElementById("batch-progress-text").innerText = `⚠️ API 한도 초과! ${remain}초 후 자동 재시도합니다...`;
                    remain--;
                } else {
                    clearInterval(retryTimer);
                }
            }, 1000);

            setTimeout(() => {
                isProcessingNext = false; // 재시도 대기 후 플래그 해제
                processNextInBatch();
            }, waitSec * 1000);
        } else if (batchFailureCount >= 3) {
            console.warn(`[Batch] ${student.name} 학생 분석 3회 실패. 다음 학생으로 넘어갑니다.`);
            batchCurrentIndex++;
            batchFailureCount = 0;
            isProcessingNext = false;
            processNextInBatch();
        } else {
            // 일반 에러 시 15초 후 재시도
            document.getElementById("batch-progress-text").innerText = `에러 발생! 15초 후 재시도... (${batchFailureCount}/3)`;
            setTimeout(() => {
                isProcessingNext = false;
                processNextInBatch();
            }, 15000);
        }
    }
}


async function runSilentAIAnalysis(pid, name) {
    // 데이터 수집
    const [sData, rData, sInfo] = await Promise.all([
        supabase.from('surveys').select('data').eq('student_pid', pid).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('life_records').select('category, content, is_positive').eq('student_pid', pid).limit(15),
        supabase.from('students').select('*').eq('pid', pid).single()
    ]);

    const survey = sData.data?.data || {};
    const records = (rData.data || []).filter(r => r.content && r.content.trim().length > 5);

    const promptText = `
    다음 학생 데이터를 분석하여 JSON으로만 답변해줘.
    이름: ${name}, 성별: ${sInfo.data.gender}, 학급: ${sInfo.data.class_info}
    생활기록: ${JSON.stringify(records)}
    기초조사: ${JSON.stringify(survey)}

    형식:
    {
      "summary": "3줄 요약",
      "student_type": "핵심 성향",
      "tags": ["키워드1", "키워드2", "키워드3"],
      "counseling_priority": {"level": "시급/주의/관심/안정 중 택1", "reason": "이유"},
      "holistic_analysis": {
        "career": "목표지향형/탐색형/방황형",
        "disposition": "내향 집중형/외향 활동형/균형형",
        "family": "보호 안정형/정서 의존형/책임 조기성숙형",
        "hobby_life": "경쟁 몰입형/창작 몰입형/소비형",
        "rhythm": "건강 안정형/수면 부족형",
        "emotion": "자기 인식형/고민 내재형/도움 요청형"
      },
      "group_role": "역할명",
      "stats": {"study": 0~100, "routine": 0~100, "emotion": 0~100, "social": 0~100, "self": 0~100, "resilience": 0~100},
      "detective": {"clues": ["단서1"], "deduction": "추론"},
      "action": "교사 조언"
    }`;

    const result = await callGeminiAPI(promptText, "", 'gemini-2.0-flash');



    // DB 저장
    await supabase.from('student_insights').insert([
        { student_pid: pid, insight_type: 'omni', content: result }
    ]);

    console.log(`[Batch Success] ${name} 분석 완료`);

    // 현황판 UI 완료 체크
    if (sInfo.data.class_info && window.batchClassStats && window.batchClassStats[sInfo.data.class_info]) {
        const cStats = window.batchClassStats[sInfo.data.class_info];
        if (cStats.current_session >= cStats.session_target) {
            updateSlotStatus(sInfo.data.class_info, 'complete');
        }
    }
}

// ==========================================
// 현황판 구성용 헬퍼 함수
// ==========================================
function initClassStatusBoard(allStudents, submissionSet, analyzedSet) {
    // 1~3학년 1~6반 구조 생성
    const structure = {
        '1학년': ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6'],
        '2학년': ['2-1', '2-2', '2-3', '2-4', '2-5', '2-6'],
        '3학년': ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6']
    };

    // 반별 분석 진행 상태 계산을 위한 통계 객체 복구 및 생성
    window.batchClassStats = {};
    const classUiState = {};

    Object.values(structure).flat().forEach(className => {
        // class_total: 학급의 전체 학생 수 (제출여부 무관)
        // done: 완전히 분석 완료된 수
        // pending: 제출했지만 아직 이번 세션에서 분석 안 단 수
        // current_session: 이번 [자동 분석 시작]을 누르고 나서 지금까지 완료된/진행중인 실시간 수
        // session_target: 이번 세션에 처리할 총 인원
        window.batchClassStats[className] = { class_total: 0, done: 0, pending: 0, current_session: 0, session_target: 0 };
    });

    allStudents.forEach(st => {
        const cName = st.class_info;
        if (!cName || !window.batchClassStats[cName]) return;

        window.batchClassStats[cName].class_total++; // 반 전체 학생 수 누적

        const hasSubmitted = submissionSet.has(st.pid);
        const hasAnalyzed = analyzedSet.has(st.pid);

        if (hasSubmitted && !hasAnalyzed) {
            // 이번 배치 타겟
            window.batchClassStats[cName].session_target++;
            window.batchClassStats[cName].pending++;
        } else if (hasAnalyzed) {
            // 과거를 포함하여 이미 분석 완료된 수
            window.batchClassStats[cName].done++;
        }
    });

    // 화면 그리기
    for (let grade = 1; grade <= 3; grade++) {
        const container = document.getElementById(`grade-${grade}-slots`);
        if (!container) continue;
        container.innerHTML = ''; // 초기화

        structure[`${grade}학년`].forEach(className => {
            const stats = window.batchClassStats[className];
            let stateClass = 'pending';
            let labelCount = `${stats.done} / ${stats.class_total}`;

            if (stats.pending > 0) {
                // 해야할 학생이 있음 (이번 타겟이 존재)
                stateClass = 'pending';
            } else if (stats.done > 0 && stats.pending === 0) {
                // 이번 처리할 게 없고, (과거) 분석해둔 게 있다면
                stateClass = 'complete';
            }

            const slot = document.createElement('div');
            slot.className = `class-slot ${stateClass}`;
            slot.id = `slot-${className}`;
            slot.innerHTML = `
                <span class="class-name">${className}</span>
                <span class="class-count">${labelCount}</span>
            `;
            container.appendChild(slot);
        });
    }
}

function updateSlotStatus(className, state) {
    const slot = document.getElementById(`slot-${className}`);
    if (!slot) return;

    const stats = window.batchClassStats[className];
    if (!stats) return;

    const displayDone = stats.done + stats.current_session;

    if (state === 'progress') {
        slot.className = 'class-slot progress';
        slot.querySelector('.class-count').innerText = `${displayDone} / ${stats.class_total}`;
    } else if (state === 'complete') {
        slot.className = 'class-slot complete';
        slot.querySelector('.class-count').innerText = `${displayDone} / ${stats.class_total}`;
    }
}
