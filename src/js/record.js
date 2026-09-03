import { fetchStudentRecords, saveRecord, updateRecord, deleteRecord as apiDeleteRecord, uploadEvidencePhoto, fetchSurveyData, fetchRecordComments, addRecordComment, deleteRecordComment, fetchPresets, checkDuplicateRecord } from './api.js';
import { formatRelativeWithPeriod } from './utils.js';
import { API_CONFIG } from './config.js';
import { openPrintModal } from './print-utils.js';
import CryptoJS from 'crypto-js';

function getFullStoredEmail() {
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (!encrypted) return "";
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        return "";
    }
}

function getCurrentUserPrefix() {
    const email = getFullStoredEmail();
    return email ? maskEmailPrefix(email.split('@')[0]) : "교사";
}

/**
 * 이메일 마스킹 처리 (앞 3글자 + 도메인 유지)
 */
function maskEmail(email) {
    if (!email || !email.includes('@')) return email;
    const [prefix, domain] = email.split('@');
    if (prefix.length <= 3) return prefix + '@' + domain;
    return prefix.substring(0, 3) + '*'.repeat(prefix.length - 3) + '@' + domain;
}

/**
 * 이메일 아이디 마스킹 (두 글자 제외 마스킹)
 */
function maskEmailPrefix(prefix) {
    if (!prefix) return "";
    if (prefix.length >= 2) {
        return prefix.substring(0, 2) + '*'.repeat(prefix.length - 2);
    }
    return prefix.substring(0, 1) + '*';
}

const urlParams = new URLSearchParams(window.location.search);
const studentName = urlParams.get("name") || "";
const num = urlParams.get("num") || "";

import { initRealtimeNotifications } from './notification-service.js';

document.addEventListener("DOMContentLoaded", async () => {
    setupHeader();
    setupForm();
    loadSettings();
    loadRecords();
    initSurveyPopup();
    setupPrintButton();

    // [v4.86] 실시간 알림 가동
    initRealtimeNotifications(() => {
        // 새 기록이 오면 목록 갱신 (선택사항)
        loadRecords();
    });

    // 활동 로그 기록
    const myEmail = getFullStoredEmail();
    if (myEmail) {
        const { logPageView } = await import('./api.js');
        const pageLabel = studentName ? `생활기록 (${studentName})` : "생활기록";
        logPageView(myEmail, pageLabel);
    }
});

function setupHeader() {
    const mode = urlParams.get("mode");
    if (mode === "counsel") {
        document.title = `${studentName} 학생 상담 기록`;
        document.getElementById("pageTitle").textContent = `${num}번 ${studentName} (상담)`;
        const surveyBtn = document.getElementById("viewSurveyBtn");
        if (surveyBtn) surveyBtn.style.display = "inline-flex";
    } else {
        document.title = `${studentName} 학생 기록`;
        document.getElementById("pageTitle").textContent = `${num}번 ${studentName}`;
    }

    // 뒤로가기 버튼
    const backBtn = document.querySelector(".btn-back");
    if (backBtn) {
        backBtn.onclick = goBack;
    }
}

function setupForm() {
    const form = document.getElementById("recordForm");
    const btn = document.getElementById("submitBtn");

    // 현재 시간 설정
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
    const recordTimeInput = document.getElementById("recordTime");
    if (recordTimeInput) recordTimeInput.value = localISOTime;

    // [v4.22] 시간 토글 로직
    const useCustomTime = document.getElementById("useCustomTime");
    if (useCustomTime && recordTimeInput) {
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

    const mode = urlParams.get("mode");
    const behaviorSection = document.getElementById("behavior-section");
    const detailTextarea = document.getElementById("detail");

    if (mode === "counsel") {
        if (behaviorSection) behaviorSection.style.display = "none";
        if (detailTextarea) {
            detailTextarea.placeholder = "상담 내용을 상세히 입력하세요...";
        }
    }

    // 모든 모드에서 자동 높이 조절 기능 추가
    if (detailTextarea) {
        detailTextarea.style.overflowY = "hidden";
        detailTextarea.style.resize = "none"; // 수동 리사이즈 비활성화 (선택 사항)

        detailTextarea.addEventListener("input", function () {
            this.style.height = "auto";
            this.style.height = (this.scrollHeight) + "px";
        });

        // 초기 로딩 시에도 높이 조절 (기존 내용이 있는 경우 대비)
        setTimeout(() => {
            detailTextarea.style.height = "auto";
            detailTextarea.style.height = (detailTextarea.scrollHeight) + "px";
        }, 100);
    }

    // 사진 입력 및 미리보기 설정
    const photoPreviewContainer = document.getElementById("photoPreviewContainer");

    // 사진 입력 처리 (카메라 및 갤러리)
    const cameraInput = document.getElementById("cameraInput");
    const galleryInput = document.getElementById("galleryInput");
    const nameDisplay = document.getElementById("fileNameDisplay");
    let selectedFile = null; // Keep this declaration here

    async function handleFileSelect(file) {
        if (!file) {
            if (nameDisplay) {
                nameDisplay.textContent = "선택된 파일 없음";
                nameDisplay.style.display = "none";
            }
            return;
        }

        if (nameDisplay) {
            nameDisplay.textContent = `📄 ${file.name}`;
            nameDisplay.style.display = "block";
        }

        selectedFile = await resizeImage(file, 1200);

        // 미리보기 표시
        const reader = new FileReader();
        reader.onload = (re) => {
            photoPreviewContainer.innerHTML = `<img src="${re.target.result}" style="max-width:100%; border-radius:12px; margin-top:0px; cursor:pointer;" onclick="window.open(this.src)">`;
        };
        reader.readAsDataURL(selectedFile);
    }

    if (cameraInput) {
        cameraInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
    }
    if (galleryInput) {
        galleryInput.addEventListener("change", (e) => handleFileSelect(e.target.files[0]));
    }

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            btn.disabled = true;
            btn.textContent = "저장 중...";

            try {
                const useCustom = document.getElementById("useCustomTime")?.checked;
                let selectedTime = useCustom ? new Date(recordTimeInput.value).toISOString() : new Date().toISOString();
                
                const detail = document.getElementById("detail").value;
                const mode = urlParams.get("mode");
                
                let category = "상담";
                if (mode !== "counsel") {
                    const activeChips = Array.from(document.querySelectorAll(".chip.active")).map(c => c.textContent);
                    category = activeChips.length > 0 ? activeChips.join(", ") : "일반";
                }

                // [v4.21] 중복 체크 (수정 모드가 아닐 때만)
                if (!window.editMode) {
                    const isDuplicate = await checkDuplicateRecord(num, category, detail, selectedTime);
                    if (isDuplicate) {
                        const confirmSave = confirm(`⚠️ 오늘 이 학생에게 동일한 [${category}] 기록이 이미 존재합니다.\n그래도 추가로 저장하시겠습니까?`);
                        if (!confirmSave) {
                            btn.disabled = false;
                            btn.textContent = "저장";
                            return;
                        }
                    }
                }

                let photoUrls = [];
                if (selectedFile) {
                    btn.textContent = "사진 업로드 중...";
                    const url = await uploadEvidencePhoto(selectedFile, num);
                    photoUrls.push(url);
                }

                const formData = new FormData();
                formData.append("num", num);
                formData.append("name", studentName);
                formData.append("time", selectedTime);

                // 모드에 따라 값 수집
                if (mode === "counsel") {
                    formData.append("good", "상담");
                } else {
                    // 칩 선택 방식 대응
                    const goodChips = Array.from(document.querySelectorAll("#good-chips .chip.active")).map(c => c.textContent);
                    const badChips = Array.from(document.querySelectorAll("#bad-chips .chip.active")).map(c => c.textContent);
                    if (goodChips.length > 0) formData.append("good", goodChips.join(", "));
                    if (badChips.length > 0) formData.append("bad", badChips.join(", "));
                }

                formData.append("detail", detail);

                // 교사 이름 자동 추출 및 추가
                const encrypted = localStorage.getItem('teacher_auth_token');
                if (encrypted) {
                    const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
                    const email = bytes.toString(CryptoJS.enc.Utf8);
                    if (email) {
                        formData.append("teacher", email.split('@')[0]);
                    }
                }

                formData.append("action", "addRecord");

                if (photoUrls.length > 0) {
                    formData.append("photos", JSON.stringify(photoUrls));
                } else if (window.editMode && window.editingRecordPhotos && window.editingRecordPhotos.length > 0) {
                    // 새 사진 없이 기존 사진 유지
                    formData.append("photos", JSON.stringify(window.editingRecordPhotos));
                }

                let data;
                if (window.editMode && window.editingRecordId) {
                    data = await updateRecord(window.editingRecordId, formData);
                } else {
                    data = await saveRecord(formData);
                }

                if (data.result === "success") {
                    if (window.editMode) alert("✅ 수정되었습니다.");
                    else alert("✅ 저장되었습니다.");
                    
                    form.reset();
                    photoPreviewContainer.innerHTML = "";
                    selectedFile = null;
                    
                    window.editMode = false;
                    window.editingRecordId = null;
                    window.editingRecordPhotos = [];

                    // 칩 선택 해제
                    document.querySelectorAll(".chip.active").forEach(c => c.classList.remove("active"));

                    const now2 = new Date();
                    const localISO2 = new Date(now2 - offset).toISOString().slice(0, 16);
                    recordTimeInput.value = localISO2;

                    btn.disabled = false;
                    btn.textContent = "저장";
                    loadRecords();
                } else {
                    alert((window.editMode ? "수정" : "저장") + " 실패: " + data.message);
                    btn.disabled = false;
                    btn.textContent = window.editMode ? "수정하기" : "저장";
                }
            } catch (error) {
                console.error("Save Error:", error);
                alert("처리 중 오류가 발생했습니다: " + error.message);
                btn.disabled = false;
                btn.textContent = "저장";
            }
        });
    }
}

/**
 * 이미지 리사이징 함수
 */
function resizeImage(file, maxWidth) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = height * (maxWidth / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                }, 'image/jpeg', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function loadRecords() {
    const logBox = document.getElementById("logContainer");
    if (!logBox) return;

    logBox.innerHTML = ""; // 기존 내용 초기화
    logBox.className = "loading-records"; // 애니메이션 클래스 추가

    // 제목에서 '생활기록' 제거 하려면 h3 텍스트 변경
    const logHeader = document.querySelector(".record-log h3");
    if (logHeader) logHeader.textContent = "📚 기록 내역";

    try {
        const data = await fetchStudentRecords(num);

        logBox.className = ""; // 로딩 완료 후 클래스 제거
        logBox.innerHTML = ""; // 메시지 비우기

        // 데이터 구조 호환성 처리 (배열인 경우와 객체 내 records인 경우 모두 지원)
        let list = [];
        if (Array.isArray(data)) {
            list = data;
        } else if (data && Array.isArray(data.records)) {
            list = data.records;
        } else if (data && typeof data === 'object') {
            // 혹시 { data: [...] } 같은 다른 키로 올 경우를 대비해 키들을 찍어봄
            console.log("Keys:", Object.keys(data));
        }

        if (list.length === 0) {
            logBox.innerHTML = "<p>기록된 내용이 없습니다.</p>";
            return;
        }

        // 최신순 정렬
        list.sort((a, b) => new Date(b.time) - new Date(a.time));

        logBox.innerHTML = ""; // 초기화

        list.forEach(r => {
            const itemDiv = document.createElement("div");
            itemDiv.className = "log-item";

            // 내용 구성
            const headerDiv = document.createElement("div");
            headerDiv.style.fontSize = "0.85em";
            headerDiv.style.color = "#888";
            headerDiv.style.marginBottom = "5px";
            headerDiv.style.marginRight = "50px";
            headerDiv.style.textAlign = "left"; // 왼쪽 정렬 명시

            // 교사 이름 처리
            let teacherDisplay = r.teacher || "미입력";
            if (teacherDisplay.includes('@')) {
                teacherDisplay = teacherDisplay.split('@')[0];
            }
            if (teacherDisplay !== "미입력") {
                teacherDisplay = maskEmailPrefix(teacherDisplay);
            }

            // 헤더 내부를 flexbox로 구성하여 사진 보기 버튼을 나란히 배치
            headerDiv.style.display = "flex";
            headerDiv.style.alignItems = "center";
            headerDiv.style.flexWrap = "wrap";
            headerDiv.style.gap = "8px";

            const infoSpan = document.createElement("span");
            const d = new Date(r.time);
            const days = ['일', '월', '화', '수', '목', '금', '토'];
            const dayName = days[d.getDay()];
            const absoluteTime = `${d.getMonth() + 1}/${d.getDate()}(${dayName}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            infoSpan.textContent = `📅 ${absoluteTime} (${formatRelativeWithPeriod(r.time)}) | 🧑 ${teacherDisplay}`;
            headerDiv.appendChild(infoSpan);

            // [수정] 사진 보기 버튼을 헤더 영역으로 이동
            if (r.photos && r.photos.length > 0) {
                const photoDiv = document.createElement("div");
                photoDiv.style.display = "flex";
                photoDiv.style.alignItems = "center";
                photoDiv.style.gap = "4px";

                r.photos.forEach((photoUrl, index) => {
                    const viewBtn = document.createElement("button");
                    viewBtn.type = "button";
                    viewBtn.className = "btn-view-photo"; // CSS 추가 필요
                    viewBtn.style.background = "#f0f2f5";
                    viewBtn.style.border = "1px solid #d9d9d9";
                    viewBtn.style.borderRadius = "6px";
                    viewBtn.style.padding = "2px 8px"; // 높이를 조금 줄임
                    viewBtn.style.fontSize = "0.85em";
                    viewBtn.style.cursor = "pointer";
                    viewBtn.style.display = "inline-flex";
                    viewBtn.style.alignItems = "center";
                    viewBtn.style.gap = "4px";
                    viewBtn.innerHTML = `📷 사진 ${r.photos.length > 1 ? index + 1 : ""}`;
                    viewBtn.onclick = () => window.openPhotoViewer(photoUrl);
                    photoDiv.appendChild(viewBtn);
                });
                headerDiv.appendChild(photoDiv);
            }

            itemDiv.appendChild(headerDiv);

            if (r.good) {
                const goodDiv = document.createElement("div");
                goodDiv.style.color = "#2196F3";
                goodDiv.style.fontWeight = "bold";
                goodDiv.textContent = `👍 ${r.good}`;
                itemDiv.appendChild(goodDiv);
            }

            if (r.bad && r.bad !== "생활기록") { // '생활기록' 텍스트는 표시하지 않음
                const badDiv = document.createElement("div");
                badDiv.style.color = "#F44336";
                badDiv.style.fontWeight = "bold";
                badDiv.textContent = `👎 ${r.bad}`;
                itemDiv.appendChild(badDiv);
            }

            if (r.conduct) {
                const conductDiv = document.createElement("div");
                conductDiv.style.color = "#d97706"; // 진한 노란색 (다크 골든로드 계열)
                conductDiv.style.fontWeight = "bold";
                conductDiv.textContent = `📋 ${r.conduct}`;
                itemDiv.appendChild(conductDiv);
            }

            if (r.detail) {
                const detailDiv = document.createElement("div");
                detailDiv.style.marginTop = "5px";
                detailDiv.style.color = "#333";
                detailDiv.textContent = `📝 ${r.detail}`;
                itemDiv.appendChild(detailDiv);
            }

            // [추가] 리액션 및 댓글 영역 구성
            const commentsContainer = document.createElement("div");
            commentsContainer.style.marginTop = "12px";
            commentsContainer.style.borderTop = "1px dashed #eee";
            commentsContainer.style.paddingTop = "10px";
            commentsContainer.className = "record-comments-container";

            // 리액션/댓글 불러오기 및 렌더링 (비동기)
            renderCommentsSection(commentsContainer, r.id, r.teacher);

            itemDiv.appendChild(commentsContainer);

            // [추가] 삭제 버튼 노출 권한 체크 (기록한 선생님만)
            let currentUser = "";
            const encrypted = localStorage.getItem('teacher_auth_token');
            if (encrypted) {
                try {
                    const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
                    const email = bytes.toString(CryptoJS.enc.Utf8);
                    if (email) currentUser = email.split('@')[0];
                } catch (e) { console.error(e); }
            }

            let authorCheck = r.rawTeacher || r.teacher;

            // [개선] 마스킹된 ID와도 비교할 수 있도록 비교 로직 강화 (v5.12)
            let isAuthor = false;
            if (currentUser && authorCheck) {
                const cleanAuthor = authorCheck.split('@')[0];
                const cleanCurrent = currentUser.split('@')[0];

                if (cleanAuthor === cleanCurrent) {
                    isAuthor = true;
                } else {
                    // 기존에 마스킹되어 저장된 기록(예: ga***)과의 하위 호환성 체크
                    const maskedCurrent = cleanCurrent.length >= 2
                        ? cleanCurrent.substring(0, 2) + "*".repeat(cleanCurrent.length - 2)
                        : cleanCurrent.substring(0, 1) + "*";
                    if (cleanAuthor === maskedCurrent) {
                        isAuthor = true;
                    }
                }
            }

            if (isAuthor) {
                const actionDiv = document.createElement("div");
                actionDiv.style.marginTop = "6px";
                actionDiv.style.marginBottom = "6px";
                actionDiv.style.display = "flex";
                actionDiv.style.gap = "6px";
                actionDiv.style.justifyContent = "flex-end";

                const editBtn = document.createElement("button");
                editBtn.className = "btn-edit";
                editBtn.textContent = "✏️ 수정";
                editBtn.style.background = "#e6f7ff";
                editBtn.style.border = "1px solid #91d5ff";
                editBtn.style.color = "#1890ff";
                editBtn.style.padding = "4px 8px";
                editBtn.style.fontSize = "12px";
                editBtn.style.borderRadius = "4px";
                editBtn.style.cursor = "pointer";
                editBtn.onclick = () => window.handleEdit(r);
                actionDiv.appendChild(editBtn);

                const delBtn = document.createElement("button");
                delBtn.className = "btn-delete";
                delBtn.textContent = "🗑 삭제";
                delBtn.style.position = "static"; // CSS의 absolute 속성 덮어쓰기
                delBtn.onclick = () => handleDelete(r.num, r.time);
                actionDiv.appendChild(delBtn);
                
                itemDiv.insertBefore(actionDiv, headerDiv.nextSibling);
            }

            logBox.appendChild(itemDiv);
        });

    } catch (error) {
        console.error("Load Error:", error);
        logBox.innerHTML = "<p>기록을 불러오지 못했습니다.</p>";
    } finally {
        logBox.className = ""; // 로딩 애니메이션 제거 (성공/실패 공통)
    }
}

async function handleDelete(targetNum, targetTime) {
    if (!confirm("정말 이 기록을 삭제하시겠습니까?")) return;

    try {
        const data = await apiDeleteRecord(targetNum, targetTime);
        if (data.result === "success") {
            alert("🗑 삭제되었습니다.");
            loadRecords(); // 새로고침 대신 목록 갱신
        } else {
            alert("삭제 실패: " + data.message);
        }
    } catch (error) {
        console.error("Delete Error:", error);
        alert("삭제 중 통신 오류가 발생했습니다.");
    }
}

function goBack() {
    if (!num || num.length < 2) {
        window.location.href = "stu-list.html";
        return;
    }
    const grade = num.charAt(0);
    const classNum = num.charAt(1);
    // 반 목록이 아니라 이전에 보던 학생 상세(기초조사) 팝업으로 돌아간다
    window.location.href = `stu-list.html?grade=${grade}&class=${classNum}&open=${encodeURIComponent(num)}`;
}

/**
 * 설정 항목을 불러와서 셀렉트 박스(잘한일/못한일)를 채웁니다.
 */
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
 * 기초조사 팝업 초기화 및 이벤트 바인딩 (이벤트 위임 방식)
 */
function initSurveyPopup() {
    const surveyBtn = document.getElementById("viewSurveyBtn");
    if (surveyBtn) {
        surveyBtn.onclick = openSurveyPopup;
    }

    // 이벤트 위임: 문서 전체에서 클릭을 감지하여 팝업 닫기 처리
    document.addEventListener("click", (e) => {
        // 닫기 버튼(✕) 또는 배경(overlay) 클릭 시
        if (e.target.closest(".close-btn") || e.target.id === "overlay") {
            closePopup();
        }
    });
}

/**
 * 기초조사 팝업 열기 및 렌더링
 */
async function openSurveyPopup(e, targetId = null) {
    if (e && e.preventDefault) e.preventDefault();

    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (!popup || !overlay) return;

    overlay.style.display = "block";
    popup.style.display = "block";
    popup.className = "student-detail-popup";

    // 배경 스크롤 방지
    document.body.style.overflow = "hidden";

    popup.innerHTML = `<div style="padding:20px; text-align:center; color:#fff;">기초조사 불러오는 중...</div>`;

    const activeId = targetId || num; // 인자가 있으면 해당 학번, 없으면 현재 페이지 학번
    const data = await fetchSurveyData(activeId);

    if (!data) {
        popup.innerHTML = `
            <div class="popup-header">
                <div class="popup-title-center">기초조사 오류</div>
                <button class="close-btn" onclick="closePopup()">✕</button>
            </div>
            <div style="padding:20px; text-align:center;">데이터를 불러오지 못했습니다. (${activeId})</div>`;
        return;
    }

    const { student, survey } = data;
    const surveyData = survey || {};
    // 정규화된 키 추가
    for (let k in surveyData) {
        if (typeof k === 'string') {
            surveyData[k.toUpperCase()] = surveyData[k];
        }
    }

    const intimacyMap = { "1": "거의 모름", "2": "조금 암", "3": "보통", "4": "친함", "5": "매우 친함" };
    const getValue = (primary, secondary, ...keys) => {
        for (const key of keys) {
            let pVal = primary ? String(primary[key] || "").trim() : "";
            if (pVal && pVal !== "null" && pVal !== "undefined" && pVal !== ".") return pVal;

            let sVal = secondary ? String(secondary[key] || "").trim() : "";
            if (sVal && sVal !== "null" && sVal !== "undefined" && sVal !== ".") return sVal;
        }
        return ".";
    };

    const createInfoRow = (label, val) => {
        let valStr = String(val || "").trim();
        if (valStr === "" || valStr === "null" || valStr === "." || valStr === "없음") valStr = ".";
        let displayVal = valStr;
        if (label.includes("친밀도") && intimacyMap[valStr]) displayVal = intimacyMap[valStr];

        return `<div class="detail-info-row">
            <span class="detail-label">${label}</span>
            <span class="detail-value" style="font-weight:700;">${displayVal}</span>
        </div>`;
    };

    // 2사분면: 기본 정보
    let infoHtml2 = "";
    infoHtml2 += createInfoRow("연락처", getValue(student, surveyData, "연락처", "contact", "학생폰"));
    infoHtml2 += createInfoRow("인스타id", getValue(student, surveyData, "인스타id", "인스타 id", "인스타", "instagram", "insta"));
    infoHtml2 += createInfoRow("집주소", getValue(student, surveyData, "주소", "집주소", "address"));
    infoHtml2 += createInfoRow("학적", getValue(student, surveyData, "학적", "status"));
    infoHtml2 += createInfoRow("성별", getValue(student, surveyData, "성별", "gender"));

    // 3사분면: 가족관계
    let infoHtml3 = "";
    infoHtml3 += createInfoRow("주보호자 관계", getValue(surveyData, {}, "주보호자 관계", "보호자관계"));
    infoHtml3 += createInfoRow("주보호자 연락처", getValue(surveyData, {}, "주보호자 연락처", "보호자연락처"));
    infoHtml3 += createInfoRow("거주가족", getValue(surveyData, {}, "거주가족", "가족구성"));

    // 4사분면: 상세 기초조사
    let infoHtml4 = "";
    const excludeKeys = [
        "번호", "연락처", "인스타", "집주소", "학적", "성별", "학번", "이름",
        "student_id", "photo_url", "data", "student_pid", "id", "submitted_at",
        "PID", "CREATED_AT", "UPDATED_AT", "instagram", "insta", "contact",
        "address", "status", "gender", "주보호자 관계", "보호자관계",
        "주보호자 연락처", "보호자연락처", "거주가족", "가족구성", "인스타id", "인스타 id", "인스타 아이디"
    ];
    for (let key in surveyData) {
        if (!excludeKeys.includes(key) && key === key.toLowerCase() && surveyData[key] && surveyData[key] !== ".") {
            infoHtml4 += createInfoRow(key, surveyData[key]);
        }
    }

    // 권한 확인
    const { fetchClassInfo } = await import('./api.js');
    const { studentIdParts, isPrivileged } = await import('./school.js');
    const classInfoArr = await fetchClassInfo();
    const myEmail = getFullStoredEmail();
    const studentIdStr = String(student["학번"] || activeId);
    const { grade: sGrade, class: sClass } = studentIdParts(studentIdStr);

    const currentClassInfo = classInfoArr ? classInfoArr.find(c => c.grade === sGrade && c.class === sClass) : null;
    // [M2] 관리자/상담교사(권한) 또는 본인 학급 여부
    const isAdmin = isPrivileged();

    const isAuthorized = isAdmin || (currentClassInfo && (
        currentClassInfo.homeroomEmail === myEmail ||
        currentClassInfo.subEmail === myEmail
    ));

    if (!isAuthorized) {
        infoHtml3 = `<div class="no-access-msg" style="padding:24px; text-align:center; color:#999; font-size:0.9em;">
            🔒 가족 정보와 연락처는<br>담임/부담임 선생님만 조회가 가능합니다.
        </div>`;
        infoHtml4 = `<div class="no-access-msg" style="padding:24px; text-align:center; color:#999; font-size:0.9em;">
            🔒 상세 기초조사 내용은<br>담임/부담임 선생님 전용 정보입니다.
        </div>`;
    }

    const imgSrc = student["사진저장링크"] || "";

    popup.innerHTML = `
        <div class="popup-header">
            <div class="popup-title-center">
                <span class="student-id-badge">${student["학번"]}</span>
                <span class="student-name-text">${student["이름"]} 기초조사</span>
            </div>
            <button class="close-btn" onclick="closePopup()">✕</button>
        </div>
        <div class="popup-quadrants-container">
            <div class="popup-quadrant quad-1">
                <div class="quad-label" style="background:#fff1f0; color:#cf1322;">PHOTO</div>
                <div class="photo-wrapper">
                    ${imgSrc ? `<img src="${imgSrc}" style="max-width:100%; border-radius:12px;">` : `<div class="no-photo-placeholder">사진 없음</div>`}
                </div>
            </div>
            <div class="popup-quadrant quad-2">
                <div class="quad-label" style="background:#f6ffed; color:#389e0d;">BASIC INFO</div>
                <div class="quad-scroll">${infoHtml2}</div>
            </div>
            <div class="popup-quadrant quad-3">
                <div class="quad-label" style="background:#e6f7ff; color:#096dd9;">FAMILY & CONTACT</div>
                <div class="quad-scroll">${infoHtml3}</div>
            </div>
            <div class="popup-quadrant quad-4">
                <div class="quad-label" style="background:#f9f0ff; color:#531dab;">SURVEY DETAILS</div>
                <div class="quad-scroll">${infoHtml4 || ". (상세 정보 없음)"}</div>
            </div>
        </div>
        <!-- 학생 이동 플로팅 버튼 (권한 있을 때만) -->
        ${isAuthorized ? `
        <div class="nav-floating-btn nav-prev-btn" onclick="navigateStudent(-1, '${activeId}')">〈</div>
        <div class="nav-floating-btn nav-next-btn" onclick="navigateStudent(1, '${activeId}')">〉</div>
        ` : ''}
    `;
}

/**
 * 학생 이동 (앞번호/뒷번호)
 */
let studentsList = []; // 현재 학급의 학생 목록 저장용
async function navigateStudent(direction, currentId) {
    // 현재 학급의 모든 학생 목록을 가져옵니다 (처음 한 번만)
    if (studentsList.length === 0) {
        const grade = currentId.charAt(0);
        const classNum = currentId.slice(1, 2);
        try {
            const { fetchStudentsByClass } = await import('./api.js');
            studentsList = await fetchStudentsByClass(grade, classNum);
        } catch (e) {
            console.error("학생 목록 로드 실패:", e);
            return;
        }
    }

    const currentIndex = studentsList.findIndex(s => s.student_id === currentId);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = studentsList.length - 1;
    if (nextIndex >= studentsList.length) nextIndex = 0;

    const nextStudent = studentsList[nextIndex];

    // 팝업만 갱신 (URL은 히스토리에 기록만 하고 실제 이동은 안 함)
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("num", nextStudent.student_id);
    newUrl.searchParams.set("name", nextStudent.name);
    window.history.replaceState({ student_id: nextStudent.student_id }, "", newUrl);

    // 팝업 내용 갱신
    await openSurveyPopup(null, nextStudent.student_id);
}

/**
 * 팝업 닫기
 */
function closePopup() {
    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (popup) popup.style.display = "none";
    if (overlay) overlay.style.display = "none";
    document.body.style.overflow = "auto";
}

/**
 * 사진 뷰어 팝업 열기/닫기 (전역 노출)
 */
window.openPhotoViewer = function (url) {
    const overlay = document.getElementById("photoViewerOverlay");
    const img = document.getElementById("photoViewerImg");
    if (overlay && img) {
        img.src = url;
        overlay.style.display = "flex";
        document.body.style.overflow = "hidden"; // 배경 스크롤 방지
    }
};

window.closePhotoViewer = function () {
    const overlay = document.getElementById("photoViewerOverlay");
    const img = document.getElementById("photoViewerImg");
    if (overlay && img) {
        overlay.style.display = "none";
        img.src = "";
        img.src = "";
        document.body.style.overflow = ""; // 스크롤 원복
    }
};

/**
 * 리액션 및 댓글 렌더링 함수
 */
async function renderCommentsSection(container, recordId, originalTeacherId) {
    container.innerHTML = `<div style="color:#999; font-size:0.85em; margin-bottom:5px;">💬 리액션 및 댓글 불러오는 중...</div>`;

    // 현재 접속한 선생님 정보 추출 (삭제 권한 등 확인용)
    let currentUser = "";
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (encrypted) {
        try {
            const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
            currentUser = bytes.toString(CryptoJS.enc.Utf8);
            if (currentUser && currentUser.includes('@')) {
                currentUser = currentUser.split('@')[0];
            }
        } catch (e) {
            console.error("Token Decryption Error in comments:", e);
        }
    }

    try {
        const comments = await fetchRecordComments(recordId);
        const reactions = comments.filter(c => c.type === 'reaction');
        const textComments = comments.filter(c => c.type === 'comment');

        // 이모지별 카운트 Grouping
        const reactionCounts = {};
        reactions.forEach(r => {
            if (!reactionCounts[r.content]) reactionCounts[r.content] = { count: 0, me: false, ids: [] };
            reactionCounts[r.content].count++;
            reactionCounts[r.content].ids.push(r.id);
            if (r.teacher_email_prefix === currentUser) {
                reactionCounts[r.content].me = true; // 내가 남긴 리액션
            }
        });

        // 사용 가능 이모지 지정 (사용자 피드백으로 체크, 환한 웃음으로 변경)
        const availableEmojis = ['✅', '👍', '💖', '💪', '😄', '😢', '🙏'];

        // 전체 UI 조립
        let html = `<div class="reactions-bar" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">`;

        availableEmojis.forEach(emj => {
            const group = reactionCounts[emj];
            const count = group ? group.count : 0;
            const highlighted = group && group.me ? 'background:#e0f2fe; border-color:#38bdf8;' : 'background:#fff; border-color:#e2e8f0;';
            const displayCount = count > 0 ? `<span style="margin-left:4px; font-weight:bold; font-size:1.05em; color:#333;">${count}</span>` : '';

            html += `
                <button type="button" class="btn-reaction" data-emoji="${emj}" 
                    style="border:1px solid #ccc; border-radius:14px; padding:4px 10px; font-size:0.9em; cursor:pointer; transition:all 0.2s; display:inline-flex; align-items:center; box-shadow:0 1px 2px rgba(0,0,0,0.05); ${highlighted}">
                    ${emj}${displayCount}
                </button>
            `;
        });

        // [추가] 댓글달기 토글 버튼
        html += `
            <button type="button" class="btn-toggle-comment" style="border:1px dashed #ccc; background:transparent; border-radius:14px; padding:4px 10px; font-size:0.9em; cursor:pointer; display:inline-flex; align-items:center; color:#666; transition:background 0.2s;">
                💬 댓글달기
            </button>
        </div>`;

        // 텍스트 댓글 내역 렌더링
        if (textComments.length > 0) {
            html += `<div class="text-comments-list" style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">`;
            textComments.forEach(tc => {
                const isMyComment = (currentUser === tc.teacher_email_prefix);
                const isRecordOwner = (currentUser === originalTeacherId);
                const canDelete = isMyComment || isRecordOwner;
                const deleteBtnHtml = canDelete ? `<button type="button" class="delete-comment-btn" data-id="${tc.id}" style="background:transparent; border:none; color:#ccc; cursor:pointer; margin-left:auto; padding:0 4px; font-size:0.8em;" title="삭제">✕</button>` : '';

                // 작성자 아이디 제거 (익명화) - 내용과 이모티콘 같은 장식만 표시
                html += `
                    <div style="background:#f8fafc; padding:8px 12px; border-radius:8px; display:flex; align-items:flex-start; font-size:0.9em; border:1px solid #e2e8f0;">
                        <span style="font-weight:bold; color:#a1a1aa; margin-right:6px;">💬</span>
                        <span style="flex:1; color:#334155; word-break:break-all; line-height:1.4;">${tc.content}</span>
                        ${deleteBtnHtml}
                    </div>
                `;
            });
            html += `</div>`;
        }

        // 새 텍스트 댓글 작성 폼 (초기 숨김)
        html += `
            <div class="comment-input-area" style="margin-top:10px; display:none; gap:6px;">
                <input type="text" class="new-comment-input" placeholder="동료 선생님에게 따뜻한 한마디를 남겨보세요..." style="flex:1; padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.9em; outline:none; background:#fff;">
                <button type="button" class="btn-submit-comment" style="background:#4f46e5; color:white; border:none; border-radius:8px; padding:0 16px; cursor:pointer; font-size:0.95em; font-weight:bold; transition:background 0.2s;">등록</button>
            </div>
        `;

        container.innerHTML = html;

        // 댓글달기 폼 토글 이벤트
        const toggleBtn = container.querySelector('.btn-toggle-comment');
        const inputArea = container.querySelector('.comment-input-area');
        const commentInputObj = container.querySelector('.new-comment-input');
        if (toggleBtn && inputArea) {
            toggleBtn.addEventListener('click', () => {
                if (inputArea.style.display === 'none') {
                    inputArea.style.display = 'flex';
                    if (commentInputObj) commentInputObj.focus();
                } else {
                    inputArea.style.display = 'none';
                }
            });
        }

        // 리액션 버튼 동작 이벤트 바인딩
        const reactionBtns = container.querySelectorAll('.btn-reaction');
        reactionBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!currentUser) return alert("로그인(선생님 인증) 정보가 없습니다.");
                const emj = btn.getAttribute('data-emoji');
                const group = reactionCounts[emj];

                try {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';

                    // 현재 사용자가 이미 남긴 리액션 조회
                    const existingMyReaction = reactions.find(r => r.teacher_email_prefix === currentUser);

                    if (existingMyReaction) {
                        if (existingMyReaction.content === emj) {
                            // 기존과 같은 이모티콘 클릭 -> 반응 취소(삭제)
                            await deleteRecordComment(existingMyReaction.id);
                        } else {
                            // 다른 이모티콘 클릭 -> 기존 삭제 후 새 등록(변경)
                            await deleteRecordComment(existingMyReaction.id);
                            await addRecordComment({
                                record_id: recordId,
                                teacher_email_prefix: currentUser,
                                type: 'reaction',
                                content: emj
                            });
                        }
                    } else {
                        // 기존 반응이 없을 경우 새 등록
                        await addRecordComment({
                            record_id: recordId,
                            teacher_email_prefix: currentUser,
                            type: 'reaction',
                            content: emj
                        });
                    }
                    renderCommentsSection(container, recordId, originalTeacherId);
                } catch (e) {
                    alert(e.message);
                    renderCommentsSection(container, recordId, originalTeacherId);
                }
            });
        });

        // 텍스트 댓글 삭제 이벤트 바인딩
        const deleteBtns = container.querySelectorAll('.delete-comment-btn');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (confirm("이 댓글을 삭제하시겠습니까? (삭제 후 복구할 수 없습니다)")) {
                    const cId = e.currentTarget.getAttribute('data-id');
                    try {
                        await deleteRecordComment(cId);
                        renderCommentsSection(container, recordId, originalTeacherId);
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });

        // 텍스트 댓글 등록 이벤트 바인딩
        const submitBtn = container.querySelector('.btn-submit-comment');
        const commentInput = container.querySelector('.new-comment-input');

        const submitComment = async () => {
            const val = commentInput.value.trim();
            if (!val) return;
            if (!currentUser) return alert("로그인(선생님 인증) 정보가 없습니다.");

            submitBtn.disabled = true;
            submitBtn.textContent = '저장중';
            try {
                await addRecordComment({
                    record_id: recordId,
                    teacher_email_prefix: currentUser,
                    type: 'comment',
                    content: val
                });
                renderCommentsSection(container, recordId, originalTeacherId);
            } catch (e) {
                alert(e.message);
                submitBtn.disabled = false;
                submitBtn.textContent = '등록';
            }
        };

        submitBtn.addEventListener('click', submitComment);
        commentInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitComment();
        });

    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444; font-size:0.85em;">코멘트를 불러오지 못했습니다.</div>`;
        console.error("Comments Render Error:", e);
    }
}

/**
 * vFlat 앱 스토어 페이지로 이동
 */
function openVFlat() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    if (/android/i.test(userAgent)) {
        window.location.href = "market://details?id=com.voyagerx.scanner";
    } else if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
        window.location.href = "itms-apps://itunes.apple.com/app/id1540238220";
    } else {
        window.open("https://vflat.com/");
    }
}

// 전역 공개
window.closePopup = closePopup;
window.openSurveyPopup = openSurveyPopup;
window.navigateStudent = navigateStudent;
window.openVFlat = openVFlat;

console.log("✅ record.js 로드 완료 및 전역 함수 등록");

/**
 * 생활기록 수정 모드 진입
 */
window.handleEdit = function(r) {
    window.editMode = true;
    window.editingRecordId = r.id;
    window.editingRecordPhotos = r.photos || [];
    
    // 시간 설정
    const recordTimeInput = document.getElementById("recordTime");
    const useCustomTime = document.getElementById("useCustomTime");
    
    if (recordTimeInput) {
        const offset = new Date().getTimezoneOffset() * 60000;
        const localISO = new Date(new Date(r.time) - offset).toISOString().slice(0, 16);
        recordTimeInput.value = localISO;
    }
    if (useCustomTime) {
        useCustomTime.checked = true;
        if (recordTimeInput) {
            recordTimeInput.disabled = false;
            recordTimeInput.style.background = "white";
        }
    }
    
    // 카테고리 칩 원복 및 설정
    document.querySelectorAll(".chip.active").forEach(c => c.classList.remove("active"));
    const cat = r.good || r.bad;
    if (cat) {
        document.querySelectorAll(".chip").forEach(c => {
            if (c.textContent === cat) c.classList.add("active");
        });
    }
    
    // 상세 내용 세팅
    const detailTextarea = document.getElementById("detail");
    if (detailTextarea) {
        detailTextarea.value = r.detail || "";
        detailTextarea.style.height = "auto";
        detailTextarea.style.height = (detailTextarea.scrollHeight) + "px";
    }
    
    // 버튼 텍스트 변경
    const btn = document.getElementById("submitBtn");
    if (btn) btn.textContent = "수정하기";
    
    // 사진 미리보기 설정
    const photoPreviewContainer = document.getElementById("photoPreviewContainer");
    if (photoPreviewContainer && window.editingRecordPhotos.length > 0) {
        photoPreviewContainer.innerHTML = `<div style="font-size:0.85em; color:#666; margin-top:5px;">📷 기존 등록된 사진 ${window.editingRecordPhotos.length}장 유지됨 (새 사진 선택 시 덮어써집니다.)</div>`;
    } else if (photoPreviewContainer) {
        photoPreviewContainer.innerHTML = "";
    }
    
    // 작성 폼으로 스크롤 이동
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function setupPrintButton() {
    const printBtn = document.getElementById("print-record-btn");
    if (printBtn) {
        printBtn.addEventListener("click", async () => {
            if (!num || num.length < 2) return;
            const grade = parseInt(num.charAt(0));
            const classNum = parseInt(num.charAt(1));
            await openPrintModal(grade, classNum, num);
        });
    }
}
