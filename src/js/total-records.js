import { fetchGroupRecords, fetchAllStudents, getTeacherProfile } from './api.js';
import { extractDriveId, getThumbnailUrl, formatRelativeWithPeriod } from './utils.js';
import CryptoJS from 'crypto-js';
import { API_CONFIG } from './config.js';
import { initRealtimeNotifications } from './notification-service.js';

let allRecords = []; // 로드된 전체 기록 데이터 보관
let currentSort = 'num'; // 현재 정렬 상태 ('num', 'time', 'my-num', 'my-time')
let teacherClass = null; // 로그인된 선생님의 담당 학급 (예: "3-4")
let isPopupOpen = false; // 팝업 오픈 상태 플래그

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const grade = urlParams.get('grade');
    const classNum = urlParams.get('class');
    const sortParam = urlParams.get('sort');

    if (sortParam === 'time' || sortParam === 'latest') {
        currentSort = 'time';
    }

    await initTeacherAuth(); // 선생님 인증 및 학급 정보 로드
    updateTitle(grade, classNum);
    setupSortControls();

    // [New] 권한 체크를 위한 데이터 로딩
    const { fetchClassInfo, getTeacherProfile } = await import('./api.js');
    const email = getFullStoredEmail();
    if (email) {
        window.classInfoData = await fetchClassInfo();
        window.currentTeacher = await getTeacherProfile(email);
    }

    // 활동 로그 기록
    const { getCurrentTeacherEmail, logPageView } = await import('./api.js');
    const myEmail = getCurrentTeacherEmail();
    if (myEmail) {
        const pageLabel = grade && classNum ? `전체 기록 (${grade}-${classNum})` : "전체 기록 조회";
        logPageView(myEmail, pageLabel);
    }

    await loadRecords(grade, classNum);

    // [v5.10] 실시간 알림 가동
    initRealtimeNotifications();
});

async function initTeacherAuth() {
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (!encrypted) return;

    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
        const email = bytes.toString(CryptoJS.enc.Utf8);
        if (!email) return;

        const profile = await getTeacherProfile(email);
        if (profile && profile.assigned_class) {
            teacherClass = profile.assigned_class;
            // 담당 학반이 있는 경우 전용 버튼 노출
            document.getElementById('sort-my-num').style.display = 'inline-block';
            document.getElementById('sort-my-time').style.display = 'inline-block';
        }
    } catch (e) {
        console.error("Auth initialization failed:", e);
    }
}

// 페이지 제목 업데이트 (학년/반 표시)
function updateTitle(grade, classNum) {
    const titleEl = document.getElementById('page-title');
    if (grade && classNum) {
        titleEl.textContent = `${grade}학년 ${classNum}반 기록 모아보기`;
    } else {
        titleEl.textContent = '전체 기록 모아보기';
    }
}

// 정렬 버튼 이벤트 설정
function setupSortControls() {
    const btnNum = document.getElementById('sort-num');
    const btnTime = document.getElementById('sort-time');
    const btnMyNum = document.getElementById('sort-my-num');
    const btnMyTime = document.getElementById('sort-my-time');

    const updateActiveBtn = (sort) => {
        [btnNum, btnTime, btnMyNum, btnMyTime].forEach(btn => btn?.classList.remove('active'));
        if (sort === 'num' && btnNum) btnNum.classList.add('active');
        else if (sort === 'time' && btnTime) btnTime.classList.add('active');
        else if (sort === 'my-num' && btnMyNum) btnMyNum.classList.add('active');
        else if (sort === 'my-time' && btnMyTime) btnMyTime.classList.add('active');
    };

    if (currentSort === 'time') updateActiveBtn('time');

    btnNum.addEventListener('click', () => {
        if (currentSort === 'num') return;
        currentSort = 'num';
        updateActiveBtn(currentSort);
        renderRecords();
    });

    btnTime.addEventListener('click', () => {
        if (currentSort === 'time') return;
        currentSort = 'time';
        updateActiveBtn(currentSort);
        renderRecords();
    });

    btnMyNum.addEventListener('click', () => {
        if (currentSort === 'my-num') return;
        currentSort = 'my-num';
        updateActiveBtn(currentSort);
        renderRecords();
    });

    btnMyTime.addEventListener('click', () => {
        if (currentSort === 'my-time') return;
        currentSort = 'my-time';
        updateActiveBtn(currentSort);
        renderRecords();
    });
}

// 데이터 로드
async function loadRecords(grade, classNum) {
    const container = document.getElementById('log-container');
    const countEl = document.getElementById('total-count');

    try {
        // 로딩 애니메이션 시작
        container.innerHTML = '';
        container.classList.add('loading-records');

        // 기록 데이터 호출 (API에서 이름/사진이 포함되어 옴)
        const records = await fetchGroupRecords(grade, classNum);

        allRecords = records;

        // 로딩 종료
        container.classList.remove('loading-records');

        countEl.textContent = allRecords.length;

        if (allRecords.length === 0) {
            container.innerHTML = '<div class="loading-msg">표시할 기록이 없습니다.</div>';
            return;
        }

        renderRecords();
    } catch (error) {
        console.error(error);
        container.classList.remove('loading-records');
        container.innerHTML = '<div class="loading-msg">데이터 로드에 실패했습니다.</div>';
        countEl.textContent = '로드 실패';
    }
}

// 데이터 렌더링
function renderRecords() {
    const container = document.getElementById('log-container');
    container.innerHTML = '';

    // 1. 필터링 (우리반 모드일 경우)
    let filtered = [...allRecords];
    if (currentSort.startsWith('my-') && teacherClass) {
        const classPrefix = teacherClass.replace('-', '');
        filtered = allRecords.filter(r => String(r.num).startsWith(classPrefix));
    }

    // 2. 데이터 정렬
    const sorted = filtered.sort((a, b) => {
        if (currentSort === 'num' || currentSort === 'my-num') {
            // 학번 오름차순
            return String(a.num).localeCompare(String(b.num));
        } else {
            // 시간 내림차순 (최신순)
            return new Date(b.time) - new Date(a.time);
        }
    });

    sorted.forEach(record => {
        const card = createRecordCard(record);
        container.appendChild(card);
    });

    // 건수 업데이트 (필터링된 결과 기준)
    const countEl = document.getElementById('total-count');
    countEl.textContent = sorted.length;
}

// 레코드 카드 생성
function createRecordCard(record) {
    const div = document.createElement('div');
    div.className = 'log-card';

    // 시간 포맷
    const relativeTime = formatRelativeWithPeriod(record.time);
    const d = new Date(record.time);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = days[d.getDay()];
    const absoluteTime = `${d.getMonth() + 1}/${d.getDate()}(${dayName}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const fullTimeStr = `${relativeTime} (${absoluteTime})`;

    // 기록 유형에 따른 배경색 클래스 결정
    let typeClass = 'type-neutral';
    if (record.bad && !['기록', '생활기록', '일반'].includes(record.bad)) {
        typeClass = 'type-bad';
    } else if (record.good && !['기록', '생활기록', '일반'].includes(record.good)) {
        typeClass = 'type-good';
    }

    div.innerHTML = `
        <div class="card-inner">
            <div class="student-photo-area">
                <img src="${record.photo || ''}" alt="${record.name}" class="total-rec-photo" 
                     onclick='window.showStudentDetail(${JSON.stringify(record).replace(/'/g, "&#39;")})'
                     style="cursor: pointer;"
                     onerror="if(!this.dataset.retry){this.dataset.retry=true; const fid='${extractDriveId(record.photo)}'; if(fid) this.src='https://drive.google.com/thumbnail?id='+fid+'&sz=w500';} else {this.src='/default.png'}">
            </div>
            <div class="record-info-area">
                <div class="log-header">
                    <a href="record.html?num=${record.num}&name=${encodeURIComponent(record.name)}" class="student-info-link">
                        <span class="student-info">${record.num} ${record.name}</span>
                    </a>
                </div>
                <div class="log-content">${record.detail || '상세 내용 없음'}</div>
                <div class="log-footer-time">${fullTimeStr}</div>
                <div class="deed-tags">
                    ${record.photos && record.photos.length > 0 ? `<span class="tag" style="background: #f0f0f0; color: #555; border: 1px solid #ccc;">📷 사진</span>` : ''}
                    ${record.good && !['기록', '생활기록', '일반'].includes(record.good) ? `<span class="tag tag-good">${record.good}</span>` : ''}
                    ${record.bad && !['기록', '생활기록', '일반'].includes(record.bad) ? `<span class="tag tag-bad">${record.bad}</span>` : ''}
                </div>
            </div>
        </div>
    `;
    return div;
}

// === 학생 상세 팝업 로직 (student.js에서 이식) ===

const intimacyMap = { "1": "매우 소원함", "2": "소원함", "3": "보통", "4": "친밀함", "5": "매우 친밀함" };

function getFullStoredEmail() {
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (!encrypted) return "";
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) { return ""; }
}

function getValue(obj1, obj2, ...keys) {
    const combined = { ...obj1, ...obj2 };
    for (let key of keys) {
        let val = combined[key];
        if (val !== undefined && val !== null && String(val).trim() !== "" && String(val).trim() !== ".") return String(val).trim();
        const upper = key.toUpperCase();
        let valU = combined[upper];
        if (valU !== undefined && valU !== null && String(valU).trim() !== "" && String(valU).trim() !== ".") return String(valU).trim();
    }
    return "";
}

function createInfoRow(label, val) {
    let valStr = String(val || "").trim();
    if (valStr === "" || valStr === "null" || valStr === "undefined" || valStr === "없음") valStr = ".";
    let displayVal = valStr;
    if (label.includes("친밀도") && intimacyMap[valStr]) displayVal = intimacyMap[valStr];

    const isPhone = (label.includes("전화") || label.includes("연락처") || (label.includes("번호") && label !== "번호" && label !== "학번" && !label.includes("우편")) || label.includes("폰"));
    if (isPhone && valStr !== "." && valStr.length > 5) {
        const cleanPhone = valStr.replace(/[^0-9]/g, "");
        displayVal = `<div style="display: flex; align-items: center; gap: 8px;"><span>${valStr}</span><a href="tel:${cleanPhone}" style="display: inline-flex; align-items: center; justify-content: center; background: #fee2e2; color: #ef4444; width: 28px; height: 28px; border-radius: 50%; text-decoration: none;">📞</a></div>`;
    }

    return `<div class="detail-info-row"><span class="detail-label">${label}</span><span class="detail-value">${displayVal}</span></div>`;
}

window.showStudentDetail = async function (record) {
    if (isPopupOpen) return; 

    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (!popup || !overlay) return;

    console.log("Opening student detail for:", record.name);
    isPopupOpen = true; 
    history.pushState({ popup: true }, ""); // 먼저 히스토리 상태를 밀어넣어 동기화
    
    overlay.style.display = "block";
    popup.style.display = "block";
    popup.className = "student-detail-popup";
    document.body.style.overflow = "hidden";
    
    // 로딩 표시 (데이터 가져오는 동안)
    popup.innerHTML = `
        <div class="popup-header">
            <button class="popup-back-btn" onclick="history.back()" style="width: 44px; height: 44px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; cursor: pointer;">
                <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: #64748b;"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <div class="popup-title-center">자료를 가져오는 중...</div>
            <div style="width: 44px;"></div>
        </div>
        <div style="padding:40px; text-align:center; color:#666;">데이터를 불러오고 있습니다...</div>
    `;

    try {
        const { supabase } = await import('./api.js');
        let surveyRaw = {};
        const { data } = await supabase.from('surveys').select('*').eq('student_pid', record.pid).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
        if (data) surveyRaw = { ...data, ...(data.data || {}) };

        const studentData = { "학번": record.num, "이름": record.name, "사진저장링크": record.photo };
        const surveyData = {};
        for (let k in surveyRaw) surveyData[k.toUpperCase()] = surveyRaw[k];

        // 권한 확인 (본인 학급 담임/부담임 여부 또는 관리자)
        const numInt = parseInt(record.num);
        const gradeNum = Math.floor(numInt / 1000);
        const classNum = Math.floor((numInt % 1000) / 100);
        const myEmail = getFullStoredEmail() || "";
        const cleanEmail = myEmail.toLowerCase();
        const currentClassInfo = window.classInfoData ? window.classInfoData.find(c => c.grade === gradeNum && c.class === classNum) : null;

        // [M2] 하드코딩 이메일 제거 → 역할/권한 기반
        const ct = window.currentTeacher || {};
        const isAdmin = ct.role === 'admin' || ct.role === 'counselor'
            || (ct.permissions?.records?.read === 'all') || Object.values(ct.permissions?.admin || {}).some(Boolean);

        const isAuthorized = isAdmin || (currentClassInfo && (
            currentClassInfo.homeroomEmail === myEmail ||
            currentClassInfo.subEmail === myEmail
        ));

        let infoHtml2 = createInfoRow("연락처", getValue(studentData, surveyRaw, "연락처", "학생폰")) +
                       createInfoRow("인스타id", getValue(studentData, surveyRaw, "인스타id", "인스타")) +
                       createInfoRow("집주소", getValue(studentData, surveyRaw, "주소", "집주소")) +
                       createInfoRow("학적", getValue(studentData, surveyRaw, "학적")) +
                       createInfoRow("성별", getValue(studentData, surveyRaw, "성별"));

        let infoHtml3 = createInfoRow("주보호자 관계", getValue(surveyRaw, {}, "주보호자 관계")) +
                       createInfoRow("주보호자 연락처", getValue(surveyRaw, {}, "주보호자 연락처")) +
                       createInfoRow("주보호자 친밀도", getValue(surveyRaw, {}, "주보호자 친밀도")) +
                       createInfoRow("보조보호자 관계", getValue(surveyRaw, {}, "보조보호자 관계")) +
                       createInfoRow("거주가족", getValue(surveyRaw, {}, "거주가족"));

        let infoHtml4 = getValue(surveyRaw, {}, "장점", "특기", "나의꿈") || "상세 정보 없음";

        if (!isAuthorized) {
            infoHtml3 = `<div class="no-access-msg" style="padding:20px; text-align:center; color:#999; font-size:0.9em;">
                🔒 가족 정보와 연락처는<br>담임/부담임 선생님만 조회가 가능합니다.
            </div>`;
            infoHtml4 = `<div class="no-access-msg" style="padding:20px; text-align:center; color:#999; font-size:0.9em;">
                🔒 상세 기초조사 내용은<br>담임/부담임 선생님 전용 정보입니다.
            </div>`;
        }

        const photoImg = record.photo ? `<img src="${record.photo}" alt="${record.name}">` : `<div class="no-photo-placeholder">📷<br>사진 없음</div>`;

        popup.innerHTML = `
            <div class="popup-header">
                <button class="popup-back-btn" onclick="history.back()" style="width: 44px; height: 44px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; cursor: pointer;">
                    <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: #64748b;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
                <div class="popup-title-center">
                    <span class="student-id-badge">${record.num}</span>
                    <span class="student-name-text">${record.name}</span>
                    <button class="popup-record-btn" onclick="location.href='record.html?num=${record.num}&name=${encodeURIComponent(record.name)}'">📝 생활기록</button>
                </div>
                <div style="width: 44px;"></div>
            </div>
            <div class="popup-content-layout">
                <div class="popup-quadrants-container">
                    <div class="popup-quadrant quad-1"><div class="quad-inner"><div class="quad-label">사진</div><div class="photo-wrapper">${photoImg}</div></div></div>
                    <div class="popup-quadrant quad-2"><div class="quad-inner"><div class="quad-label">기본 정보</div><div class="quad-scroll">${infoHtml2}</div></div></div>
                    <div class="popup-quadrant quad-3"><div class="quad-inner"><div class="quad-label">가족 정보</div><div class="quad-scroll">${infoHtml3}</div></div></div>
                    <div class="popup-quadrant quad-4"><div class="quad-inner"><div class="quad-label">학생 상담/기타</div><div class="quad-scroll">${infoHtml4}</div></div></div>
                </div>
            </div>
        `;
    } catch (err) {
        console.error("Popup load failed:", err);
        popup.innerHTML = `
            <div class="popup-header">
                <button class="popup-back-btn" onclick="history.back()" style="width: 44px; height: 44px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; cursor: pointer;">
                    <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: #64748b;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
                <div class="popup-title-center">오류 발생</div>
                <div style="width: 44px;"></div>
            </div>
            <div style="padding:40px; text-align:center; color:red;">자료를 불러오는데 실패했습니다.</div>
        `;
    }

    overlay.onclick = () => history.back();
}

window.addEventListener('popstate', (e) => {
    console.log("Popstate triggered! isPopupOpen:", isPopupOpen);
    // 히스토리 변화 시 팝업 닫기
    closePopup();
});

// 전역 ESC 키 리스너 (한 번만 등록)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPopupOpen) {
        console.log("Escape key pressed while popup open");
        history.back();
    }
});

window.closePopup = function () {
    console.log("Closing popup UI");
    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (popup) popup.style.display = "none";
    if (overlay) overlay.style.display = "none";
    document.body.style.overflow = "";
    isPopupOpen = false; // 플래그 해제
}
