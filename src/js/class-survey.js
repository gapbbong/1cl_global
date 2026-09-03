import { supabase } from './supabase.js';

// URL 파라미터 파싱
const urlParams = new URLSearchParams(window.location.search);
const grade = parseInt(urlParams.get("grade"));
const classNum = parseInt(urlParams.get("class"));

let allSurveys = [];

document.addEventListener("DOMContentLoaded", async () => {
    const titleElement = document.getElementById("class-title");
    if (grade && classNum) {
        titleElement.textContent = `${grade}학년 ${classNum}반 기초조사 목록`;
        document.title = `${grade}학년 ${classNum}반 기초조사`;
        await loadSurveys();
    } else {
        titleElement.textContent = "반 정보 없음";
        document.getElementById("survey-list").textContent = "URL에 학년과 반 정보가 필요합니다.";
        document.getElementById("survey-list").classList.remove("loading");
    }

    // 수정: '사진 명렬'로 돌아가는 뒤로가기 버튼 설정
    const backBtn = document.querySelector(".back-btn");
    if (backBtn && grade && classNum) {
        backBtn.onclick = (e) => {
            e.preventDefault();
            window.location.href = `stu-list.html?grade=${grade}&class=${classNum}`;
        };
    }

    // 필터링 이벤트 등록
    document.getElementById("search-input").addEventListener("input", renderSurveys);
    document.getElementById("filter-select").addEventListener("change", renderSurveys);
});

async function loadSurveys() {
    const list = document.getElementById("survey-list");
    list.classList.add("loading");

    try {
        const classTarget = `${grade}-${classNum}`;
        const { data: students, error: sError } = await supabase
            .from('students')
            .select('pid, student_id, name')
            .eq('class_info', classTarget);

        if (sError) throw sError;
        if (!students || students.length === 0) {
            list.classList.remove("loading");
            list.textContent = "해당 반의 학생 데이터가 없습니다.";
            return;
        }

        const studentPids = students.map(s => s.pid);

        const { data: surveys, error: surveyError } = await supabase
            .from('surveys')
            .select('*')
            .in('student_pid', studentPids)
            .order('submitted_at', { ascending: false });

        if (surveyError) throw surveyError;

        // 학생별 최신 설문 1개씩만 추출 (중복 제거)
        const surveyMap = new Map();
        surveys.forEach(s => {
            if (!surveyMap.has(s.student_pid)) {
                surveyMap.set(s.student_pid, s);
            }
        });

        // 학번/번호 순 정렬
        allSurveys = Array.from(surveyMap.values()).map(s => s.data).sort((a, b) => {
            const numA = parseInt(a["번호"] || (a["학번"] ? String(a["학번"]).slice(-2) : 0));
            const numB = parseInt(b["번호"] || (b["학번"] ? String(b["학번"]).slice(-2) : 0));
            return numA - numB;
        });

        list.classList.remove("loading");
        renderSurveys();

    } catch (err) {
        list.classList.remove("loading");
        list.textContent = "❌ 기초조사 데이터를 불러올 수 없습니다.";
        console.error("Fetch Error:", err);
    }
}

function renderSurveys() {
    const list = document.getElementById("survey-list");
    const searchText = document.getElementById("search-input").value.trim().toLowerCase();
    const filterType = document.getElementById("filter-select").value;

    list.innerHTML = "";

    const filtered = allSurveys.filter(data => {
        // 검색어 필터링 (모든 값 중 하나라도 일치하면)
        if (searchText) {
            const matchesText = Object.values(data).some(val =>
                String(val).toLowerCase().includes(searchText)
            );
            if (!matchesText) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        list.innerHTML = "<div class='info-item'>조건에 맞는 데이터가 없습니다.</div>";
        return;
    }

    filtered.forEach(data => {
        const card = document.createElement("div");
        card.className = "survey-card";

        const displayNum = data["번호"] || (data["학번"] ? String(data["학번"]).slice(-2) : "??");
        const name = data["이름"] || "이름없음";

        // 카드 상단
        let html = `
            <div class="survey-header">
                <div class="survey-title">
                    <span class="survey-num">${displayNum}</span> ${name}
                </div>
            </div>
            <div class="survey-grid">
        `;

        // 보여줄 키 목록 결정 (빈 값 무시, 비밀번호 무시, PID 무시)
        const excludeKeys = ['비밀번호', '연번', 'PID', '학년', '반', '학생별시트', '이름', '학번', '번호'];
        let keysToShow = Object.keys(data).filter(k => data[k] && !excludeKeys.includes(k));

        // 필터링 타입에 따라 보여줄 항목 제한
        if (filterType === 'dreams') {
            keysToShow = ['나의꿈', '졸업후진로', '자신의장점', '취미', '특기'];
        } else if (filterType === 'mbti') {
            keysToShow = ['MBTI', '혈액형', '친한친구', '자신의성격']; // 자신의성격 등 추가 키가 있다면
        } else if (filterType === 'family') {
            keysToShow = ['거주가족', '주보호자관계', '주보호자연락처', '형제', '다문화여부'];
        }

        // 항상 중요한 연락처는 보여주고 싶다면 추가 (옵션)
        if (filterType !== 'all') {
            if (data['학생폰'] && !keysToShow.includes('학생폰')) keysToShow.unshift('학생폰');
        }

        keysToShow.forEach(key => {
            if (data[key]) {
                html += `
                    <div class="info-item">
                        <span class="info-label">${key}</span>
                        <span class="info-value">${data[key]}</span>
                    </div>
                `;
            }
        });

        html += `</div>`;
        card.innerHTML = html;
        list.appendChild(card);
    });
}
