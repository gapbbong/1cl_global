import { fetchClassSurveys, getTeacherProfile, fetchClassRecords, fetchClassInfo, getCurrentTeacherEmail } from './api.js';
import CryptoJS from 'crypto-js';
import { loadSchool, classOptions } from './school.js';

const SECRET_KEY = 'oneclass25-secret-auth-key';

document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    let grade = urlParams.get('grade');
    let classNum = urlParams.get('class');

    // 학급 선택기 초기화 [M2] school_units 기반
    await loadSchool().catch(() => {});
    const classSelector = document.getElementById("class-selector");
    classOptions().forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.innerText = `${o.label} 분석 리포트`;
        classSelector.appendChild(opt);
    });

    const userEmail = getCurrentTeacherEmail();
    let userProfile = null;

    if (userEmail) {
        userProfile = await getTeacherProfile(userEmail);
        if (userProfile && (!grade || !classNum)) {
            if (userProfile.assigned_class) {
                [grade, classNum] = userProfile.assigned_class.split('-');
            } else if (userProfile.role === 'admin') {
                grade = "1"; classNum = "1";
            }
        }
    }

    if (!grade || !classNum) {
        grade = "1"; classNum = "1"; // 기본값
    }

    classSelector.value = `${grade}-${classNum}`;
    
    // 데이터 로드 함수 정의
    const loadAnalysisData = async (g, c) => {
        const classInfo = `${g}-${c}`;
        const loadingOverlay = document.getElementById("loading-overlay");
        loadingOverlay.classList.remove("hidden");

        try {
            // 권한 체크
            const classList = await fetchClassInfo();
            const info = classList.find(i => i.grade === parseInt(g) && i.class === parseInt(c));
            
            const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'counselor'
                || Object.values(userProfile?.permissions?.admin || {}).some(Boolean);
            const isHomeroom = info && (info.homeroomEmail === userEmail || info.subEmail === userEmail);
            const hasFullAccess = isAdmin || isHomeroom;

            // UI 제어
            const recordsSection = document.getElementById("records-section");
            const aiSection = document.querySelector(".ai-analysis");
            const pendingList = document.getElementById("pending-list-container");
            const permissionNotice = document.getElementById("permission-notice");

            if (hasFullAccess) {
                recordsSection.classList.remove("hidden");
                aiSection?.classList.remove("hidden");
                permissionNotice.classList.add("hidden");
            } else {
                recordsSection.classList.add("hidden");
                aiSection?.classList.add("hidden");
                permissionNotice.classList.remove("hidden");
            }

            // [New] 페이지 뷰 로그
            const { logPageView } = await import('./api.js');
            logPageView(userEmail, `학급 분석 (${classInfo}) ${hasFullAccess ? '[담임]' : '[일반]'}`);

            const studentData = await fetchClassSurveys(classInfo);
            renderStatus(studentData, hasFullAccess);

            // 우리반 기록 초기화 (로딩 표시 포함)
            const listElement = document.getElementById("class-records-list");
            listElement.innerHTML = '<p class="text-muted">기록을 불러오는 중...</p>';
            
            const records = await fetchClassRecords(classInfo);
            initClassRecords(classInfo, studentData, records, hasFullAccess);

            const doneStudents = studentData.filter(s => s.survey);
            if (doneStudents.length < studentData.length) {
                document.getElementById("incomplete-notice").classList.remove("hidden");
            } else {
                document.getElementById("incomplete-notice").classList.add("hidden");
                startAnalysis(doneStudents, hasFullAccess);
            }

            document.getElementById("force-analyze-btn").onclick = () => {
                document.getElementById("incomplete-notice").classList.add("hidden");
                startAnalysis(doneStudents, hasFullAccess);
            };

        } catch (error) {
            console.error("Analysis Load Error:", error);
            alert("데이터를 불러오는 중 오류가 발생했습니다.");
        } finally {
            loadingOverlay.classList.add("hidden");
        }
    };

    classSelector.onchange = (e) => {
        const [g, c] = e.target.value.split('-');
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('grade', g);
        newUrl.searchParams.set('class', c);
        window.history.pushState({}, '', newUrl);
        loadAnalysisData(g, c);
    };

    // 초기 실행
    loadAnalysisData(grade, classNum);
});

function renderStatus(data, hasFullAccess = true) {
    const doneCount = data.filter(s => s.survey).length;
    const pendingCount = data.length - doneCount;

    document.getElementById("done-count").innerText = doneCount;
    document.getElementById("pending-count").innerText = pendingCount;

    const totalStatus = document.getElementById("total-status");
    if (pendingCount === 0) {
        totalStatus.innerText = "제출 완료";
        totalStatus.style.backgroundColor = "#34c759";
    } else {
        totalStatus.innerText = "진행 중";
        totalStatus.style.backgroundColor = "#ff9500";
    }

    const containerWrapper = document.getElementById("pending-list-container");
    if (pendingCount > 0 && hasFullAccess) {
        // 미제출자 명단: 학번순 정렬 (마지막 2자리 기준) 후 'XX번 이름' 형식으로 표시
        const pendingStudents = data.filter(s => !s.survey)
            .sort((a, b) => {
                const numA = parseInt(a.student_id.toString().slice(-2));
                const numB = parseInt(b.student_id.toString().slice(-2));
                return numA - numB;
            });

        const container = document.getElementById("pending-names");
        container.innerHTML = pendingStudents.map(s => {
            const numStr = s.student_id ? s.student_id.toString().slice(-2).padStart(2, '0') : '??';
            return `<span class="name-tag">${numStr}번 ${s.name}</span>`;
        }).join('');
        containerWrapper.classList.remove("hidden");
    } else {
        containerWrapper.classList.add("hidden");
    }
}

function startAnalysis(doneStudents, hasFullAccess = true) {
    // 부모 컨테이너는 항상 노출 (통계 섹션이 포함되어 있음)
    document.getElementById("analysis-results").classList.remove("hidden");

    // 1. 통계 계산 (권한과 상관없이 표시)
    renderStats(doneStudents);

    // 2. AI 분석 (권한이 있을 때만 렌더링 - 섹션 노출 제어는 loadAnalysisData에서 이미 처리됨)
    if (hasFullAccess) {
        renderAIAnalysis(doneStudents);
    }
}

function renderStats(students) {
    const surveys = students.map(s => s.survey?.data || {});
    const total = students.length;

    // 1. 기본 정보 그룹
    // 성별
    const genderMap = { "남": 0, "여": 0 };
    surveys.forEach(d => { if (d['성별']) genderMap[d['성별']]++; });
    renderBarChart("stats-gender", [
        { label: "남학생", count: genderMap["남"], color: "#007aff" },
        { label: "여학생", count: genderMap["여"], color: "#ff2d55" }
    ], total);

    // 혈액형
    const bloodMap = { "A": 0, "B": 0, "O": 0, "AB": 0 };
    surveys.forEach(d => { if (d['혈액형']) bloodMap[d['혈액형']]++; });
    renderBarChart("stats-blood", [
        { label: "A형", count: bloodMap["A"], color: "#ff3b30" },
        { label: "B형", count: bloodMap["B"], color: "#5856d6" },
        { label: "O형", count: bloodMap["O"], color: "#ff9500" },
        { label: "AB형", count: bloodMap["AB"], color: "#34c759" }
    ], total);

    // MBTI E vs I
    const eiMap = { "E (외향)": 0, "I (내향)": 0 };
    surveys.forEach(d => {
        const m = (d['MBTI'] || "").toUpperCase();
        if (m.startsWith('E')) eiMap["E (외향)"]++;
        else if (m.startsWith('I')) eiMap["I (내향)"]++;
    });
    renderBarChart("stats-mbti-ei", [
        { label: "E (외향)", count: eiMap["E (외향)"], color: "#ff2d55" },
        { label: "I (내향)", count: eiMap["I (내향)"], color: "#5856d6" }
    ], total);

    // MBTI N vs S
    const nsMap = { "N (직관)": 0, "S (감각)": 0 };
    surveys.forEach(d => {
        const m = (d['MBTI'] || "").toUpperCase();
        if (m[1] === 'N') nsMap["N (직관)"]++;
        else if (m[1] === 'S') nsMap["S (감각)"]++;
    });
    renderBarChart("stats-mbti-ns", [
        { label: "N (직관)", count: nsMap["N (직관)"], color: "#af52de" },
        { label: "S (감각)", count: nsMap["S (감각)"], color: "#ffcc00" }
    ], total);

    // 2. 가족 및 생활 그룹
    // 형제 관계
    const siblingCounts = { "외동": 0, "첫째": 0, "둘째": 0, "셋째+": 0 };
    surveys.forEach(d => {
        const s = d['형제'] || "";
        if (s.includes("외동")) siblingCounts["외동"]++;
        else if (s.includes("첫째")) siblingCounts["첫째"]++;
        else if (s.includes("둘째")) siblingCounts["둘째"]++;
        else if (s.match(/[셋넷다섯]째/)) siblingCounts["셋째+"]++;
    });
    renderBarChart("stats-siblings", [
        { label: "외동", count: siblingCounts["외동"], color: "#5ac8fa" },
        { label: "첫째", count: siblingCounts["첫째"], color: "#4cd964" },
        { label: "둘째", count: siblingCounts["둘째"], color: "#ffcc00" },
        { label: "셋째 이상", count: siblingCounts["셋째+"], color: "#8e8e93" }
    ], total);

    // 거주 가족
    renderFrequencyChart("stats-family", surveys, '거주가족', "#5856d6", 4);

    // 반려동물
    renderFrequencyChart("stats-pets", surveys, '반려동물', "#ff9500", 4);

    // 등교 수단
    renderFrequencyChart("stats-commute", surveys, '등교수단', "#34c759", 4);

    // 3. 학습 및 진로 그룹
    // 졸업 후 진로
    renderFrequencyChart("stats-postgrad", surveys, '졸업후진로', "#007aff", 4);

    // 종교
    renderFrequencyChart("stats-religion", surveys, '종교', "#af52de", 4);

    // 출신 중학교 TOP 5
    renderTopList("stats-schools", surveys, '출신중', 5);

    // 게임 TOP 5
    renderTopList("stats-games", surveys, '자주하는게임', 5, true);

    // 키워드 태그 (꿈, 취미/특기)
    renderKeywordTags("stats-dreams", surveys, '나의꿈');
    renderKeywordTags("stats-hobbies", surveys, ['취미', '특기']);
}

function renderBarChart(containerId, data, total) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (data.every(d => d.count === 0)) {
        container.innerHTML = '<p class="text-muted" style="font-size:0.8rem;">데이터 없음</p>';
        return;
    }

    container.innerHTML = data.map(item => {
        const percent = total > 0 ? (item.count / total * 100) : 0;
        return `
            <div class="chart-bar-row">
                <div class="label-row">
                    <span>${item.label}</span>
                    <span>${item.count}명 (${Math.round(percent)}%)</span>
                </div>
                <div class="chart-bar-bg">
                    <div class="chart-bar-fill" style="width: ${percent}%; background-color: ${item.color};"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderFrequencyChart(id, surveys, field, color, limit) {
    const map = {};
    surveys.forEach(d => {
        const val = d[field] || "미응답";
        if (val !== "없음" && val !== "해당없음") {
            map[val] = (map[val] || 0) + 1;
        }
    });
    const data = Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, count]) => ({ label, count, color }));
    renderBarChart(id, data, surveys.length);
}

function renderTopList(id, surveys, field, limit, split = false) {
    const map = {};
    surveys.forEach(d => {
        const val = d[field];
        if (val && val !== "없음" && val !== "X" && val !== "미응답") {
            if (split) {
                const items = val.split(/[,\/\s]+/).filter(x => x.length > 1);
                items.forEach(item => { map[item] = (map[item] || 0) + 1; });
            } else {
                map[val] = (map[val] || 0) + 1;
            }
        }
    });
    const top = Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

    const container = document.getElementById(id);
    if (!container) return;

    container.innerHTML = top.length > 0
        ? top.map(([name, count]) => `<div class="list-item"><span>${name}</span> <strong>${count}명</strong></div>`).join('')
        : '<p class="text-muted">데이터 없음</p>';
}

function renderKeywordTags(id, surveys, fields) {
    const fieldList = Array.isArray(fields) ? fields : [fields];
    const map = {};
    surveys.forEach(d => {
        fieldList.forEach(f => {
            const val = d[f];
            if (val && val !== "없음" && val !== "X" && val !== "미응답") {
                const words = val.split(/[,\/\s]+/).filter(x => x.length > 1);
                words.forEach(word => { map[word] = (map[word] || 0) + 1; });
            }
        });
    });
    const top = Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const container = document.getElementById(id);
    if (!container) return;

    container.innerHTML = top.length > 0
        ? top.map(([word]) => `<span class="tag">${word}</span>`).join('')
        : '<p class="text-muted">데이터 없음</p>';
}

function renderAIAnalysis(students) {
    // 1. 리더십 분석 (전과 동일)
    const leaderKeywords = ["리더", "적극", "책임", "반장", "회장", "성실", "목표", "열정", "희생", "배려", "성실"];
    const scoredStudents = students.map(s => {
        let score = 0;
        const d = s.survey?.data || {};
        const text = (d['자신의장점'] || "") + (d['특기'] || "") + (d['1년다짐'] || "") + (d['나의꿈'] || "");
        leaderKeywords.forEach(kw => {
            if (text.includes(kw)) score += 1;
        });
        if ((d['MBTI'] || "").toUpperCase().startsWith('E')) score += 0.5;
        return { ...s, score };
    }).sort((a, b) => b.score - a.score);

    const leadershipList = document.getElementById("leadership-list");
    const updateLeadership = (count) => {
        const top = scoredStudents.slice(0, count);
        leadershipList.innerHTML = top.map((s, i) => `
            <div class="ai-item">
                <span class="rank">${i + 1}위</span>
                <span class="student-tag" onclick="location.href='record.html?num=${s.student_id}&name=${encodeURIComponent(s.name)}'">
                    ${s.student_id ? s.student_id.toString().slice(-2).padStart(2, '0') : '??'}번 ${s.name}
                </span>
                <span class="text-muted" style="font-size:0.75rem;">(추천 근거: ${s.score > 0 ? '리더십 키워드 감지' : '잠재적 역량'})</span>
            </div>
        `).join('');
    };

    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            updateLeadership(parseInt(btn.dataset.count));
        };
    });
    updateLeadership(3);

    // 2. 상담 시급도 분석 (개선된 로직)
    // - L4 (위험): 위험 키워드 감지 OR 부모 친밀도 매우 낮음(1이하) OR 고립(친한 친구 없음)
    // - L3 (주의): 주의 키워드 감지 OR 보건 특이점 존재 OR 텍스트 길음
    // - L2 (관심): 단점/바라는점 등에 10자 이상 작성
    // - L1 (보통): 특이사항 없음

    const riskKeywords = ["죽고", "자살", "우울", "폭력", "가정", "불화", "가출", "괴롭힘", "왕따", "힘들어", "지침", "포기", "질병", "아픔"];
    const highKeywords = ["진로", "성적", "성격", "친구", "스트레스", "대인관계", "불안", "걱정", "고민"];

    const levels = { L4: [], L3: [], L2: [], L1: [] };

    students.forEach(s => {
        const d = s.survey?.data || {};
        const text = (d['선생님바라는점'] || "") + (d['보건특이점'] || "") + (d['자신의단점'] || "");
        const parentIntimacy = parseInt(d['주보호자친밀도']) || 5;
        const friends = d['친한친구'] || "";
        const healthFlag = (d['보건특이점'] || "").replace("없음", "").replace("해당없음", "").trim();

        let level = "L1";

        // 1순위: 위험 키워드 또는 부모 친밀도 매우 낮음 또는 교우관계 고립
        if (riskKeywords.some(kw => text.includes(kw)) || parentIntimacy <= 1 || (friends === "없음" || friends === ".")) {
            level = "L4";
        }
        // 2순위: 주의 키워드 또는 보건 특이점 또는 장문(고민 가능성)
        else if (highKeywords.some(kw => text.includes(kw)) || healthFlag.length > 0 || text.length > 50) {
            level = "L3";
        }
        // 3순위: 단순 기록 존재
        else if (text.length > 10 && text !== "없음" && text !== "해당없음") {
            level = "L2";
        }

        levels[level].push(s);
    });

    const renderLevel = (id, list) => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = list.length > 0
            ? list.map(s => `
                <span class="student-tag" onclick="location.href='record.html?num=${s.student_id}&name=${encodeURIComponent(s.name)}&mode=counsel'">
                    ${s.student_id ? s.student_id.toString().slice(-2).padStart(2, '0') : '??'}번 ${s.name}
                </span>`).join('')
            : '<span class="text-muted" style="font-size:0.8rem;">대상자 없음</span>';
    };

    renderLevel("priority-l4", levels.L4);
    renderLevel("priority-l3", levels.L3);
    renderLevel("priority-l2", levels.L2);
    renderLevel("priority-l1", levels.L1);
}

async function initClassRecords(classInfo, studentData, records = [], hasFullAccess = true) {
    const listElement = document.getElementById("class-records-list");
    const sortByIdBtn = document.getElementById("sort-by-id");
    const sortByDateBtn = document.getElementById("sort-by-date");

    if (!hasFullAccess) {
        document.getElementById("records-section").classList.add("hidden");
        return;
    }

    let currentSort = 'date'; // 'id' or 'date'

    // 초기 로드: 자동으로 기록을 가져와서 렌더링
    renderClassRecords(records, currentSort, studentData);

    sortByIdBtn.onclick = () => {
        if (currentSort === 'id') return;
        currentSort = 'id';
        sortByIdBtn.classList.add("active");
        sortByDateBtn.classList.remove("active");
        renderClassRecords(records, currentSort, studentData);
    };

    sortByDateBtn.onclick = () => {
        if (currentSort === 'date') return;
        currentSort = 'date';
        sortByDateBtn.classList.add("active");
        sortByIdBtn.classList.remove("active");
        renderClassRecords(records, currentSort, studentData);
    };
}

function renderClassRecords(records, sortBy, allStudents = []) {
    const listElement = document.getElementById("class-records-list");
    if (records.length === 0) {
        listElement.innerHTML = '<p class="text-muted">등록된 기록이 없습니다.</p>';
        return;
    }

    const sorted = [...records].sort((a, b) => {
        if (sortBy === 'id') {
            return a.num.localeCompare(b.num);
        } else {
            return new Date(b.time) - new Date(a.time);
        }
    });

    listElement.innerHTML = sorted.map(r => {
        const dateStr = new Date(r.time).toLocaleString('ko-KR', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const numStr = r.num.slice(-2).padStart(2, '0');

        // 인스타 아이디 찾기
        const student = allStudents.find(s => s.student_id.toString() === r.num.toString());
        const instaId = student?.survey?.data?.['인스타 아이디'] || student?.survey?.data?.['인스타'] || "";
        const cleanInstaId = instaId.replace('@', '').trim();
        const instaIcon = cleanInstaId ? `
            <a href="https://instagram.com/${cleanInstaId}" target="_blank" class="insta-link-sm" onclick="event.stopPropagation()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.162 6.162 6.162 6.162-2.759 6.162-6.162-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
            </a>` : "";

        const tagClass = r.good ? 'good' : (r.bad ? 'bad' : '');
        const tagName = r.good || r.bad || '일반';

        return `
            <div class="record-log-item">
                <div class="log-header">
                    <span class="student-name" onclick="location.href='record.html?num=${r.num}&name=${encodeURIComponent(r.name)}'">
                        ${numStr}번 ${r.name} ${instaIcon}
                    </span>
                    <span>${dateStr}</span>
                </div>
                <div class="log-content">
                    <span class="tag ${tagClass}">${tagName}</span>
                    ${r.detail}
                </div>
            </div>
        `;
    }).join('');
}
