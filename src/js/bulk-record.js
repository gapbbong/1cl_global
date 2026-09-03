import { fetchAllStudents, bulkSaveRecords, fetchPresets, checkDuplicateRecord } from './api.js';
import { API_CONFIG } from './config.js';
import { extractDriveId, getThumbnailUrl } from './utils.js';
import CryptoJS from 'crypto-js';

let allStudents = [];
let selectedStudents = [];

document.addEventListener("DOMContentLoaded", async () => {
    // 1. 초기 데이터 로드 (학생 명단 & 설정)
    await initData();

    // 2. 검색 입력 이벤트 설정 (버튼 클릭 및 엔터키)
    const studentInput = document.getElementById("student-input");
    const searchBtn = document.getElementById("search-btn");

    searchBtn.addEventListener("click", () => handleSearch(studentInput.value));
    studentInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleSearch(studentInput.value);
        }
    });

    // 3. 저장 버튼 이벤트 설정
    const saveBtn = document.getElementById("save-all-btn");
    saveBtn.addEventListener("click", handleSaveAll);

    // 4. 설정 항목 로드 (칭찬/벌점)
    loadSettings();

    // 5. 사진 크기 조절 초기화
    initSizeControl();

    // Activities logging
    const { getCurrentTeacherEmail, logPageView } = await import('./api.js');
    const myEmail = getCurrentTeacherEmail();
    if (myEmail) {
        logPageView(myEmail, "일괄 기록");
    }

    // [추가] 기록 시간 초기화
    const recordTimeInput = document.getElementById("record-time");
    if (recordTimeInput) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
        recordTimeInput.value = localISOTime;

        // [v4.22] 시간 토글 로직
        const useCustomTime = document.getElementById("use-custom-time");
        if (useCustomTime) {
            useCustomTime.addEventListener("change", function () {
                recordTimeInput.disabled = !this.checked;
                recordTimeInput.style.background = this.checked ? "white" : "#f1f5f9";
                if (!this.checked) {
                    const nowLatest = new Date();
                    const isoLatest = new Date(nowLatest - offset).toISOString().slice(0, 16);
                    recordTimeInput.value = isoLatest;
                }
            });
        }
    }

    // [추가] 폰/브라우저 뒤로가기 버튼과 연결 (데이터 유실 방지)
    window.addEventListener("beforeunload", (e) => {
        if (selectedStudents.length > 0) {
            e.preventDefault();
            e.returnValue = ""; // 브라우저 표준 확인창 출력
        }
    });
});

function initSizeControl() {
    const btns = document.querySelectorAll(".btn-size");
    const grid = document.getElementById("selected-students");

    // 로컬 스토리지에서 저장된 크기 불러오기 (기본값 보통: 200)
    const savedSize = localStorage.getItem("bulk-photo-size") || "200";
    applyPhotoSize(savedSize);

    btns.forEach(btn => {
        btn.addEventListener("click", () => {
            const size = btn.getAttribute("data-size");
            applyPhotoSize(size);
            localStorage.setItem("bulk-photo-size", size);
        });
    });

    function applyPhotoSize(size) {
        // 활성화 버튼 표시
        btns.forEach(btn => {
            if (btn.getAttribute("data-size") === String(size)) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        // CSS 변수 수정을 통해 그리드 크기 및 폰트 크기 동적 조절
        grid.style.setProperty('--card-width', `${size}px`);

        // 크기에 비례하여 폰트 크기 계산 (기준 150px -> 1.2em)
        const fontSize = (size / 150) * 1.2;
        grid.style.setProperty('--font-size', `${fontSize.toFixed(2)}em`);
    }
}

async function initData() {
    try {
        allStudents = await fetchAllStudents();
        console.log("Loaded students:", allStudents.length);
    } catch (error) {
        console.error("Failed to load students:", error);
        alert("학생 데이터를 불러오지 못했습니다.");
    }
}

async function handleSearch(value) {
    const query = value.trim();

    if (!query) return;

    const student = allStudents.find(s => String(s["학번"]) === query);

    if (student) {
        // [수정] 학적 상태 확인 및 알림 (커스텀 팝업)
        const status = student["학적"];
        if (status && status !== "재학") {
            const confirmed = await showModal(
                `⚠️ ${student["이름"]} 학생은 [${status}] 상태입니다.\n생활기록을 계속 추가할까요?`
            );

            if (!confirmed) {
                document.getElementById("student-input").value = "";
                document.getElementById("student-input").focus();
                return;
            }
        }

        addStudent(student);
        document.getElementById("student-input").value = ""; // 입력창 초기화
        document.getElementById("student-input").focus(); // 다시 포커스
    } else {
        alert("학생을 찾을 수 없습니다: " + query);
    }
}

/**
 * 커스텀 모달 팝업 표시
 * @param {string} message - 표시할 메시지
 * @returns {Promise<boolean>} 확인/취소 결과
 */
function showModal(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("custom-modal");
        const msgEl = document.getElementById("modal-msg");
        const confirmBtn = document.getElementById("modal-confirm");
        const cancelBtn = document.getElementById("modal-cancel");

        msgEl.innerText = message;
        modal.style.display = "flex";

        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            modal.style.display = "none";
            confirmBtn.removeEventListener("click", handleConfirm);
            cancelBtn.removeEventListener("click", handleCancel);
        };

        confirmBtn.addEventListener("click", handleConfirm);
        cancelBtn.addEventListener("click", handleCancel);
    });
}

function addStudent(student) {
    // 중복 추가 방지
    if (selectedStudents.some(s => s["학번"] === student["학번"])) {
        return;
    }

    selectedStudents.push(student);
    appendStudentCard(student); // 전체를 다시 그리지 않고 하나만 추가
    updateSaveButton();
}

function removeStudent(num) {
    selectedStudents = selectedStudents.filter(s => s["학번"] !== num);

    // DOM에서 직접 제거
    const grid = document.getElementById("selected-students");
    const cards = grid.querySelectorAll(".student-card");
    cards.forEach(card => {
        if (card.getAttribute("data-num") === String(num)) {
            card.remove();
        }
    });

    if (selectedStudents.length === 0) {
        grid.innerHTML = `<div class="empty-msg">선택된 학생이 없습니다.</div>`;
    }

    updateSaveButton();
}

function renderSelectedStudents() {
    const grid = document.getElementById("selected-students");
    grid.innerHTML = "";

    if (selectedStudents.length === 0) {
        grid.innerHTML = `<div class="empty-msg">선택된 학생이 없습니다.</div>`;
        return;
    }

    selectedStudents.forEach(student => appendStudentCard(student));
}

function appendStudentCard(student) {
    const grid = document.getElementById("selected-students");

    // "선택된 학생이 없습니다" 메시지 제거
    const emptyMsg = grid.querySelector(".empty-msg");
    if (emptyMsg) emptyMsg.remove();

    const card = document.createElement("div");
    card.className = "student-card";
    if (student["학적"] && student["학적"] !== "재학") {
        card.classList.add("not-active");
    }
    card.setAttribute("data-num", student["학번"]);

    // 이미지 설정 (Supabase photo_url 우선, 구글 드라이브 하위 호환)
    const supabasePhotoUrl = student.photo_url || student["사진저장링크"];
    const driveLink = student["사진저장링크"] || "";
    const fileId = extractDriveId(driveLink || supabasePhotoUrl);

    let imgSrc = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    if (supabasePhotoUrl && supabasePhotoUrl.startsWith('http')) {
        imgSrc = supabasePhotoUrl;
    } else if (fileId) {
        imgSrc = getThumbnailUrl(fileId);
    }

    const img = document.createElement("img");
    img.src = imgSrc;
    img.loading = "lazy";

    // 이미지 로드 실패 시 재시도 로직 보강 (Google Drive 폴백)
    img.onerror = function () {
        if (this.getAttribute("data-retry")) {
            this.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            return;
        }
        this.setAttribute("data-retry", "true");
        if (fileId) {
            this.src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w500`;
        }
    };

    const info = document.createElement("div");
    info.className = "info";
    info.textContent = `${student["학번"]} ${student["이름"]}`;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "×";
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeStudent(student["학번"]);
    };

    // [추가] 학적 표시 (재학이 아닌 경우에만)
    if (student["학적"] && student["학적"] !== "재학") {
        const statusBadge = document.createElement("span");
        statusBadge.className = "status-badge";

        if (student["학적"] === "graduated") {
            statusBadge.classList.add("graduated");
            statusBadge.textContent = "졸업";
        } else {
            statusBadge.textContent = student["학적"];
        }
        card.appendChild(statusBadge);
    }

    card.appendChild(img);
    card.appendChild(info);
    card.appendChild(removeBtn);
    grid.appendChild(card);
}

// 글로벌 핸들러로 등록 (팝업에서 쓰는 student.js와 겹치지 않게 주의)
window.removeBulkStudent = removeStudent;

function updateSaveButton() {
    const btn = document.getElementById("save-all-btn");
    btn.textContent = `일괄 저장하기 (${selectedStudents.length}명)`;
    btn.disabled = selectedStudents.length === 0;
}

// Settings 시트에서 항목 가져오기 (기존 로직 활용)
async function loadSettings() {
    const goodContainer = document.getElementById("good-chips");
    const badContainer = document.getElementById("bad-chips");

    const fallbackGood = ["1. 기본생활 우수", "2. 자기주도학습", "3. 예의바름", "4. 수업태도 좋음", "5. 솔선수범", "6. 교우관계 원만"];
    const fallbackBad = [
        "1. 지각", "2. 복장불량", "3. 화장", "4. 악세사리 착용", "5. 신발불량", "6. 가방없음", "7. 두발불량", "8. 수업태도 불량", "9. 휴대폰 무단사용", "10. 무단외출", "11. 교복미착용",
        "12. 부적절한 언어(비속어,욕설) 사용", "13. 교사 모독/지시 불이행", "14. 친구와 신체적/언어적 마찰", "15. 수업분위기 저해/타인 학습권 침해", "16. 성 관련 부적절한 언행", "17. 교내봉사"
    ];

    function createChip(text, type) {
        const chip = document.createElement("div");
        chip.className = `chip ${type}`;
        
        // [v4.95] 17번 항목(교내봉사) 숫자 강조 처리
        if (text.startsWith("17.")) {
            const numPart = "17.";
            const textPart = text.substring(numPart.length);
            chip.innerHTML = `<span style="color: #ea4335; font-weight: 800;">${numPart}</span>${textPart}`;
        } else {
            chip.textContent = text;
        }

        chip.onclick = () => {
            chip.classList.toggle("active");
        };
        return chip;
    }

    try {
        if (goodContainer) goodContainer.innerHTML = "⏳ 로딩 중...";
        if (badContainer) badContainer.innerHTML = "⏳ 로딩 중...";

        const settings = await fetchPresets();

        if (goodContainer) {
            goodContainer.innerHTML = "";
            settings.good.forEach(item => {
                goodContainer.appendChild(createChip(item, "good"));
            });
        }

        if (badContainer) {
            badContainer.innerHTML = "";
            settings.bad.forEach(item => {
                badContainer.appendChild(createChip(item, "bad"));
            });
        }
    } catch (err) {
        console.warn("LoadSettings failed, using fallbacks:", err);
        if (goodContainer) {
            goodContainer.innerHTML = "";
            fallbackGood.forEach(item => {
                goodContainer.appendChild(createChip(item, "good"));
            });
        }
        if (badContainer) {
            badContainer.innerHTML = "";
            fallbackBad.forEach(item => {
                badContainer.appendChild(createChip(item, "bad"));
            });
        }
    }
}


/**
 * 로그인된 교사의 이메일 아이디를 추출합니다.
 */
function getTeacherId() {
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (!encrypted) return "미인증";
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
        const email = bytes.toString(CryptoJS.enc.Utf8);
        return email ? email.split('@')[0] : "알수없음";
    } catch (e) {
        console.error("Teacher ID extraction error:", e);
        return "오류";
    }
}

async function handleSaveAll() {
    const goodChips = Array.from(document.querySelectorAll("#good-chips .chip.active")).map(c => c.textContent);
    const badChips = Array.from(document.querySelectorAll("#bad-chips .chip.active")).map(c => c.textContent);
    
    const good = goodChips.length > 0 ? goodChips.join(", ") : "";
    const bad = badChips.length > 0 ? badChips.join(", ") : "";
    
    const detail = document.getElementById("detail-input").value;
    const teacher = getTeacherId();
    const useCustom = document.getElementById("use-custom-time")?.checked;
    const selectedTime = useCustom ? new Date(document.getElementById("record-time").value).toISOString() : new Date().toISOString();

    if (!good && !bad && !detail) {
        alert("기록할 내용을 입력해주세요.");
        return;
    }

    const category = good || bad || "일반";

    // [v4.21] 중복 체크 (첫 번째 학생 기준으로 대표 체크 또는 전체 체크)
    // 여기서는 간단히 선택된 학생 중 첫 번째 학생이라도 중복이 있는지 확인
    if (selectedStudents.length > 0) {
        const firstStudent = selectedStudents[0];
        const isDuplicate = await checkDuplicateRecord(firstStudent["학번"], category, detail, selectedTime);
        if (isDuplicate) {
            const confirmSave = confirm(`⚠️ 선택된 학생들(예: ${firstStudent["이름"]})에게 이미 오늘 동일한 [${category}] 기록이 존재합니다.\n그래도 일괄 저장하시겠습니까?`);
            if (!confirmSave) return;
        }
    }

    if (!confirm(`${selectedStudents.length}명의 학생에게 이 기록을 일괄 저장할까요?`)) {
        return;
    }

    const btn = document.getElementById("save-all-btn");
    btn.disabled = true;
    btn.textContent = "저장 중...";

    // 전송 데이터 구성
    const recordData = {
        good,
        bad,
        category,
        detail,
        teacher,
        time: selectedTime
    };

    // 선택된 학생 리스트
    const targets = selectedStudents.map(s => ({ num: s["학번"], name: s["이름"] }));

    try {
        const result = await bulkSaveRecords(targets, recordData);

        if (result.result === "success") {
            alert(`✅ ${result.count}명의 기록이 저장되었습니다.`);

            // 칩 선택 해제 (v4.23)
            document.querySelectorAll(".chip.active").forEach(c => c.classList.remove("active"));
            document.getElementById("detail-input").value = "";

            // [수정] 어디서 왔는지에 따라 돌아가는 페이지 결정
            const urlParams = new URLSearchParams(window.location.search);
            const from = urlParams.get('from');
            if (from === 'keeper') {
                location.href = "keeper.html";
            } else {
                location.href = "index.html";
            }
        } else {
            alert("저장 실패");
        }
    } catch (error) {
        console.error("Bulk save error:", error);
        alert("통신 오류가 발생했습니다.");
    } finally {
        btn.disabled = false;
        updateSaveButton();
    }
}
