import { supabase, supabaseRealtime } from './supabase.js';
import { fetchAllStudents, bulkSaveRecords } from './api.js';

document.addEventListener("DOMContentLoaded", async () => {
    await checkAuth();
    loadTodayRecords();
    subscribeToChanges();
    initLogout();

    // 활동 로그 기록
    const { getCurrentTeacherEmail, logPageView } = await import('./api.js');
    const myEmail = getCurrentTeacherEmail();
    if (myEmail) {
        logPageView(myEmail, "지킴이 대시보드");
    }
});

// [M2] 지킴이 역할(gatekeeper) 검증
async function checkAuth() {
    try {
        const { verifySession } = await import('./supabase.js');
        const s = await verifySession();
        const role = s && (s.role || s.role_key);
        if (!s || (!s.offline && role && role !== 'gatekeeper')) {
            location.href = `index.html${location.search}`;
        }
    } catch { /* 오프라인 시 통과 */ }
}

// 상단 타이머 부분 제거 (사용자 요청에 따라 HTML에서 요소가 삭제됨)

// 오늘 날짜의 조퇴/외출 데이터 로드 (KST 기준)
async function loadTodayRecords() {
    document.getElementById("loading-view").style.display = "block";
    document.getElementById("empty-view").style.display = "none";
    document.getElementById("record-grid").innerHTML = "";

    const today = new Date();
    // 자바스크립트 Date 객체는 내부적으로 로컬 타임존(KST)을 인식하여 UTC로 변환해주므로, 
    // 수동으로 9시간을 뺄 필요가 없습니다. (수동으로 빼면 오히려 시간이 과거로 틀어집니다.)
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

    const startUtc = startOfToday.toISOString();
    const endUtc = endOfToday.toISOString();

    const { data: records, error } = await supabase
        .from('life_records')
        .select(`
            id, created_at, category, content, teacher_email_prefix,
            students!inner ( student_id, name, photo_url, class_info )
        `)
        .eq('category', '근태')
        .or('content.ilike.%조퇴%,content.ilike.%외출%')
        .gte('created_at', startUtc)
        .lte('created_at', endUtc)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("외출 기록 로드 실패:", error);
        document.getElementById("loading-view").innerText = "데이터를 불러오는 데 실패했습니다. (권한 또는 필드 오류)";
        return;
    }

    renderRecords(records || []);
}

// 화면 렌더링
function renderRecords(records) {
    document.getElementById("loading-view").style.display = "none";

    if (!records || records.length === 0) {
        document.getElementById("empty-view").style.display = "block";
        document.getElementById("out-count").innerText = "0";
        document.getElementById("early-count").innerText = "0";
        return;
    }

    let outCount = 0;
    let earlyCount = 0;
    const grid = document.getElementById("record-grid");
    grid.innerHTML = "";

    records.forEach(r => {
        let isOut = r.content.includes("외출");
        let isEarly = r.content.includes("조퇴");

        if (isOut) outCount++;
        else if (isEarly) earlyCount++;

        const typeClass = isOut ? 'type-out' : 'type-early';
        const typeLabel = isOut ? '🏃 외출' : '🏠 조퇴';

        // 날짜/시간 포맷 (만들어진 시간 = 외출증 발급 시간)
        const recordDate = new Date(r.created_at);
        const timeStr = `${String(recordDate.getHours()).padStart(2, '0')}:${String(recordDate.getMinutes()).padStart(2, '0')} 발급`;

        const studentInfo = r.students || {};

        const defaultPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(studentInfo.name || '학생')}&background=e2e8f0&color=475569`;
        const photoUrl = studentInfo.photo_url || defaultPhoto;

        let displayTeacher = r.teacher_email_prefix || '시스템';
        if (displayTeacher === 'keeper' || displayTeacher.includes('keeper')) {
            displayTeacher = 'ke****';
        }

        grid.innerHTML += `
            <div class="record-card ${typeClass}">
                <div class="card-header">
                    <span class="card-type">${typeLabel}</span>
                    <span class="card-time">${timeStr}</span>
                </div>
                <div class="card-profile">
                    <img class="student-photo" src="${photoUrl}" alt="${studentInfo.name} 사진" onerror="this.src='${defaultPhoto}'">
                    <div class="student-info">
                        <div class="card-class">${studentInfo.class_info || '학급 미상'}</div>
                        <div class="card-student">${studentInfo.name || '알 수 없음'} <span style="font-size: 1.8rem; color:#64748b;">(${studentInfo.student_id || ''})</span></div>
                    </div>
                </div>
                <div class="card-detail">${r.content}</div>
                <div style="text-align:right; font-size:1.1rem; color:#94a3b8; margin-top:10px;">확인 교사: ${displayTeacher}</div>
            </div>
        `;
    });

    document.getElementById("out-count").innerText = outCount;
    document.getElementById("early-count").innerText = earlyCount;
}

// 실시간 자동 갱신 (담임이 작성하면 화면에 즉각 표시)
function subscribeToChanges() {
    if (!supabaseRealtime) return; // realtime disabled (no anon key configured)
    console.log("📡 실시간 데이터 연동을 시작합니다...");
    supabaseRealtime
        .channel('public:life_records')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'life_records' }, payload => {
            console.log("🔔 새로운 기록 감지:", payload.new);
            const newRecord = payload.new;
            if (newRecord.category === '근태' && (newRecord.content.includes('외출') || newRecord.content.includes('조퇴'))) {
                console.log("✨ 외출/조퇴 데이터이므로 화면을 갱신합니다.");
                loadTodayRecords();
            }
        })
        .subscribe((status) => {
            console.log("🌐 실시간 채널 연결 상태:", status);
        });
}

function initLogout() {
    document.getElementById("logout-btn").addEventListener("click", () => {
        if (confirm("지킴이 대시보드에서 로그아웃 하시겠습니까?")) {
            localStorage.removeItem("teacher_auth_token");
            localStorage.removeItem("oc_session");
            location.href = "index.html";
        }
    });
}

// [신규] 지킴이 전용 일괄 기록 모달 오픈
window.openBulkRecordModal = async function () {
    // 1. 모달 오버레이 생성
    const overlay = document.createElement("div");
    overlay.className = "bulk-record-overlay";
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.8); backdrop-filter:blur(8px); display:flex; justify-content:center; align-items:center; z-index:9999; animation:fadeIn 0.2s ease;";

    overlay.innerHTML = `
        <div class="bulk-record-card" style="background:white; width:90%; max-width:600px; padding:30px; border-radius:32px; box-shadow:0 30px 60px rgba(0,0,0,0.4); animation:modalIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:25px;">
                <h2 style="font-size:1.8rem; font-weight:800; color:#1e293b; margin:0;">📋 지킴이 일괄 기록</h2>
                <button onclick="this.closest('.bulk-record-overlay').remove()" style="background:#f1f5f9; border:none; width:40px; height:40px; border-radius:50%; cursor:pointer; font-size:1.2rem; color:#64748b;">✕</button>
            </div>

            <div style="margin-bottom:20px;">
                <label style="display:block; font-size:1rem; font-weight:700; color:#64748b; margin-bottom:10px;">대상 학생 검색 및 선택</label>
                <div style="position:relative; margin-bottom:15px;">
                    <input type="text" id="student-search-input" placeholder="학생 이름 또는 학번 입력..." style="width:100%; padding:15px 20px; border-radius:15px; border:2px solid #e2e8f0; font-size:1.2rem; outline:none; transition:border-color 0.2s;">
                    <div id="search-result-dropdown" style="display:none; position:absolute; top:100%; left:0; width:100%; background:white; border:1px solid #e2e8f0; border-radius:15px; box-shadow:0 10px 20px rgba(0,0,0,0.1); max-height:200px; overflow-y:auto; z-index:100; margin-top:5px;"></div>
                </div>
                <div id="selected-students-tags" style="display:flex; flex-wrap:wrap; gap:8px; min-height:45px; padding:10px; background:#f8fafc; border-radius:15px; border:1px dashed #cbd5e1;">
                    <span style="color:#94a3b8; font-size:0.9rem;">학생을 검색하여 선택해주세요.</span>
                </div>
            </div>

            <div style="margin-bottom:20px;">
                <label style="display:block; font-size:1rem; font-weight:700; color:#64748b; margin-bottom:10px;">지도 카테고리</label>
                <div id="bulk-category-grid" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
                    ${['생활지도', '태도', '복장', '기타'].map(cat => `
                        <button class="bulk-cat-btn" onclick="selectBulkCategory(this, '${cat}')" style="padding:12px; border-radius:12px; border:1.5px solid #e2e8f0; background:white; font-weight:700; cursor:pointer; transition:all 0.2s;">${cat}</button>
                    `).join('')}
                </div>
                <input type="hidden" id="selected-bulk-category" value="생활지도">
            </div>

            <div style="margin-bottom:25px;">
                <label style="display:block; font-size:1rem; font-weight:700; color:#64748b; margin-bottom:10px;">상세 내용</label>
                <textarea id="bulk-record-content" placeholder="지도 내용을 입력하세요..." style="width:100%; height:100px; padding:15px; border-radius:15px; border:2px solid #e2e8f0; font-size:1.1rem; resize:none; outline:none; transition:border-color 0.2s;"></textarea>
            </div>

            <button id="save-bulk-btn" onclick="saveBulkRecordData()" style="width:100%; padding:18px; border-radius:18px; border:none; background:linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color:white; font-size:1.3rem; font-weight:800; cursor:pointer; box-shadow:0 10px 20px rgba(99,102,241,0.3); transition:all 0.2s;">💾 기록 저장하기</button>
        </div>
    `;

    document.body.appendChild(overlay);

    // 데이터 로드 및 초기화
    const allStudents = await fetchAllStudents();
    const selectedStudents = [];
    const searchInput = document.getElementById("student-search-input");
    const dropdown = document.getElementById("search-result-dropdown");
    const tagsContainer = document.getElementById("selected-students-tags");

    // 카테고리 초기값 선택 처리
    const firstCat = overlay.querySelector('.bulk-cat-btn');
    if (firstCat) selectBulkCategory(firstCat, '생활지도');

    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
            dropdown.style.display = "none";
            return;
        }

        const filtered = allStudents.filter(s =>
            (s["이름"].toLowerCase().includes(query) || String(s["학번"]).includes(query)) &&
            !selectedStudents.some(sel => sel.num === s["학번"])
        ).slice(0, 10);

        if (filtered.length > 0) {
            dropdown.innerHTML = filtered.map(s => `
                <div style="padding:12px 15px; cursor:pointer; border-bottom:1px solid #f1f5f9; hover:background:#f8fafc;" onclick="addStudentToBulk('${s["학번"]}', '${s["이름"]}')">
                    <span style="font-weight:700;">${s["이름"]}</span> 
                    <span style="color:#64748b; font-size:0.9rem;">(${s["학번"]})</span>
                </div>
            `).join('');
            dropdown.style.display = "block";
        } else {
            dropdown.style.display = "none";
        }
    });

    // 전역 함수 등록 (모달 내 버튼에서 호출용)
    window.selectBulkCategory = (btn, value) => {
        document.querySelectorAll('.bulk-cat-btn').forEach(b => {
            b.style.background = 'white';
            b.style.borderColor = '#e2e8f0';
            b.style.color = '#475569';
        });
        btn.style.background = '#f5f3ff';
        btn.style.borderColor = '#6366f1';
        btn.style.color = '#6366f1';
        document.getElementById('selected-bulk-category').value = value;
    };

    window.addStudentToBulk = (num, name) => {
        selectedStudents.push({ num, name });
        searchInput.value = "";
        dropdown.style.display = "none";
        updateBulkTags();
    };

    window.removeStudentFromBulk = (num) => {
        const idx = selectedStudents.findIndex(s => s.num === num);
        if (idx > -1) selectedStudents.splice(idx, 1);
        updateBulkTags();
    };

    function updateBulkTags() {
        if (selectedStudents.length === 0) {
            tagsContainer.innerHTML = `<span style="color:#94a3b8; font-size:0.9rem;">학생을 검색하여 선택해주세요.</span>`;
            return;
        }
        tagsContainer.innerHTML = selectedStudents.map(s => `
            <div style="background:#6366f1; color:white; padding:6px 12px; border-radius:10px; display:flex; align-items:center; gap:8px; font-weight:700; font-size:0.95rem;">
                ${s.name} (${s.num})
                <span onclick="removeStudentFromBulk('${s.num}')" style="cursor:pointer; font-size:1.1rem;">×</span>
            </div>
        `).join('');
    }

    window.saveBulkRecordData = async () => {
        if (selectedStudents.length === 0) {
            alert("기록할 대상을 선택해주세요.");
            return;
        }
        const content = document.getElementById("bulk-record-content").value.trim();
        if (!content) {
            alert("지도 내용을 입력해주세요.");
            return;
        }

        const category = document.getElementById('selected-bulk-category').value;
        const submitBtn = document.getElementById('save-bulk-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = `⏳ 저장 중...`;

        try {
            const { getCurrentTeacherEmail } = await import('./api.js');
            const authEmail = (getCurrentTeacherEmail() || '').split('@')[0] || 'gatekeeper';
            const { count } = await bulkSaveRecords(selectedStudents, {
                category: category,
                detail: content,
                teacher: authEmail,
                is_positive: false
            });

            alert(`${count}명의 학생에게 기록이 정상적으로 저장되었습니다.`);
            overlay.remove();
        } catch (e) {
            alert("일괄 저장 중 오류가 발생했습니다.");
            console.error(e);
            submitBtn.disabled = false;
            submitBtn.innerHTML = `💾 기록 저장하기`;
        }
    };
};
