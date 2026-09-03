import { API_CONFIG } from './config.js';
import { extractDriveId, getThumbnailUrl } from './utils.js';
import { fetchStudentsByClass, fetchClassInfo, saveRecord, fetchDetailedRecordCounts, fetchClassSurveysForContacts, getTeacherProfile, fetchStudentsByPids, fetchCustomMenuById, getCurrentTeacherEmail, updateStudentContactInfo } from './api.js';
import { openPrintModal } from './print-utils.js';
import { supabase } from './supabase.js';
import { surveyFields, surveyLabel } from './school.js';

// [M2] 관리자 판정 헬퍼 (하드코딩 이메일 목록 대체)
const acIsAdmin = () => {
  const t = window.currentTeacher || {};
  return t.role === 'admin' || t.role === 'counselor'
    || Object.values(t.permissions && t.permissions.admin || {}).some(Boolean);
};

import { initRealtimeNotifications } from './notification-service.js';
import CryptoJS from 'crypto-js';

const SECRET_KEY = 'oneclass25-secret-auth-key';

// getStoredEmailPrefix was replaced by getCurrentTeacherEmail from api.js and removed to ensure unmasked ID usage.

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

// URL 파라미터 파싱
const urlParams = new URLSearchParams(window.location.search);
const grade = parseInt(urlParams.get("grade"));
const classNum = parseInt(urlParams.get("class"));
const year = urlParams.get("year"); // 2025 등 추가
const customMenuId = urlParams.get("custom_menu_id");

document.addEventListener("DOMContentLoaded", async () => {
    // 0. 아카이브 모드(2025)인 경우 타이틀 및 일부 버튼 제어


    // DB에서 교사 정보 호출
    const classInfo = await fetchClassInfo();
    window.classInfoData = classInfo; // 전역 저장

    // [추가] 현재 교사 프로필 및 권한 정보 로드
    const myEmail = getCurrentTeacherEmail();
    if (myEmail) {
        window.currentTeacher = await getTeacherProfile(myEmail);
        // 활동 로그 기록
        let pageLabel = "학급 명렬";
        if (customMenuId) {
            pageLabel = "개인 그룹 명렬";
        } else if (grade && classNum) {
            pageLabel = `학급 명렬 (${grade}-${classNum})`;
        }
        const { logPageView } = await import('./api.js');
        logPageView(myEmail, pageLabel);
    }

    // 1. 타이틀 및 교사 정보 설정
    setupHeader(classInfo);

    // 2. 학생 데이터 불러오기
    loadStudents();

    // 3. 이벤트 리스너 설정 (플로팅 버튼 등)
    setupEventListeners(classInfo);

    // 4. 안내 메시지 추가
    // 아카이브 모드일 때는 팁 안보여줌
    if (year !== '2025') {
        setupGuidance();
    }

    // 6. 실시간 알림 연동 (v4.76)
    if (year !== '2025') {
        initRealtimeNotifications((newRecord, studentInfo) => {
            // 현재 보고 있는 반의 학생이면 UI 즉시 갱신
            const isCurrentClass = studentInfo.class_info === `${grade}-${classNum}`;
            if (isCurrentClass) {
                updateStudentUIRealtime(newRecord.student_pid);
            }
        });
    }
});

function setupGuidance() {
    // 사용자가 '다시 보지 않기'를 선택했는지 확인
    if (localStorage.getItem("hideGuidanceTooltip") === "true") return;

    const list = document.getElementById("student-list");
    if (!list) return;

    // 모달형 툴팁 생성
    const overlay = document.createElement("div");
    overlay.className = "guidance-tooltip-overlay";

    overlay.innerHTML = `
        <div class="guidance-tooltip-content">
            <h3>💡 생활기록 팁</h3>
            <p>학생 사진을 <strong>길게 누르면</strong><br>바로 생활기록을 할 수 있습니다!</p>
            <div class="guidance-tooltip-footer">
                <button class="close-tooltip-btn">확인</button>
                <button class="never-see-again-btn">다시 보지 않기</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 이벤트 리스너
    const closeBtn = overlay.querySelector(".close-tooltip-btn");
    const neverBtn = overlay.querySelector(".never-see-again-btn");

    closeBtn.onclick = () => {
        document.body.removeChild(overlay);
    };

    neverBtn.onclick = () => {
        localStorage.setItem("hideGuidanceTooltip", "true");
        document.body.removeChild(overlay);
    };

    // 배경 클릭 시 닫기
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    };
}

function setupHeader(classInfo) {
    const titleElement = document.getElementById("class-title");
    if (customMenuId) {
        titleElement.textContent = "가져오는 중...";
        fetchCustomMenuById(customMenuId).then(menu => {
            if (menu) {
                titleElement.textContent = `⭐ ${menu.name}`;
                document.title = `${menu.name} - 학생 목록`;
            } else {
                titleElement.textContent = "그룹 정보 없음";
            }
        });
    } else if (grade && classNum) {
        titleElement.textContent = `${grade}학년 ${classNum}반`;
        document.title = `${grade}학년 ${classNum}반 학생 목록`;
    } else {
        titleElement.textContent = "반 정보 없음";
    }

    const teacherInfoElement = document.getElementById("teacher-info");
    const info = classInfo ? classInfo.find(c => c.grade === grade && c.class === classNum) : null;
    if (info) {
        // 교사 이름 클릭 시 즉시 전화 연결로 변경 (사용자 요청)
        const hrPhone = info.homeroomPhone || "";
        const subPhone = info.subPhone || "";

        teacherInfoElement.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;">
                <button class="teacher-contact-btn" onclick="if('${hrPhone}') window.location.href='tel:${hrPhone}'; else alert('연락처가 등록되지 않았습니다.');">
                    <span class="teacher-badge homeroom">담임</span>
                    <span class="teacher-name">${info.homeroom}</span>
                </button>
                ${info.sub ? `
                <button class="teacher-contact-btn" onclick="if('${subPhone}') window.location.href='tel:${subPhone}'; else alert('연락처가 등록되지 않았습니다.');">
                    <span class="teacher-badge sub">부담임</span>
                    <span class="teacher-name">${info.sub}</span>
                </button>` : ''}
            </div>
        `;
    }
}

// 교사 연락처 모달 표시
window.showTeacherModal = function (info, showSub = false) {
    const existing = document.getElementById("teacher-contact-modal");
    if (existing) existing.remove();

    const name = showSub ? info.sub : info.homeroom;
    const phone = showSub ? info.subPhone : info.homeroomPhone;
    const role = showSub ? "부담임" : "담임";

    const modal = document.createElement("div");
    modal.id = "teacher-contact-modal";
    modal.className = "guidance-tooltip-overlay";
    modal.innerHTML = `
        <div class="guidance-tooltip-content teacher-modal">
            <div class="teacher-modal-header">
                <span class="teacher-badge ${showSub ? 'sub' : 'homeroom'}">${role}</span>
                <h3>${name} 선생님</h3>
            </div>
            <p class="teacher-phone">${phone}</p>
            <div class="teacher-modal-actions">
                <a href="tel:${phone}" class="modal-action-btn call-btn">
                    <span>📞</span> 전화
                </a>
                <a href="sms:${phone}" class="modal-action-btn sms-btn">
                    <span>💬</span> 문자
                </a>
            </div>
            ${info.sub ? `
            <div class="teacher-modal-switch">
                <button onclick="this.closest('.guidance-tooltip-overlay').remove(); showTeacherModal(${JSON.stringify(info).replace(/"/g, '&quot;')}, ${!showSub})">
                    ${showSub ? `담임 ${info.homeroom} 선생님 연락처` : `부담임 ${info.sub} 선생님 연락처`} 보기
                </button>
            </div>` : ''}
            <div class="guidance-tooltip-footer" style="margin-top:16px;">
                <button class="close-tooltip-btn" onclick="this.closest('.guidance-tooltip-overlay').remove()">닫기</button>
            </div>
        </div>
    `;

    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
};


// getFullStoredEmail was replaced by getCurrentTeacherEmail from api.js

function setupEventListeners(classInfo) {
    // 플로팅 컨트롤 (네비게이션)
    const prevBtn = document.getElementById("prev-btn");
    const homeBtn = document.getElementById("home-btn");

    const nextBtn = document.getElementById("next-btn");

    const handleNavClick = (e, direction) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        goToRelativeClass(direction);
    };

    if (prevBtn) {
        prevBtn.addEventListener("click", (e) => handleNavClick(e, -1));
        prevBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: false });
        prevBtn.addEventListener("touchend", (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleNavClick(null, -1);
        }, { passive: false });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", (e) => handleNavClick(e, 1));
        nextBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: false });
        nextBtn.addEventListener("touchend", (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleNavClick(null, 1);
        }, { passive: false });
    }

    if (homeBtn) {
        homeBtn.addEventListener("click", goHome);
    }

    // [수정] 본인 담임반일 때만 기초조사 모아보기 및 연락처 다운로드 버튼 노출
    const downloadBtn = document.getElementById("contact-download-btn");
    if (downloadBtn) {
        const myEmail = getCurrentTeacherEmail();
        const currentClassInfo = classInfo ? classInfo.find(c => c.grade === grade && c.class === classNum) : null;

        const isAdmin = acIsAdmin();
        const isMyClass = isAdmin || (currentClassInfo && (currentClassInfo.homeroomEmail === myEmail || currentClassInfo.subEmail === myEmail));

        if (isMyClass) {
            downloadBtn.style.display = "flex";
            downloadBtn.addEventListener("click", downloadClassContacts);
        } else {
            downloadBtn.style.display = "none";
        }
    }

    // [추가] 인쇄 및 내보내기 버튼 권한 체크 및 노출 설정
    const printBtn = document.getElementById("print-btn");
    if (printBtn) {
        const myEmail = getCurrentTeacherEmail();
        const currentClassInfo = classInfo ? classInfo.find(c => c.grade === grade && c.class === classNum) : null;

        const isOwner = acIsAdmin();
        const isAdmin = acIsAdmin();
        const isMyClass = isOwner || isAdmin || (currentClassInfo && (currentClassInfo.homeroomEmail === myEmail || currentClassInfo.subEmail === myEmail));

        if (isMyClass) {
            printBtn.style.display = "flex";
            printBtn.addEventListener("click", window.openPrintModal);
        } else {
            printBtn.style.display = "none";
        }
    }

    // 팝업 오버레이 클릭 시 닫기
    const overlay = document.getElementById("overlay");
    if (overlay) {
        overlay.addEventListener("click", closePopup);
    }

    // 학급 빈 바탕 화면 롱프레스 (전입생 추가) 바인딩
    setupEmptyAreaLongPress();
}


function loadStudents() {
    const list = document.getElementById("student-list");
    list.classList.add("loading");

    const classKey = customMenuId ? `custom-${customMenuId}` : `${grade}-${classNum}`;

    // 2025년도 아카이브는 실시간 배지가 불필요하므로 건너뜁니다
    let fetchMainData;
    if (customMenuId) {
        fetchMainData = fetchCustomMenuById(customMenuId).then(menu => {
            if (menu && menu.student_pids && menu.student_pids.length > 0) {
                return fetchStudentsByPids(menu.student_pids);
            }
            return [];
        });
    } else {
        fetchMainData = fetchStudentsByClass(grade, classNum, year);
    }

    const fetchPromises = [
        fetchMainData
    ];

    if (year !== '2025') {
        fetchPromises.push(fetchDetailedRecordCounts(classKey));
    } else {
        fetchPromises.push(Promise.resolve({})); // 빈 객체로 채움
    }

    Promise.all(fetchPromises)
        .then(([data, detailedCounts]) => {
            list.classList.remove("loading");
            list.innerHTML = "";

            if (!Array.isArray(data)) {
                list.textContent = "데이터 형식이 올바르지 않습니다.";
                return;
            }

            // 해당 반 학생 전체 (전출, 자퇴생 포함 - 스타일로 구분)
            const filtered = data;

            // 학급 전체 기록 건수 합산 (재학생 기준 - 자퇴/전출/퇴학 제외)
            const totalClassRecords = filtered.reduce((acc, s) => {
                const status = String(s["학적"] || "").trim();
                const isInactive = status.includes("자퇴") || status.includes("전출") || status.includes("퇴학");
                const c = detailedCounts[s.pid] || { good: 0, normal: 0, bad: 0, early: 0, out: 0 };
                const sTotal = (c.good || 0) + (c.normal || 0) + (c.bad || 0) + (c.early || 0) + (c.out || 0);
                return isInactive ? acc : acc + sTotal;
            }, 0);

            const titleElement = document.getElementById("class-title");
            if (titleElement && grade && classNum) {
                titleElement.innerHTML = `${grade}학년 ${classNum}반 <span style="font-size: 0.65em; color: #64748b; font-weight: 500; margin-left: 6px;">(${totalClassRecords}건)</span>`;
            }

            // 정렬 로직 (개인 그룹인 경우 학번순, 그 외는 번호순)
            if (customMenuId) {
                filtered.sort((a, b) => {
                    const idA = String(a["학번"] || a.student_id || "");
                    const idB = String(b["학번"] || b.student_id || "");
                    return idA.localeCompare(idB);
                });
            } else {
                filtered.sort((a, b) => a["번호"] - b["번호"]);
            }

            // [추가] 전역 캐시에 저장 (팝업 이동용)
            window.allStudents_Cache = filtered;

            filtered.forEach((student, index) => {
                const container = document.createElement("div");
                container.className = "student";
                container.dataset.pid = student.pid;

                // 학적 상태에 따른 스타일 (자퇴/전출/퇴학 등 - 약간 흐리게 처리)
                const status = String(student["학적"] || "").trim();
                const isInactive = status.includes("자퇴") || status.includes("전출") || status.includes("퇴학");
                if (isInactive) {
                    container.classList.add("inactive");
                }

                // 이미지 컨테이너 (배지 배치를 위해 추가)
                const imgContainer = document.createElement("div");
                imgContainer.className = "img-container";

                // 이미지 (Supabase photo_url 우선, 구글 드라이브 하위 호환)
                const img = document.createElement("img");
                const supabasePhotoUrl = student.photo_url;
                const driveLink = student["사진저장링크"] || "";
                const driveFileId = extractDriveId(driveLink || supabasePhotoUrl);

                if (supabasePhotoUrl && supabasePhotoUrl.startsWith('http')) {
                    img.src = supabasePhotoUrl;
                } else if (driveFileId) {
                    img.src = getThumbnailUrl(driveFileId);
                } else if (supabasePhotoUrl) {
                    img.src = `https://drive.google.com/thumbnail?id=${supabasePhotoUrl.split('.')[0]}&sz=w500`;
                } else {
                    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                }

                img.loading = "lazy";

                img.onerror = function () {
                    if (this.getAttribute("data-retry")) {
                        this.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                        return;
                    }
                    this.setAttribute("data-retry", "true");
                    if (driveFileId) {
                        this.src = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w500`;
                    }
                };

                imgContainer.appendChild(img);

                // [추가] 학적 상태 배지 (자퇴, 전출, 졸업, 숙려제 등)
                if (status && status !== "재학") {
                    const statusBadge = document.createElement("div");
                    statusBadge.className = "status-badge";

                    if (status.startsWith("숙려제")) {
                        // 숙려제|시작일|종료일 형식 파싱
                        const parts = status.split('|');
                        const startDate = parts[1];
                        const endDate = parts[2];

                        if (startDate && endDate) {
                            const now = new Date();
                            now.setHours(0, 0, 0, 0);
                            const start = new Date(startDate);
                            const end = new Date(endDate);
                            end.setHours(23, 59, 59, 999);

                            if (now >= start && now <= end) {
                                statusBadge.classList.add("cooling-off");
                                statusBadge.textContent = "숙려제";
                                imgContainer.appendChild(statusBadge);
                            }
                        }
                    } else if (status === "graduated") {
                        // 2025학년도 아카이브에서는 졸업 배지를 숨깁니다.
                        if (year !== '2025') {
                            statusBadge.classList.add("graduated");
                            statusBadge.textContent = "졸업";
                            imgContainer.appendChild(statusBadge);
                        }
                    } else {
                        statusBadge.textContent = status;
                        imgContainer.appendChild(statusBadge);
                    }
                }

                // [수정] 상세 기록 건수 배지 (근태 합계 + 3색 분리 표시)
                const counts = detailedCounts[student.pid] || { good: 0, normal: 0, bad: 0, early: 0, out: 0 };
                const conductTotal = (counts.early || 0) + (counts.out || 0);

                if (conductTotal > 0 || counts.good > 0 || counts.normal > 0 || counts.bad > 0) {
                    const recordBadge = document.createElement("div");
                    recordBadge.className = "record-badge-multi";

                    let badgeHtml = "";
                    // 근태 합계(노랑) -> 잘한일(파랑) -> 일반(검정) -> 지도(빨강)
                    if (conductTotal > 0) badgeHtml += `<span class="badge-conduct">${conductTotal}</span>`;
                    if (counts.good > 0) badgeHtml += `<span class="badge-good">${counts.good}</span>`;
                    if (counts.normal > 0) badgeHtml += `<span class="badge-normal">${counts.normal}</span>`;
                    if (counts.bad > 0) badgeHtml += `<span class="badge-bad">${counts.bad}</span>`;

                    recordBadge.innerHTML = badgeHtml;
                    imgContainer.appendChild(recordBadge);
                }

                // [추가] 근태 뱃지 (조퇴/외출 현재 상태 표시 / 사진 왼쪽 상단)
                // numeric badge는 위에서 누적(conductTotal)으로 표시하고, 사진 위 뱃지는 현재 상태만 표시
                if (counts.isEarlyToday || counts.isOutingNow) {
                    const conductBadgeContainer = document.createElement("div");
                    conductBadgeContainer.className = "conduct-badge-container";

                    let conductHtml = "";
                    if (counts.isEarlyToday) conductHtml += `<span class="conduct-badge badge-early">조퇴</span>`;
                    if (counts.isOutingNow) conductHtml += `<span class="conduct-badge badge-out">외출</span>`;

                    conductBadgeContainer.innerHTML = conductHtml;
                    imgContainer.appendChild(conductBadgeContainer);
                }

                // 이름 및 학번 표시
                const nameDiv = document.createElement("div");
                nameDiv.className = "student-name";

                // [수정] 개인 그룹 화면인 경우 학번 전체 표시, 그 외는 번호 표시
                let displayNum;
                if (customMenuId) {
                    displayNum = student["학번"] || student.student_id || "----";
                } else {
                    displayNum = student["번호"] || (student["학번"] ? String(student["학번"]).slice(-2) : "??");
                    // 한 자리 숫자인 경우 앞에 0 붙임 (예: 1 -> 01)
                    if (displayNum && !isNaN(displayNum) && String(displayNum).length === 1) {
                        displayNum = "0" + displayNum;
                    }
                }
                const studentName = student["이름"] || "이름없음";

                // 번호와 이름을 명확하게 span으로 감싸고 아이콘 제거
                nameDiv.innerHTML = `
                        <div class="name-badge">
                            <span class="student-num">${displayNum}</span>
                            <span class="student-nm">${studentName}</span>
                        </div>
                    `;

                container.appendChild(imgContainer);
                container.appendChild(nameDiv);

                // 롱 프레스 및 클릭 로직 구현 (고스트 터치 완벽 방지)
                let pressTimer;
                let isLongPress = false;
                let moved = false;
                let startX, startY;

                const onStart = (e) => {
                    const touch = e.type.indexOf('touch') === 0 ? e.touches[0] : e;
                    startX = touch.clientX;
                    startY = touch.clientY;
                    moved = false;
                    isLongPress = false;

                    container.classList.add("pressing");
                    clearTimeout(pressTimer);
                    pressTimer = setTimeout(() => {
                        isLongPress = true;
                        container.classList.remove("pressing");
                        container.classList.add("long-pressed");
                        if (navigator.vibrate) navigator.vibrate(50);
                        showActionModal(student);
                    }, 600);
                };

                const onMove = (e) => {
                    if (!startX || !startY) return;
                    const touch = e.type.indexOf('touch') === 0 ? e.touches[0] : e;
                    const dx = Math.abs(touch.clientX - startX);
                    const dy = Math.abs(touch.clientY - startY);

                    // 8px 이상 움직이면 드래그로 간주
                    if (dx > 8 || dy > 8) {
                        moved = true;
                        clearTimeout(pressTimer);
                        container.classList.remove("pressing");
                    }
                };

                const onEnd = (e) => {
                    if (!startX || !startY) return; // 해당 요소에서 시작하지 않았으면 무시
                    clearTimeout(pressTimer);
                    container.classList.remove("pressing");
                    container.classList.remove("long-pressed");

                    // 롱프레스가 아니었고, 드래그도 아니었을 경우에만 팝업 표시
                    if (!isLongPress && !moved) {
                        // touchend에서만 호출하여 mouseup과의 중복(고스트 터치) 방지
                        if (e.type === 'touchend') {
                            e.preventDefault();
                            showPopup(student);
                        } else if (e.type === 'mouseup' && e.which === 1) {
                            // 터치 기기가 아닐 때만 mouseup으로 처리
                            showPopup(student);
                        }
                    }
                    startX = startY = null;
                };

                // 이벤트 등록
                container.addEventListener("mousedown", onStart);
                container.addEventListener("mousemove", onMove);
                container.addEventListener("mouseup", onEnd);

                // 마우스가 요소를 벗어나면 타이머 취소
                container.addEventListener("mouseleave", () => {
                    clearTimeout(pressTimer);
                    container.classList.remove("pressing");
                    container.classList.remove("long-pressed");
                    startX = startY = null;
                });

                container.addEventListener("touchstart", onStart, { passive: false });
                container.addEventListener("touchmove", onMove, { passive: true });
                container.addEventListener("touchend", onEnd, { passive: false });

                // 우클릭 이벤트 (PC)
                container.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    showActionModal(student);
                });

                list.appendChild(container);
            });

            if (filtered.length === 0) {
                list.textContent = "👀 해당 반의 데이터가 없습니다.";
            }

            // 생활기록/분석 페이지에서 "뒤로" 눌러 돌아온 경우, 해당 학생 상세(기초조사) 팝업을 다시 연다
            const openNum = urlParams.get("open");
            if (openNum) {
                const target = filtered.find(s =>
                    String(s["학번"] || s.student_id || "") === String(openNum));
                if (target) showPopup(target);
            }
        })
        .catch(err => {
            const list = document.getElementById("student-list");
            if (list) list.textContent = "❌ 데이터를 불러올 수 없습니다.";
            console.error("Fetch Error:", err);
        });
}

// 최적의 값을 찾기 위한 헬퍼 함수 (다양한 키 형태 지원)
function getValue(obj1, obj2, ...keys) {
    const isValid = (v) => v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "." && String(v).trim() !== "없음";

    // 우선순위 1: obj1 (DB 수정 데이터 등)에서 모든 키를 먼저 확인
    for (let key of keys) {
        if (isValid(obj1[key])) return String(obj1[key]).trim();
        const upper = key.toUpperCase();
        if (isValid(obj1[upper])) return String(obj1[upper]).trim();
        const noSpace = key.replace(/\s/g, "");
        if (isValid(obj1[noSpace])) return String(obj1[noSpace]).trim();
    }

    // 우선순위 2: obj1에서 못 찾은 경우에만 obj2 (기존 설문 데이터 등) 확인
    for (let key of keys) {
        if (isValid(obj2[key])) return String(obj2[key]).trim();
        const upper = key.toUpperCase();
        if (isValid(obj2[upper])) return String(obj2[upper]).trim();
        const noSpace = key.replace(/\s/g, "");
        if (isValid(obj2[noSpace])) return String(obj2[noSpace]).trim();
    }

    return "";
}

// 친밀도 수치 -> 한글 텍스트 매핑
const intimacyMap = {
    "1": "매우 소원함",
    "2": "소원함",
    "3": "보통",
    "4": "친밀함",
    "5": "매우 친밀함"
};

// 팝업 관련 함수
async function showPopup(student) {
    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (!popup || !overlay) return;

    overlay.style.display = "block";
    popup.style.display = "block";
    popup.className = "student-detail-popup";

    // 배경 스크롤 방지
    document.body.style.overflow = "hidden";

    // [수정] 모든 플로팅 버튼 숨기기
    const floaters = ["#home-btn", "#print-btn", "#survey-viewer-btn", "#contact-download-btn", ".floating-controls"];
    floaters.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            el.dataset.prevDisplay = window.getComputedStyle(el).display;
            el.style.display = "none";
        }
    });

    // 팝업 열 때 기초조사 데이터 추가 로딩
    let surveyRaw = {};
    try {
        const { data, error } = await supabase
            .from('surveys')
            .select('*')
            .eq('student_pid', student.pid)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!error && data) {
            // [M2] 응답 본문(data.data)만 — id/school_id/student_pid 등 행 메타는 제외
            surveyRaw = { ...(data.data || {}) };
        }
    } catch (e) {
        console.warn("Survey fetch error:", e);
    }

    const surveyData = {};
    // 모든 키를 대문자로 정규화한 객체도 준비 (매칭 확률 높임)
    for (let k in surveyRaw) {
        surveyData[k] = surveyRaw[k];
        surveyData[k.toUpperCase()] = surveyRaw[k];
    }

    const supabasePhotoUrl = student.photo_url;
    const driveFileId = extractDriveId(student["사진저장링크"] || student.photo_url);
    let imgSrc = "";
    if (supabasePhotoUrl && supabasePhotoUrl.startsWith('http')) {
        imgSrc = supabasePhotoUrl;
    } else if (driveFileId) {
        imgSrc = getThumbnailUrl(driveFileId);
    }
    const fallbackImgSrc = driveFileId ? `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1000` : '';

    const createInfoRow = (label, val) => {
        let valStr = String(val || "").trim();
        if (valStr === "" || valStr === "null" || valStr === "undefined" || valStr === "없음") {
            valStr = ".";
        }

        const lowLabel = label.toLowerCase();

        // 친밀도 수치 -> 텍스트 변환
        let displayVal = valStr;
        if (label.includes("친밀도") && intimacyMap[valStr]) {
            displayVal = intimacyMap[valStr];
        }

        const isPhone = (label.includes("전화") || label.includes("연락처") || (label.includes("번호") && label !== "번호" && label !== "학번" && !label.includes("우편")) || label.includes("폰"));
        const isInsta = lowLabel.includes("인스타") || lowLabel.includes("insta");

        if (isPhone && valStr !== "." && valStr.length > 5) {
            const cleanPhone = valStr.replace(/[^0-9]/g, "");
             displayVal = `
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>${valStr}</span>
                    <a href="tel:${cleanPhone}" onclick="event.stopPropagation();" style="display: inline-flex; align-items: center; justify-content: center; background: #fee2e2; color: #ef4444; width: 28px; height: 28px; border-radius: 50%; text-decoration: none; font-size: 0.9rem; transition: transform 0.2s;" onmousedown="this.style.transform='scale(0.9)'" onmouseup="this.style.transform='scale(1)'">📞</a>
                </div>
            `;
        } else if (isInsta && valStr !== ".") {
            const cleanId = valStr.replace('@', '').trim();
            displayVal = `<a href="https://instagram.com/${cleanId}" target="_blank" style="color: #c13584; text-decoration: underline; font-weight: 800;">${valStr}</a>`;
        }

        return `<div class="detail-info-row">
            <span class="detail-label">${label}</span>
            <span class="detail-value">${displayVal}</span>
        </div>`;
    };

    // 2사분면: 기본 정보 (순서: 연락처, 인스타, 집주소, 학적, 성별)
    let infoHtml2 = "";
    infoHtml2 += createInfoRow("연락처", getValue(student, surveyData, "연락처", "contact", "학생폰", "학생 연락처"));
    infoHtml2 += createInfoRow("인스타id", getValue(student, surveyData, "인스타id", "인스타 id", "인스타 아이디", "인스타", "instagram", "insta", "SNS"));
    infoHtml2 += createInfoRow("집주소", getValue(student, surveyData, "주소", "집주소", "address"));
    infoHtml2 += createInfoRow("학적", getValue(student, surveyData, "학적", "status"));
    infoHtml2 += createInfoRow("성별", getValue(student, surveyData, "성별", "gender"));

    // 3사분면: 연락처 및 가족 (순서: 주보호자 관계, 주보호자 연락처, 주보호자 친밀도, 보조보호자 관계, 보조보호자 연락처, 보조보호자 친밀도, 거주가족)
    let infoHtml3 = "";
    infoHtml3 += createInfoRow("주보호자 관계", getValue(student, surveyData, "주보호자 관계", "보호자관계", "PARENT_RELATION", "parent_relation"));
    infoHtml3 += createInfoRow("주보호자 연락처", getValue(student, surveyData, "주보호자 연락처", "보호자연락처", "PARENT_CONTACT", "parent_contact"));
    infoHtml3 += createInfoRow("주보호자 친밀도", getValue(student, surveyData, "주보호자 친밀도", "친밀도"));
    infoHtml3 += createInfoRow("보조보호자 관계", getValue(student, surveyData, "보조보호자 관계"));
    infoHtml3 += createInfoRow("보조보호자 연락처", getValue(student, surveyData, "보조보호자 연락처"));
    infoHtml3 += createInfoRow("보조보호자 친밀도", getValue(student, surveyData, "보조보호자 친밀도"));
    infoHtml3 += createInfoRow("거주가족", getValue(student, surveyData, "거주가족", "가족구성"));

    // 4사분면: 상세 기초조사 (기초조사 설문 순서대로 정렬 및 중복 제거)
    let infoHtml4 = "";
    
    // 이미 2, 3사분면에서 사용된 키들 (제외 대상)
    const usedKeys = [
        "번호", "학번", "student_id", "연락처", "contact", "학생폰", "학생 연락처", "인스타id", "인스타 id", "인스타 아이디", "인스타", "instagram", "insta", "SNS", "주소", "집주소", "address", "학적", "status", "성별", "gender",
        "주보호자 관계", "주보호자 연락처", "주보호자 친밀도", "보조보호자 관계", "보조보호자 연락처", "보조보호자 친밀도", "거주가족", "가족구성", "보호자관계", "보호자연락처", "보호자 연락처", "주보호자연락처", "보조보호자연락처", "주보호자친밀도", "보조보호자친밀도", "주보호자관계", "보조보호자관계"
    ];

    // 기술적인 필드 및 메타데이터 (제외 대상)
    const techKeys = [
        "학년", "반", "이름", "PID", "연번", "submitted_at", "pid", "photo_url", "photo_path", "created_at", "updated_at", "data", "id", "student_pid", "school_id", "비밀번호", "사진저장링크", "파일명", "학생별시트", "입력시간", "ACADEMIC_YEAR", "CLASS_INFO", "NAME", "우편번호", "상세주소"
    ];

    // [M2] 학교 설문 스키마 순서/라벨로 표시. 2·3사분면에서 이미 쓴 필드는 제외.
    const shownInOther = new Set(['name', 'photo', 'gender', 'contact', 'birth_date', 'address', 'instagram',
        'guardian_primary', 'guardian_secondary', 'siblings']);
    const processedKeys = new Set();
    surveyFields().forEach(f => {
        if (shownInOther.has(f.id)) { processedKeys.add(f.id.toUpperCase()); return; }
        const val = surveyRaw[f.id];
        if (val !== undefined && val !== null && String(val).trim() !== "" && String(val).trim() !== "없음" && String(val).trim() !== ".") {
            infoHtml4 += createInfoRow(surveyLabel(f.id), val);
            processedKeys.add(f.id.toUpperCase());
        }
    });

    // 2. 혹시 누락된 키가 있다면 (usedKeys, techKeys 제외) 추가로 표시
    Object.keys(surveyRaw).forEach(k => {
        const uk = k.toUpperCase();
        if (processedKeys.has(uk)) return;
        
        const isInUsed = usedKeys.some(key => key.toUpperCase() === uk);
        const isInTech = techKeys.some(key => key.toUpperCase() === uk);
        if (isInUsed || isInTech) return;

        const val = surveyRaw[k];
        if (val !== undefined && val !== null && String(val).trim() !== "" && String(val).trim() !== "없음" && String(val).trim() !== ".") {
            infoHtml4 += createInfoRow(k, val);
        }
    });

    // 권한 확인 (본인 학급 담임/부담임 여부 또는 관리자)
    const myEmail = getCurrentTeacherEmail();
    const currentClassInfo = window.classInfoData ? window.classInfoData.find(c => c.grade === grade && c.class === classNum) : null;

    // 관리자/소유자/상담교사 권한 체크
    const isAdmin = window.currentTeacher && (
        window.currentTeacher.role === 'admin' ||
        window.currentTeacher.role === 'counselor' ||
        acIsAdmin()
    );

    // [M2] 학년부장 하드코딩 이메일 맵 제거 — 학교 설정의 managed_grade / grade_head 역할로 모델링 예정
    const studentGrade = student.class_info ? parseInt(student.class_info.split('-')[0]) : (student["학년"] || student.academic_year);
    const myManagedGrade = window.currentTeacher?.managed_grade
        || (window.currentTeacher?.settings && window.currentTeacher.settings.managed_grade);
    const isGradeHead = myManagedGrade && parseInt(myManagedGrade) === studentGrade;

    const isAuthorized = isAdmin || (currentClassInfo && (
        currentClassInfo.homeroomEmail === myEmail ||
        currentClassInfo.subEmail === myEmail
    ));

    // 기초조사 열람 권한 (담임/관리자/학년부장)
    // 학년부장은 열람만 가능하므로 canViewSurvey에는 포함하되, 수정 권한인 isAuthorized에는 포함하지 않음
    const canViewSurvey = isAuthorized || isGradeHead;

    if (!canViewSurvey) {
        infoHtml3 = `<div class="no-access-msg" style="padding:20px; text-align:center; color:#999; font-size:0.9em;">
            🔒 가족 정보와 연락처는<br>담임/부담임 선생님만 조회가 가능합니다.
        </div>`;
        infoHtml4 = `<div class="no-access-msg" style="padding:20px; text-align:center; color:#999; font-size:0.9em;">
            🔒 상세 기초조사 내용은<br>담임/부담임 선생님 전용 정보입니다.
        </div>`;
    }


    const escapedStudent = JSON.stringify(student).replace(/"/g, '&quot;');
    const photoImg = imgSrc ? `<img src="${imgSrc}" onerror="this.src='${fallbackImgSrc}'" alt="${student["이름"]} 사진">` : `<div class="no-photo-placeholder">📷<br>사진 없음</div>`;

    popup.innerHTML = `
        <div class="popup-header">
            <button class="popup-back-btn" onclick="closePopup()" style="width: 44px; height: 44px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05); flex-shrink: 0;">
                <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: #64748b;"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <div class="popup-title-center" style="display: flex; align-items: center; gap: 8px;">
                <span class="student-id-badge" style="background: #eff6ff; color: #3b82f6; padding: 4px 10px; border-radius: 8px; font-weight: 800; font-size: 0.95rem;">${student["학번"]}</span>
                <span class="student-name-text" style="font-size: 1.25rem; font-weight: 800; color: #1e293b;">${student["이름"]}</span>
                <div style="display: flex; gap: 6px;">
                    <button class="popup-analysis-btn" onclick="goToAnalysis(${escapedStudent})" style="background:#f0f7ff; border: 1.5px solid #4A90E2; color:#4A90E2; padding: 6px 14px; border-radius: 10px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 0.9rem; transition: all 0.2s;">🧠 분석</button>
                    <button class="popup-record-btn" onclick="showRecord(${escapedStudent})" style="background:#ffffff; border: 1.5px solid #0f52ba; color:#0f52ba; padding: 6px 14px; border-radius: 10px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 0.9rem; transition: all 0.2s;">📝 생활기록</button>
                </div>
            </div>
            <div style="width: 44px;"></div> <!-- 우측 균형용 빈 공간 -->
        </div>
        
        <div class="popup-content-layout">
            <!-- 이동 버튼은 본인 학급일 때만 표시하거나, 이동 시에도 권한 체크가 유지되므로 일단 유지 또는 비활성화 -->
            <button class="nav-arrow-btn left" id="popup-prev-btn" ${!isAuthorized ? 'style="display:none;"' : ''}>
                <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>

            <div class="popup-quadrants-container">
                <div class="popup-quadrant quad-1">
                    <div class="quad-inner">
                        <div class="quad-label">사진</div>
                        <div class="photo-wrapper">${photoImg}</div>
                    </div>
                </div>
                <div class="popup-quadrant quad-2">
                    <div class="quad-inner">
                        <div class="quad-label" style="display:flex; align-items:center; justify-content:space-between;">
                            <span>기본 정보</span>
                            ${isAuthorized ? `<button onclick="openContactEditModal(${escapedStudent})" style="background:rgba(59,130,246,0.1); border:1.5px solid rgba(59,130,246,0.3); color:#3b82f6; border-radius:8px; padding:3px 10px; font-size:0.75rem; font-weight:700; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(59,130,246,0.2)'" onmouseout="this.style.background='rgba(59,130,246,0.1)'">✏️ 수정</button>` : ''}
                        </div>
                        <div class="quad-scroll">
                            ${infoHtml2 || '<div class="no-data-msg">-</div>'}
                        </div>
                    </div>
                </div>
                <div class="popup-quadrant quad-3">
                    <div class="quad-inner">
                        <div class="quad-label" style="display:flex; align-items:center; justify-content:space-between;">
                            <span>연락처 및 가족</span>
                            ${isAuthorized ? `<button onclick="openParentContactEditModal(${escapedStudent})" style="background:rgba(16,185,129,0.1); border:1.5px solid rgba(16,185,129,0.3); color:#10b981; border-radius:8px; padding:3px 10px; font-size:0.75rem; font-weight:700; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(16,185,129,0.2)'" onmouseout="this.style.background='rgba(16,185,129,0.1)'">✏️ 수정</button>` : ''}
                        </div>
                        <div class="quad-scroll">
                            ${infoHtml3}
                        </div>
                    </div>
                </div>
                <div class="popup-quadrant quad-4">
                    <div class="quad-inner">
                        <div class="quad-label">상세 기초조사</div>
                        <div class="quad-scroll">
                            ${infoHtml4}
                        </div>
                    </div>
                </div>
            </div>

            <button class="nav-arrow-btn right" id="popup-next-btn" ${!isAuthorized ? 'style="display:none;"' : ''}>
                <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
        </div>
    `;

    // 이동 버튼 이벤트 바인딩
    setupPopupNavigation(student);

    // 팝업 열릴 때 전역 키보드 이벤트 리스너 등록
    window._popupKeyHandler = function (e) {
        if (popup.style.display === "block") {
            if (e.key === "Escape") {
                e.preventDefault();
                closePopup();
            } else if (e.key === "ArrowLeft") {
                document.getElementById("popup-prev-btn")?.click();
            } else if (e.key === "ArrowRight") {
                document.getElementById("popup-next-btn")?.click();
            }
        }
    };
    document.addEventListener("keydown", window._popupKeyHandler);
}

// 팝업 내 번호 이동 로직 완성
function setupPopupNavigation(currentStudent) {
    const prevBtn = document.getElementById("popup-prev-btn");
    const nextBtn = document.getElementById("popup-next-btn");
    if (!prevBtn || !nextBtn || !window.allStudents_Cache) return;

    const currentIndex = window.allStudents_Cache.findIndex(s => s.pid === currentStudent.pid);
    if (currentIndex === -1) return;

    // 이전 학생
    if (currentIndex > 0) {
        prevBtn.onclick = () => {
            const prevStudent = window.allStudents_Cache[currentIndex - 1];
            showPopup(prevStudent);
        };
    } else {
        prevBtn.style.visibility = "hidden";
    }

    // 다음 학생
    if (currentIndex < window.allStudents_Cache.length - 1) {
        nextBtn.onclick = () => {
            const nextStudent = window.allStudents_Cache[currentIndex + 1];
            showPopup(nextStudent);
        };
    } else {
        nextBtn.style.visibility = "hidden";
    }
}

window.closePopup = function () {
    console.log("Close popup button clicked");
    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");

    // 배경 스크롤 해제
    document.body.style.overflow = "";

    if (popup) {
        popup.style.display = "none";
        popup.className = "";
    }
    if (overlay) overlay.style.display = "none";

    if (window._popupKeyHandler) {
        document.removeEventListener("keydown", window._popupKeyHandler);
        window._popupKeyHandler = null;
    }

    // [수정] 모든 플로팅 버튼 다시 보이기
    const floaters = ["#home-btn", "#print-btn", "#survey-viewer-btn", "#contact-download-btn", ".floating-controls"];
    floaters.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            // 저장된 이전 상태로 복구 (또는 기본값)
            el.style.display = el.dataset.prevDisplay || (selector.startsWith('.') ? "flex" : "block");

            // 만약 연락처 버튼 등 특정 조건에서만 보여야 하는 버튼은 원래 로직이 다시 체크하도록 유도하거나 
            // 여기서는 단순히 display만 복구함 (setupEventListeners에서 조건부 노출함)
            if (selector === "#contact-download-btn" || selector === "#survey-viewer-btn") {
                // 이 버튼들은 권한에 따라 다시 세팅되어야 할 수도 있으므로 체크 필요
                // 여기서는 일단 보이게 함
            }
        }
    });
}

// 페이지 이동 및 모달 액션
window.showRecord = function (student) {
    const name = encodeURIComponent(student["이름"]);
    const num = encodeURIComponent(student["학번"]);
    window.location.href = `record.html?num=${num}&name=${name}`;
}

window.showCounsel = function (student) {
    const name = encodeURIComponent(student["이름"]);
    const num = encodeURIComponent(student["학번"]);
    window.location.href = `record.html?num=${num}&name=${name}&mode=counsel`;
}

window.goToAnalysis = function (student) {
    const sid = encodeURIComponent(student["학번"]);
    window.location.href = `analysis.html?sid=${sid}`;
}

window.showActionModal = function (student) {
    const existing = document.getElementById("action-modal");
    if (existing) existing.remove();

    const displayNum = student["번호"] || (student["학번"] ? String(student["학번"]).slice(-2) : "??");

    const modal = document.createElement("div");
    modal.id = "action-modal";
    modal.className = "guidance-tooltip-overlay";
    modal.innerHTML = `
        <div class="guidance-tooltip-content" style="background: white; width: 95%; max-width: 480px; border-radius: 32px; padding: 30px 20px 25px; position: relative; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); animation: modalIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);">
            <!-- 상단 타이틀 및 X 버튼 통합 헤더 -->
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 25px; padding: 0 40px; position: relative;">
                <h2 id="action-modal-title" style="font-size: 1.4rem; font-weight: 800; color: #1e293b; margin: 0; letter-spacing: -1px; text-align: center;">
                    [${displayNum}번] ${student["이름"]} 기록 메뉴
                </h2>
                <!-- 상단 X 닫기 버튼 -->
                <button onclick="this.closest('.guidance-tooltip-overlay').remove()" style="position: absolute; right: 0; background: #f1f5f9; border: none; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: #64748b; cursor: pointer; transition: all 0.2s; z-index: 10;">✕</button>
            </div>
            
            <div id="action-grid-main" style="display: flex; flex-direction: column; gap: 12px;">
                <button class="action-btn" onclick="goToAnalysis(${JSON.stringify(student).replace(/"/g, '&quot;')})" style="background:#f0f7ff; border-color:#cce4f7; color:#0f52ba;">
                   <span class="action-icon">🧠</span> 1. 학생 분석
                </button>
                <button class="action-btn" onclick="showCounsel(${JSON.stringify(student).replace(/"/g, '&quot;')})" style="background:#fff9db; border-color:#ffe066; color:#e67e22;">
                   <span class="action-icon">💬</span> 2. 상담 기록 작성
                </button>
                <button class="action-btn" onclick="showRecord(${JSON.stringify(student).replace(/"/g, '&quot;')})">
                   <span class="action-icon">📒</span> 3. 생활기록 작성
                </button>
                <button class="action-btn" onclick="openAttendanceModal(${JSON.stringify(student).replace(/"/g, '&quot;')})">
                   <span class="action-icon">🏃</span> 4. 근태기록 (조퇴/외출)
                </button>
                <button class="action-btn" onclick="openStatusModal(${JSON.stringify(student).replace(/"/g, '&quot;')})">
                   <span class="action-icon">🪪</span> 5. 학적상태 변경
                </button>
            </div>
        </div>
    `;

    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
};

window.openAttendanceModal = function (student) {
    const grid = document.getElementById("action-grid-main");
    if (!grid) return;

    // 타이틀 변경
    const titleEl = document.getElementById("action-modal-title");
    if (titleEl) {
        const displayNum = student["번호"] || (student["학번"] ? String(student["학번"]).slice(-2) : "??");
        titleEl.textContent = `[${displayNum}번] ${student["이름"]} 조퇴/외출 기록`;
    }

    grid.innerHTML = `
        <div class="attendance-input-card" style="background: #f8fafc; padding: 25px 15px; border-radius: 20px; border: 1px solid #e2e8f0; margin-bottom: 20px; width: 100%;">
            <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <!-- 조퇴/외출 토글 (중앙 배치) -->
                <div class="attendance-type-toggle" id="attendance-type-toggle" data-current="외출" style="display: flex; background: #e2e8f0; padding: 4px; border-radius: 12px; height: 52px; width: 240px; cursor: pointer; position: relative;">
                    <div class="type-slider" style="position: absolute; top: 4px; left: 4px; width: 116px; height: 44px; background: white; border-radius: 10px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></div>
                    <div class="type-option active" data-value="외출" style="flex:1; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 800; z-index: 1; color: #1e293b; text-align: center;">외출</div>
                    <div class="type-option" data-value="조퇴" style="flex:1; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 800; z-index: 1; color: #64748b; text-align: center;">조퇴</div>
                </div>
            </div>
            
            <div class="attendance-input-grid" style="display: flex; gap: 15px;">
                <!-- 시작 시간 그룹 -->
                <div class="attendance-input-col" style="flex:1;">
                    <div class="attendance-input-label">시작 시간</div>
                    <div class="ampm-toggle-container" id="ampm-toggle" data-current="오전" style="margin-bottom: 8px; width: 100%; height: 47px;">
                        <div class="ampm-toggle-slider" style="border-radius: 12px;"></div>
                        <div class="ampm-toggle-option active" data-value="오전" style="font-size: 0.95rem;">오전</div>
                        <div class="ampm-toggle-option" data-value="오후" style="font-size: 0.95rem;">오후</div>
                    </div>
                    <!-- 시작 시간 퀵 버튼 추가 -->
                    <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; width: 100%;">
                        <div class="time-quick-group" style="display: flex; gap: 4px; width: 100%;">
                            <button class="time-quick-btn" onclick="adjustTime('out-start-time', 'SET_ZERO')" style="flex:1; height: 47px; font-size: 0.9rem; border-radius: 10px;">정각</button>
                            <button class="time-quick-btn" onclick="adjustTime('out-start-time', 10)" style="flex:1; height: 47px; font-size: 0.9rem; border-radius: 10px;">+10분</button>
                            <button class="time-quick-btn" onclick="adjustTime('out-start-time', -10)" style="flex:1; height: 47px; font-size: 0.9rem; border-radius: 10px;">-10분</button>
                        </div>
                        <div class="time-quick-group" style="display: flex; gap: 4px; width: 100%;">
                            <button class="time-quick-btn" onclick="adjustTime('out-start-time', 60)" style="flex:1; height: 47px; font-size: 0.9rem; border-radius: 10px;">+1시간</button>
                            <button class="time-quick-btn" onclick="adjustTime('out-start-time', -60)" style="flex:1; height: 47px; font-size: 0.9rem; border-radius: 10px;">-1시간</button>
                        </div>
                    </div>
                    <input type="time" id="out-start-time" class="no-ampm-input" style="width:100%; padding:14px; border-radius:16px; border:1.5px solid #e2e8f0; font-family:inherit; font-size:1.3rem; text-align:center; background: #ffffff; font-weight: 800; color: #1e293b;" required> 
                </div>
                
                <div style="padding-bottom:18px; color:#cbd5e1; font-weight:900; font-size: 1.2rem;">~</div>
                
                <!-- 종료 시간 그룹 (조퇴 시 숨김 처리 고려) -->
                <div class="attendance-input-col" id="end-time-section" style="flex:1;">
                    <div class="attendance-input-label">종료 시간</div>
                    <div class="time-quick-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; width: 100%; margin-top: 55px;">
                        <button class="time-quick-btn" onclick="adjustTime('out-end-time', 30)" style="height: 47px; font-size: 0.9rem; border-radius: 10px; line-height: 1.2;">+30분</button>
                        <button class="time-quick-btn" onclick="adjustTime('out-end-time', -30)" style="height: 47px; font-size: 0.9rem; border-radius: 10px; line-height: 1.2;">-30분</button>
                        <button class="type-dependent-btn" onclick="adjustTime('out-end-time', 60)" style="height: 47px; font-size: 0.9rem; border-radius: 10px; background:white; border:1px solid #e2e8f0; color:#475569; line-height: 1.2;">+1시간</button>
                        <button class="type-dependent-btn" onclick="adjustTime('out-end-time', -60)" style="height: 47px; font-size: 0.9rem; border-radius: 10px; background:white; border:1px solid #e2e8f0; color:#475569; line-height: 1.2;">-1시간</button>
                    </div>
                    <input type="time" id="out-end-time" class="no-ampm-input" style="width:100%; padding:14px; border-radius:16px; border:1.5px solid #e2e8f0; font-family:inherit; font-size:1.3rem; text-align:center; background: #ffffff; font-weight: 800; color: #1e293b;" required>
                </div>
            </div>
        </div>

        <button id="attendance-submit-btn" class="action-submit-btn" onclick="saveAttendance(${JSON.stringify(student).replace(/"/g, '&quot;')})" style="background: #3b82f6; margin-top: 10px; font-weight: 800; font-size: 1.25rem;">
            🏃 외출 기록 저장
        </button>
    `;

    // 현재 시간 세팅 (시작 시간 기본값)
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('out-start-time').value = `${hh}:${mm}`;

    // 오전/오후 토글 로직
    const ampmToggle = document.getElementById("ampm-toggle");
    const ampmOptions = ampmToggle.querySelectorAll(".ampm-toggle-option");

    let currentAmPm = "오전";

    ampmToggle.onclick = (e) => {
        currentAmPm = (currentAmPm === "오전") ? "오후" : "오전";
        ampmToggle.classList.toggle("pm", currentAmPm === "오후");
        ampmOptions.forEach(opt => {
            opt.classList.toggle("active", opt.getAttribute("data-value") === currentAmPm);
        });
        ampmToggle.setAttribute("data-current", currentAmPm);

        if (window.navigator && window.navigator.vibrate) {
            window.navigator.vibrate(8);
        }
    };

    // 조퇴/외출 토글 로직
    const typeToggle = document.getElementById("attendance-type-toggle");
    const typeOptions = typeToggle.querySelectorAll(".type-option");
    const typeSlider = typeToggle.querySelector(".type-slider");
    const endTimeSection = document.getElementById("end-time-section");
    const submitBtn = document.getElementById("attendance-submit-btn");

    const updateAttendanceTypeUI = (type) => {
        typeOptions.forEach(opt => {
            const isActive = opt.getAttribute("data-value") === type;
            opt.classList.toggle("active", isActive);
            opt.style.color = isActive ? '#1e293b' : '#64748b';
        });
        typeSlider.style.transform = type === "조퇴" ? "translateX(100%)" : "translateX(0)";
        typeToggle.setAttribute("data-current", type);

        if (type === "조퇴") {
            endTimeSection.style.display = "none";
            submitBtn.innerHTML = `🏠 조퇴 기록 저장`;
            submitBtn.style.background = "#fefce8";
            submitBtn.style.color = "#a16207";
            submitBtn.style.borderColor = "#fef08a";
            submitBtn.style.boxShadow = "0 2px 4px rgba(254, 240, 138, 0.2)";
        } else {
            endTimeSection.style.display = "block";
            submitBtn.innerHTML = `🏃 외출 기록 저장`;
            submitBtn.style.background = "#3b82f6";
            submitBtn.style.color = "white";
            submitBtn.style.borderColor = "transparent";
            submitBtn.style.boxShadow = "0 12px 24px rgba(0, 122, 255, 0.25)";
        }
    };

    typeToggle.onclick = (e) => {
        const currentType = typeToggle.getAttribute("data-current");
        const newType = currentType === "외출" ? "조퇴" : "외출";
        updateAttendanceTypeUI(newType);
        if (window.navigator && window.navigator.vibrate) {
            window.navigator.vibrate(8);
        }
    };

    // 초기 UI 설정 (기본값 '외출')
    updateAttendanceTypeUI(typeToggle.getAttribute("data-current"));
};

// 시간 가산/설정 함수
window.adjustTime = function (inputId, minutesToAdd) {
    const input = document.getElementById(inputId);
    const startTimeInput = document.getElementById('out-start-time');

    // 사용자가 입력칸을 직접 수정했을 수 있으므로, 매 클릭 시 최신 값을 즉시 파싱합니다.
    let baseTimeStr = input.value;

    // 만약 종료 시간(input)이 비어있다면, 현재 설정된 시작 시간을 기준으로 계산합니다.
    if (!baseTimeStr) {
        baseTimeStr = startTimeInput.value;
    }

    // 만약 시작 시간도 없다면 현재 시각을 기준으로 합니다.
    if (!baseTimeStr) {
        const now = new Date();
        baseTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} `;
    }

    let [hours, minutes] = baseTimeStr.split(':').map(Number);

    if (minutesToAdd === 'SET_ZERO') {
        // '정각' 요청: 분이 0이면 그대로, 0보다 크면 다음 시 00분으로 올림
        if (minutes > 0) {
            hours = (hours + 1) % 24;
        }
        minutes = 0;
    } else {
        // 일반 가산 요청
        const date = new Date();
        date.setHours(hours);
        date.setMinutes(minutes + minutesToAdd);
        hours = date.getHours();
        minutes = date.getMinutes();
    }

    const newHH = String(hours).padStart(2, '0');
    const newMM = String(minutes).padStart(2, '0');
    input.value = `${newHH}:${newMM}`;
};

window.saveAttendance = async function (student) {
    const typeToggle = document.getElementById('attendance-type-toggle');
    const selectedType = typeToggle ? typeToggle.getAttribute('data-current') : '외출';

    const start = document.getElementById('out-start-time').value;
    const end = document.getElementById('out-end-time').value;
    const ampm = document.getElementById('ampm-toggle')?.getAttribute("data-current") || "";

    // [추가] 00:00 가 12:00로 보이도록 보정 (사용자 가독성용)
    const formatTime = (t) => {
        let [h, m] = t.split(':').map(Number);
        if (h === 0) h = 12; // 00시는 12시로 표시
        else if (h > 12) h -= 12; // 13시 이상은 12를 뺌
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    let detailMsg = "";
    if (selectedType === '조퇴') {
        if (!start) {
            window.showToast("조퇴 시간을 입력해주세요.", "error");
            return;
        }
        const displayStart = formatTime(start);
        detailMsg = `${ampm} 조퇴(${displayStart}~)`;
    } else { // 외출
        if (!start || !end) {
            window.showToast("외출 시간을 모두 입력해주세요.", "error");
            return;
        }

        // 시간 유효성 검사 (외출 시에만)
        const startVal = start.replace(':', '');
        const endVal = end.replace(':', '');
        if (parseInt(endVal) <= parseInt(startVal)) {
            window.showToast("종료 시간은 시작 시간보다 늦어야 합니다.", "error");
            return;
        }

        const displayStart = formatTime(start);
        const displayEnd = formatTime(end);

        detailMsg = `${ampm} 외출(${displayStart} ~${displayEnd})`;
    }

    // [수정] 기본 confirm 대신 커스텀 모달 사용
    showAttendanceConfirmModal(student, detailMsg, async () => {
        const fullEmail = getCurrentTeacherEmail();
        const teacherPrefix = fullEmail ? fullEmail.split('@')[0] : "교사";

        const formData = new FormData();
        formData.append("num", student["학번"]);
        formData.append("bad", "근태");
        formData.append("detail", detailMsg);
        formData.append("teacher", teacherPrefix);
        formData.append("time", new Date().toISOString());

        try {
            await saveRecord(formData);
            window.showToast("정상적으로 기록되었습니다.", "success");
            const modal = document.getElementById("action-modal");
            if (modal) modal.remove();
            loadStudents();
        } catch (e) {
            window.showToast("기록 저장에 실패했습니다.", "error");
            console.error(e);
        }
    });
};

// [신규] 근태 기록 전용 세련된 커스텀 확인 모달
function showAttendanceConfirmModal(student, detailMsg, onConfirm) {
    const overlay = document.createElement("div");
    overlay.className = "attendance-confirm-overlay";

    const isEarly = detailMsg.includes("조퇴");
    const typeLabel = isEarly ? "조퇴" : "외출";
    const icon = isEarly ? "🏠" : "🏃";

    // 사진 처리 (utils.js의 함수가 전역에 있다고 가정하거나 직접 구현)
    const extractDriveId = (url) => {
        if (!url) return null;
        const match = url.match(/(?:\/d\/|id=)([\w-]{25,})/);
        return match ? match[1] : null;
    };
    const getThumbnailUrl = (fileId) => {
        return fileId ? `https://lh3.googleusercontent.com/d/${fileId}=s220` : "https://via.placeholder.com/120x150?text=No+Photo";
    };

    const photoUrl = student["사진저장링크"] || "";
    let bgUrl;
    if (photoUrl.startsWith('http') && !photoUrl.includes('drive.google.com')) {
        bgUrl = photoUrl;
    } else {
        bgUrl = getThumbnailUrl(extractDriveId(photoUrl));
    }

    overlay.innerHTML = `
        <div class="attendance-confirm-card" style="padding: 24px; text-align: center;">
            <div class="attendance-confirm-icon" style="font-size: 2.5rem; margin-bottom: 12px;">${icon}</div>
            <div class="attendance-confirm-title" style="font-weight: 800; font-size: 1.2rem; color: #1e293b; margin-bottom: 18px;">${typeLabel} 기록 확인</div>
            
            <div class="attendance-confirm-student-container" style="display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 20px;">
                <img src="${bgUrl}" style="width: 100px; height: 130px; border-radius: 12px; object-fit: cover; border: 2px solid #e2e8f0; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="color: #2563eb; font-weight: 900; font-size: 1.1rem;">${student["학번"]}</span>
                    <span style="font-weight: 700; font-size: 1.2rem; color: #1e293b;">${student["이름"]}</span>
                </div>
            </div>

            <div class="attendance-confirm-msg" style="background: #f8fafc; padding: 16px; border-radius: 12px; margin-bottom: 24px; color: #475569; font-size: 0.95rem; line-height: 1.5; border: 1px dashed #cbd5e1;">
                해당 학생의 <strong>'${detailMsg}'</strong> 기록을<br>데이터베이스에 저장할까요?
            </div>
            
            <div class="attendance-btn-group" style="display: flex; gap: 10px;">
                <button class="attendance-btn cancel" style="flex:1; padding: 14px; border-radius: 12px; border: 1px solid #e2e8f0; background: white; font-weight: 600; color: #64748b; cursor: pointer;">취소</button>
                <button class="attendance-btn confirm" style="flex:2; padding: 14px; border-radius: 12px; border: none; background: #3b82f6; color: white; font-weight: 800; cursor: pointer;">기록하기</button>
            </div>
        </div>
    `;

    overlay.querySelector(".cancel").onclick = () => overlay.remove();
    overlay.querySelector(".confirm").onclick = () => {
        overlay.remove();
        onConfirm();
    };

    document.body.appendChild(overlay);

    // 배경 클릭 시 닫기
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
}

window.openStatusModal = function (student) {
    const grid = document.getElementById("action-grid-main");
    if (!grid) return;

    // 타이틀 변경
    const titleEl = document.getElementById("action-modal-title");
    if (titleEl) {
        const displayNum = student["번호"] || (student["학번"] ? String(student["학번"]).slice(-2) : "??");
        titleEl.textContent = `[${displayNum}번] ${student["이름"]} 학적 상태 변경`;
    }

    // 현재 학적 상태 파싱 (숙려제 여부 확인)
    const currentStatus = student["학적"] || "재학";
    const isCoolingOff = currentStatus.startsWith("숙려제");

    let defaultStart = "";
    let defaultEnd = "";
    if (isCoolingOff) {
        const parts = currentStatus.split('|');
        defaultStart = parts[1] || "";
        defaultEnd = parts[2] || "";
    } else {
        const now = new Date();
        defaultStart = now.toISOString().split('T')[0];
        const end = new Date();
        end.setDate(now.getDate() + 13); // 기본 2주
        defaultEnd = end.toISOString().split('T')[0];
    }

    grid.innerHTML = `
        <div class="attendance-input-card" style="background: #f8fafc; padding: 25px 15px; border-radius: 20px; border: 1px solid #e2e8f0; margin-bottom: 20px; width: 100%;">
            <div class="attendance-input-group" style="margin-bottom: 20px;">
                <label style="display: block; font-size: 0.9rem; font-weight: 700; color: #64748b; margin-bottom: 15px; text-align: center;">변경할 학적/상태 선택</label>
                
                <div id="status-button-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    ${['재학', '전출', '전입', '자퇴', '위탁', '퇴학', '숙려제'].map(status => {
        const isActive = (status === '숙려제' && isCoolingOff) || (status === currentStatus);
        return `
                            <button class="status-opt-btn ${isActive ? 'active' : ''}" 
                                    onclick="selectStatusOption(this, '${status}')"
                                    style="padding: 12px; border-radius: 12px; border: 1.5px solid ${isActive ? '#6366f1' : '#e2e8f0'}; 
                                           background: ${isActive ? '#f5f3ff' : 'white'}; 
                                           color: ${isActive ? '#6366f1' : '#475569'}; 
                                           font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                                ${status}
                            </button>
                        `;
    }).join('')}
                </div>
                <input type="hidden" id="status-select-value" value="${isCoolingOff ? '숙려제' : currentStatus}">
            </div>

            <!-- 숙려제 전용 날짜 설정 섹션 -->
            <div id="cooling-off-section" style="display: ${isCoolingOff ? 'block' : 'none'}; border-top: 1px dashed #e2e8f0; pt: 20px; margin-top: 15px;">
                <div style="display: flex; gap: 15px; margin-top: 15px;">
                    <div style="flex: 1;">
                        <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #64748b; margin-bottom: 8px;">숙려제 시작일</label>
                        <div style="display: flex; gap: 4px; margin-bottom: 6px;">
                            <button class="time-quick-btn" onclick="adjustDate('cooling-start', 1)" style="flex:1; height: 36px; font-size: 0.8rem; border-radius: 8px;">+1일</button>
                            <button class="time-quick-btn" onclick="adjustDate('cooling-start', -1)" style="flex:1; height: 36px; font-size: 0.8rem; border-radius: 8px;">-1일</button>
                        </div>
                        <input type="date" id="cooling-start" value="${defaultStart}" style="width: 100%; padding: 10px; border-radius: 12px; border: 1.5px solid #e2e8f0; font-family: inherit; font-weight: 700; text-align: center;">
                    </div>
                    <div style="flex: 1;">
                        <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #64748b; margin-bottom: 8px;">숙려제 종료일</label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
                            <button class="time-quick-btn" onclick="adjustDate('cooling-end', 1)" style="height: 36px; font-size: 0.8rem; border-radius: 8px;">+1일</button>
                            <button class="time-quick-btn" onclick="adjustDate('cooling-end', -1)" style="height: 36px; font-size: 0.8rem; border-radius: 8px;">-1일</button>
                            <button class="time-quick-btn" onclick="adjustDate('cooling-end', 7)" style="height: 36px; font-size: 0.8rem; border-radius: 8px;">+1주</button>
                            <button class="time-quick-btn" onclick="adjustDate('cooling-end', -7)" style="height: 36px; font-size: 0.8rem; border-radius: 8px;">-1주</button>
                        </div>
                        <input type="date" id="cooling-end" value="${defaultEnd}" style="width: 100%; padding: 10px; border-radius: 12px; border: 1.5px solid #e2e8f0; font-family: inherit; font-weight: 700; text-align: center;">
                    </div>
                </div>
            </div>
        </div>

        <button id="status-submit-btn" class="action-submit-btn" onclick="saveStatus(${JSON.stringify(student).replace(/"/g, '&quot;')})" style="background: #6366f1; margin-top: 10px; font-weight: 800; font-size: 1.4rem; border: none; box-shadow: 0 10px 20px rgba(99, 102, 241, 0.3);">
            💾 학적상태 변경 저장
        </button>
    `;

    // 상태 선택 버튼 이벤트 헬퍼
    window.selectStatusOption = (btn, value) => {
        // 모든 버튼 비활성화
        document.querySelectorAll('.status-opt-btn').forEach(b => {
            b.classList.remove('active');
            b.style.borderColor = '#e2e8f0';
            b.style.background = 'white';
            b.style.color = '#475569';
        });
        // 선택한 버튼 활성화
        btn.classList.add('active');
        btn.style.borderColor = '#6366f1';
        btn.style.background = '#f5f3ff';
        btn.style.color = '#6366f1';

        // 숨겨진 input에 값 저장
        document.getElementById('status-select-value').value = value;

        // 숙려제 섹션 토글
        const section = document.getElementById('cooling-off-section');
        section.style.display = value === '숙려제' ? 'block' : 'none';

        if (window.navigator && window.navigator.vibrate) {
            window.navigator.vibrate(8);
        }
    };
};

// [신규] 날짜 가산 함수
window.adjustDate = function (inputId, daysToAdd) {
    const input = document.getElementById(inputId);
    if (!input.value) return;

    const date = new Date(input.value);
    date.setDate(date.getDate() + daysToAdd);

    // YYYY-MM-DD 형식으로 변환
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    input.value = `${yyyy}-${mm}-${dd}`;
};

window.saveStatus = async function (student) {
    const statusType = document.getElementById('status-select-value').value;

    let finalStatus = statusType;
    if (statusType === '숙려제') {
        const start = document.getElementById('cooling-start').value;
        const end = document.getElementById('cooling-end').value;
        if (!start || !end) {
            window.showToast("숙려제 시작일과 종료일을 입력해주세요.", "error");
            return;
        }
        finalStatus = `숙려제|${start}|${end}`;
    }

    // [수정] 기본 confirm 대신 세련된 커스텀 모달 사용
    showStatusConfirmModal(student, statusType, async () => {
        try {
            const { error } = await supabase
                .from('students')
                .update({ status: finalStatus })
                .eq('student_id', student["학번"]);

            if (error) throw error;

            window.showToast("상태가 정상적으로 변경되었습니다.", "success");
            const modal = document.getElementById("action-modal");
            if (modal) modal.remove();
            loadStudents();
        } catch (e) {
            window.showToast("상태 변경에 실패했습니다.", "error");
            console.error(e);
        }
    });
};

// [신규] 학적 상태 변경 전용 세련된 커스텀 확인 모달
function showStatusConfirmModal(student, newStatus, onConfirm) {
    const overlay = document.createElement("div");
    overlay.className = "attendance-confirm-overlay";

    // 사진 처리
    const extractDriveId = (url) => {
        if (!url) return null;
        const match = url.match(/(?:\/d\/|id=)([\w-]{25,})/);
        return match ? match[1] : null;
    };
    const getThumbnailUrl = (fileId) => {
        return fileId ? `https://lh3.googleusercontent.com/d/${fileId}=s220` : "https://via.placeholder.com/120x150?text=No+Photo";
    };

    const photoUrl = student["사진저장링크"] || student.photo_url || "";
    let bgUrl;
    if (photoUrl.startsWith('http') && !photoUrl.includes('drive.google.com')) {
        bgUrl = photoUrl;
    } else {
        bgUrl = getThumbnailUrl(extractDriveId(photoUrl));
    }

    overlay.innerHTML = `
        <div class="attendance-confirm-card" style="padding: 24px; text-align: center; background: white; border-radius: 28px; width: 90%; max-width: 340px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
            <div class="attendance-confirm-icon" style="font-size: 2.5rem; margin-bottom: 12px; filter: drop-shadow(0 4px 10px rgba(99, 102, 241, 0.3));">🪪</div>
            <div class="attendance-confirm-title" style="font-weight: 800; font-size: 1.2rem; color: #1e293b; margin-bottom: 20px;">학적 상태 변경 확인</div>
            
            <div class="attendance-confirm-student-container" style="display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 24px;">
                <img src="${bgUrl}" style="width: 110px; height: 145px; border-radius: 16px; object-fit: cover; border: 2.5px solid #f1f5f9; box-shadow: 0 8px 20px rgba(0,0,0,0.12); transition: transform 0.3s;">
                <div style="display: flex; flex-direction: column; gap: 3px;">
                    <span style="color: #6366f1; font-weight: 900; font-size: 1.15rem; letter-spacing: 1px;">${student["학번"]}</span>
                    <span style="font-weight: 800; font-size: 1.3rem; color: #1e293b;">${student["이름"]}</span>
                </div>
            </div>

            <div class="attendance-confirm-msg" style="background: #f5f3ff; padding: 18px; border-radius: 16px; margin-bottom: 28px; color: #4338ca; font-size: 0.98rem; line-height: 1.6; border: 1px solid #ddd6fe; font-weight: 500;">
                현재 상태를 <strong>'${newStatus}'</strong>(으)로<br>변경하시겠습니까?
            </div>
            
            <div class="attendance-btn-group" style="display: flex; gap: 12px;">
                <button class="attendance-btn cancel" style="flex:1; padding: 16px; border-radius: 14px; border: 1.5px solid #e2e8f0; background: white; font-weight: 700; color: #64748b; cursor: pointer; transition: all 0.2s;">취소</button>
                <button class="attendance-btn confirm" style="flex:2; padding: 16px; border-radius: 14px; border: none; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; font-weight: 800; cursor: pointer; transition: all 0.2s; box-shadow: 0 8px 16px rgba(99, 102, 241, 0.25);">변경하기</button>
            </div>
        </div>
    `;

    overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); display: flex; justify-content: center; align-items: center; z-index: 3000; animation: fadeIn 0.2s ease;";

    const cancelBtn = overlay.querySelector(".cancel");
    const confirmBtn = overlay.querySelector(".confirm");

    cancelBtn.onclick = () => {
        overlay.classList.add("fade-out");
        overlay.addEventListener("animationend", () => overlay.remove());
    };

    confirmBtn.onclick = () => {
        overlay.remove();
        onConfirm();
    };

    document.body.appendChild(overlay);

    overlay.onclick = (e) => {
        if (e.target === overlay) cancelBtn.click();
    };
}

function goToRelativeClass(direction) {
    let g = grade || 1;
    let c = classNum || 1;

    c += direction;
    if (c < 1) {
        c = 6;
        g--;
    } else if (c > 6) {
        c = 1;
        g++;
    }

    if (g < 1) g = 3;
    if (g > 3) g = 1;

    let targetUrl = `stu-list.html?grade=${g}&class=${c}`;
    if (year) targetUrl += `&year=${year}`;
    window.location.href = targetUrl;
}

function goHome() {
    if (year === '2025') {
        window.location.href = "index-2025.html";
    } else {
        window.location.href = "index.html";
    }
}

// 서비스 워커 등록
function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker
            .register("/service-worker.js")
            .then(() => console.log("[SW] Service worker registered successfully."))
            .catch(err => console.error("[SW] Registration failed:", err));
    }
}
// [신규] 세련된 디자인의 토스트 알림 함수
window.showToast = function (message, type = 'error') {
    // 컨테이너 없으면 생성
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;

    // 타입별 아이콘 설정
    let icon = '🔔';
    if (type === 'error') icon = '⚠️';
    if (type === 'success') icon = '✅';
    if (type === 'info') icon = 'ℹ️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    // 3초 후 제거 애니메이션 및 삭제
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
            if (container.childNodes.length === 0) {
                container.remove();
            }
        });
    }, 3000);
};

// [신규] 학급 연락처 다운로드 및 인쇄 기능
window.downloadClassContacts = async function () {
    const downloadBtn = document.getElementById("contact-download-btn");
    if (downloadBtn) downloadBtn.classList.add("loading");

    try {
        // 1. 학급 전체의 기초조사 데이터 가져오기
        const surveys = await fetchClassSurveysForContacts(grade, classNum);
        const surveyMap = {};
        surveys.forEach(s => {
            surveyMap[s.student_pid] = { ...s, ...(s.data || {}) };
        });

        if (downloadBtn) downloadBtn.classList.remove("loading");

        // 2. 선택 모달 표시
        const modal = document.createElement("div");
        modal.className = "guidance-tooltip-overlay";
        modal.id = "contact-select-modal";
        modal.innerHTML = `
            <div class="guidance-tooltip-content" style="max-width: 420px; border-radius: 28px; padding: 35px 25px;">
                <div style="font-size: 3rem; margin-bottom: 15px;">☎️</div>
                <h3 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 10px;">연락처 저장 및 인쇄</h3>
                <p style="color: #64748b; line-height: 1.5; margin-bottom: 25px;">
                    우리 반 학생과 부모님의 연락처를<br>
                    <strong>휴대폰에 한꺼번에 저장</strong>하거나<br>
                    <strong>인쇄용 명렬표</strong>를 만들 수 있습니다.
                </p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button class="action-submit-btn" id="vcf-download-btn" style="background: #22c55e; height: 58px; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);">
                        📱 휴대폰 연락처 파일 (.vcf) 다운
                    </button>
                    <button class="action-submit-btn" id="print-list-btn" style="background: #0ea5e9; height: 58px; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);">
                        🖨️ 인쇄용 비상연락망 보기
                    </button>
                    <button class="action-submit-btn" id="excel-download-btn" style="background: #16a34a; height: 58px; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.3);">
                        📊 엑셀 명부 다운로드 (.csv)
                    </button>
                    <button class="never-see-again-btn" style="margin-top: 10px; color: #94a3b8;" onclick="this.closest('.guidance-tooltip-overlay').remove()">나중에 하기</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 관계 이름 정규화 헬퍼 (예: 어머니 -> 모)
        const normalizeRel = (rel, defaultVal = "부") => {
            if (!rel || rel === "-" || rel === "." || rel === "보호자" || rel === "없음") return defaultVal;
            if (rel.includes("어머니") || rel.includes("엄마")) return "모";
            if (rel.includes("아버지") || rel.includes("아빠")) return "부";
            if (rel.includes("할머니")) return "조모";
            if (rel.includes("할아버지")) return "조부";
            if (rel.startsWith("기")) return "기타";
            return rel.length >= 2 ? rel.substring(0, 1) : rel;
        };

        const getRelationCommon = (surveyObj, isSecondary = false) => {
            const keys = isSecondary ?
                ["보조보호자 관계", "보조보호자관계", "보조 보호자 관계", "제2보호자 관계", "부보호자 관계", "보조관계"] :
                ["주보호자관계", "주보호자 관계", "보호자 관계", "보호자관계", "부모 관계", "PARENT_RELATION", "관계"];

            const raw = getValue(surveyObj, {}, ...keys);
            return normalizeRel(raw, isSecondary ? "모" : "부");
        };

        // 3. vCard(.vcf) 파일 생성 및 다운로드
        document.getElementById("vcf-download-btn").onclick = () => {
            const students = window.allStudents_Cache;
            if (!students || students.length === 0) {
                window.showToast("학생 데이터가 없습니다.", "error");
                return;
            }

            let vcfContent = "";
            let count = 0;

            students.forEach(s => {
                const survey = surveyMap[s.pid] || {};
                const shortYear = String(s["학년"] || grade || "2026").slice(-2);
                const studentID = String(s["학번"] || s.student_id || "");
                const displayNum = studentID.slice(-2);
                const prefix = `${shortYear}${studentID}${s.name}`;

                // 학생 본인
                const studentPhone = s["연락처"] || survey["연락처"] || survey["학생폰"] || "";
                if (studentPhone && studentPhone.length > 5) {
                    vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${prefix}\nTEL;TYPE=CELL:${studentPhone}\nNOTE:${grade}학년 ${classNum}반 ${displayNum}번 학생\nEND:VCARD\n`;
                    count++;
                }
                // 주보호자
                const p1Phone = s["보호자연락처"] || getValue(survey, {}, "주보호자 연락처", "보호자 연락처", "보호자연락처", "PARENT_CONTACT") || "";
                let p1Rel = getRelationCommon(survey);
                if (p1Rel === "부" && s["보호자관계"]) p1Rel = normalizeRel(s["보호자관계"], "부");

                if (p1Phone && p1Phone.length > 5) {
                    vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${prefix}(${p1Rel})\nTEL;TYPE=CELL:${p1Phone}\nNOTE:${grade}학년 ${classNum}반 ${displayNum}번 ${s.name}의 ${p1Rel}\nEND:VCARD\n`;
                    count++;
                }

                // 보조보호자
                const p2Phone = getValue(survey, {}, "보조보호자 연락처", "보조보호자연락처", "보조 보호자 연락처") || "";
                let p2Rel = getRelationCommon(survey, true);

                if (p2Phone && p2Phone.length > 5) {
                    vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${prefix}(${p2Rel})\nTEL;TYPE=CELL:${p2Phone}\nNOTE:${grade}학년 ${classNum}반 ${displayNum}번 ${s.name}의 ${p2Rel} (보조)\nEND:VCARD\n`;
                    count++;
                }
            });

            if (count === 0) {
                window.showToast("저장할 연락처 정보가 없습니다.", "error");
                return;
            }

            const blob = new Blob([vcfContent], { type: "text/vcard;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${grade}학년_${classNum}반_비상연락망.vcf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            modal.remove();
            window.showToast(`${count}개의 연락처가 다운로드되었습니다.`, "success");
        };

        // 4. 인쇄용 명렬표 레이아웃 생성
        document.getElementById("print-list-btn").onclick = () => {
            const students = window.allStudents_Cache;
            let tableRows = "";
            students.forEach(s => {
                const survey = surveyMap[s.pid] || {};
                const dId = String(s["학번"] || s.student_id || "");
                const shortYear = String(s["학년"] || grade || "2026").slice(-2);
                const fullName = `${shortYear}${dId}${s.name}`;

                const dNum = s["번호"] || (s["학번"] ? String(s["학번"]).slice(-2) : "??");
                const sPhone = s["연락처"] || survey["연락처"] || survey["학생폰"] || "-";

                const p1Phone = s["보호자연락처"] || getValue(survey, {}, "주보호자 연락처", "보호자 연락처", "보호자연락처") || "-";
                let p1Rel = getRelationCommon(survey);
                if (p1Rel === "부" && s["보호자관계"]) p1Rel = normalizeRel(s["보호자관계"], "부");

                const p2Phone = getValue(survey, {}, "보조보호자 연락처", "보조보호자연락처", "보조 보호자 연락처") || "-";
                const p2Rel = (p2Phone === "-") ? "-" : getRelationCommon(survey, true);

                tableRows += `
                    <tr>
                        <td style="font-weight:bold;">${dNum}</td>
                        <td style="font-size:0.95rem; font-weight:800;">${fullName}</td>
                        <td style="letter-spacing:0.3px; font-size:0.85rem;">${sPhone}</td>
                        <td>
                            <span style="font-size:0.75rem; color:#666; margin-right:5px;">${p1Rel}</span>
                            <span style="font-weight:bold; font-size:0.95rem;">${p1Phone}</span>
                        </td>
                        <td>
                            <span style="font-size:0.75rem; color:#666; margin-right:5px;">${p2Phone === "-" ? "" : p2Rel}</span>
                            <span style="font-size:0.9rem;">${p2Phone}</span>
                        </td>
                    </tr>
                `;
            });

            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                <head>
                    <title>${grade}학년 ${classNum}반 비상연락망</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@400;700;900&display=swap');
                        body { font-family: 'Pretendard', sans-serif; padding: 20px; color: #333; }
                        .header { text-align: center; margin-bottom: 15px; border-bottom: 3px double #333; padding-bottom: 10px; }
                        h1 { font-size: 1.8rem; margin: 0; font-weight: 900; }
                        .timestamp { text-align: right; color: #666; font-size: 0.8rem; margin-top: 5px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 5px; table-layout: fixed; }
                        th, td { border: 1px solid #000; padding: 8px 2px; text-align: center; overflow: hidden; white-space: nowrap; }
                        th { background: #f8fafc; font-weight: 900; font-size: 0.85rem; }
                        .no-print { margin-top: 30px; text-align: center; }
                        @media print { .no-print { display: none; } }
                        button { padding: 10px 20px; font-size: 1rem; border-radius: 8px; cursor: pointer; border: none; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>${grade}학년 ${classNum}반 비상연락망</h1>
                        <div class="timestamp">출력일시: ${new Date().toLocaleString()}</div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th width="6%">번호</th>
                                <th width="15%">이름</th>
                                <th width="21%">학생 연락처</th>
                                <th width="29%">주보호자 (관계 번호)</th>
                                <th width="29%">보조보호자 (관계 번호)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                    <div class="no-print">
                        <button onclick="window.print()" style="background: #3b82f6; color: white;">🖨️ 지금 인쇄하기</button>
                        <button onclick="window.close()" style="background: #f1f5f9; color: #475569; margin-left: 10px;">닫기</button>
                    </div>
                </body>
                </html>
            `);
            printWindow.document.close();
            modal.remove();
        };

        // 5. 엑셀(CSV) 파일 생성 및 다운로드
        document.getElementById("excel-download-btn").onclick = () => {
            const students = window.allStudents_Cache;
            if (!students || students.length === 0) {
                window.showToast("학생 데이터가 없습니다.", "error");
                return;
            }

            let csvContent = "\uFEFF"; // UTF-8 BOM
            csvContent += "번호,학번,이름,학생 연락처,주보호자 관계,주보호자 번호,보조보호자 관계,보조보호자 번호,주소,알러지\n";

            students.forEach(s => {
                const survey = surveyMap[s.pid] || {};
                const dId = String(s["학번"] || s.student_id || "");
                const dNum = s["번호"] || (dId ? dId.slice(-2) : "??");
                const sPhone = s["연락처"] || survey["연락처"] || survey["학생폰"] || "-";

                let p1Rel = getRelationCommon(survey);
                if (p1Rel === "부" && s["보호자관계"]) p1Rel = normalizeRel(s["보호자관계"], "부");
                const p1Phone = s["보호자연락처"] || getValue(survey, {}, "주보호자 연락처", "보호자 연락처", "보호자연락처") || "-";

                const p2Phone = getValue(survey, {}, "보조보호자 연락처", "보조보호자연락처", "보조 보호자 연락처") || "-";
                const p2Rel = (p2Phone === "-") ? "-" : getRelationCommon(survey, true);

                const fullAddr = (s["주소"] || survey["집주소"] || survey["주소"] || "-").replace(/,/g, " ");
                const allergy = (survey["알레르기"] || survey["알러지"] || "-").replace(/,/g, " ");
                csvContent += `${dNum},${dId},${s.name},${sPhone},${p1Rel},${p1Phone},${p2Rel},${p2Phone},"${fullAddr}","${allergy}"\n`;
            });

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${grade}학년_${classNum}반_비상연락망.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            modal.remove();
            window.showToast("엑셀 명부가 다운로드되었습니다.", "success");
        };

    } catch (err) {
        console.error("Download Menu Error:", err);
        window.showToast("연락처 정보를 불러오지 못했습니다.", "error");
        if (downloadBtn) downloadBtn.classList.remove("loading");
    }
};
/**
 * 실시간 알림 연동: 모든 선생님의 생활기록 입력을 감지하여 알림을 띄웁니다.
 */
// initRealtimeNotifications was moved to src/js/notification-service.js

/**
 * 실시간 UI 갱신 (애니메이션 및 카운트 가상 업데이트)
 */
function updateStudentUIRealtime(pid) {
    const card = document.querySelector(`.student[data-pid="${pid}"]`);
    if (!card) return;

    // 1. 카드 펄스 애니메이션
    card.classList.add('updated-pulse');
    setTimeout(() => card.classList.remove('updated-pulse'), 2000);

    // 2. 상단 총 건수 1 증가 (가상)
    const titleElement = document.getElementById("class-title");
    if (titleElement) {
        const match = titleElement.innerHTML.match(/\((\d+)건\)/);
        if (match) {
            const newCount = parseInt(match[1]) + 1;
            titleElement.innerHTML = titleElement.innerHTML.replace(/\((\d+)건\)/, `(${newCount}건)`);
        }
    }

    // 3. 학생 카드 뱃지 업데이트를 위해 해당 학생만 다시 로드하거나, 
    // 사용자 경험을 위해 전체를 가볍게 리로드 (이미지 캐시 덕분에 빠름)
    // 여기서는 안전하게 loadStudents()를 다시 호출합니다.
    loadStudents();
}

/**
 * 학생 연락처/주소/인스타 편집 모달 (담임·관리자 전용)
 * 기존 팝업 위에 오버레이로 표시 - 팝업은 닫지 않음
 */
window.openContactEditModal = function(student) {
    // 혹시 이미 열려있으면 제거
    const existing = document.getElementById('contact-edit-modal');
    if (existing) existing.remove();

    const currentContact = student['연락처'] || student.contact || '';
    const currentAddress = student['집주소'] || student['주소'] || student.address || '';
    const currentInsta   = student['인스타id'] || student['인스타'] || student.instagram_id || student.instagram || '';
    const studentName    = student['이름'] || '';
    const studentId      = student['학번'] || '';

    const modal = document.createElement('div');
    modal.id = 'contact-edit-modal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(15,23,42,0.55); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; animation: fadeIn 0.2s ease;
    `;

    modal.innerHTML = `
        <div style="
            background: #fff; border-radius: 24px; padding: 28px 24px 24px;
            width: 100%; max-width: 420px; box-shadow: 0 32px 64px rgba(0,0,0,0.2);
            animation: slideUp 0.3s cubic-bezier(0.16,1,0.3,1);
        ">
            <!-- 헤더 -->
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:22px;">
                <div>
                    <div style="font-size:1.2rem; font-weight:800; color:#1e293b;">✏️ 학생 정보 수정</div>
                    <div style="font-size:0.85rem; color:#64748b; margin-top:2px;">${studentId} ${studentName}</div>
                </div>
                <button id="contact-edit-close" style="
                    background:#f1f5f9; border:none; border-radius:50%;
                    width:36px; height:36px; font-size:1.1rem; cursor:pointer;
                    display:flex; align-items:center; justify-content:center; color:#64748b;
                ">✕</button>
            </div>

            <!-- 입력 필드들 -->
            <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:22px;">
                <div>
                    <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:6px;">📞 전화번호</label>
                    <input id="edit-contact" type="tel" value="${currentContact}"
                        placeholder="예: 010-0000-0000"
                        style="width:100%; padding:13px 14px; border:1.5px solid #e2e8f0; border-radius:14px;
                               font-size:1rem; outline:none; font-family:inherit; transition:border-color 0.2s;
                               box-sizing:border-box;"
                        onfocus="this.style.borderColor='#3b82f6'"
                        onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div>
                    <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:6px;">🏠 집 주소</label>
                    <input id="edit-address" type="text" value="${currentAddress}"
                        placeholder="예: 서울시 강남구..."
                        style="width:100%; padding:13px 14px; border:1.5px solid #e2e8f0; border-radius:14px;
                               font-size:1rem; outline:none; font-family:inherit; transition:border-color 0.2s;
                               box-sizing:border-box;"
                        onfocus="this.style.borderColor='#3b82f6'"
                        onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div>
                    <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:6px;">📸 인스타 ID (DM)</label>
                    <input id="edit-instagram" type="text" value="${currentInsta}"
                        placeholder="예: @username"
                        style="width:100%; padding:13px 14px; border:1.5px solid #e2e8f0; border-radius:14px;
                               font-size:1rem; outline:none; font-family:inherit; transition:border-color 0.2s;
                               box-sizing:border-box;"
                        onfocus="this.style.borderColor='#3b82f6'"
                        onblur="this.style.borderColor='#e2e8f0'">
                </div>
            </div>

            <!-- 안내 메시지 -->
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:12px; padding:10px 14px; margin-bottom:18px; font-size:0.8rem; color:#92400e; line-height:1.5;">
                ⚠️ 빈칸으로 저장하면 해당 정보가 삭제됩니다.<br>담임 또는 관리자만 수정 가능합니다.
            </div>

            <!-- 버튼 -->
            <div style="display:flex; gap:10px;">
                <button id="contact-edit-cancel" style="
                    flex:1; padding:14px; border-radius:14px; border:1.5px solid #e2e8f0;
                    background:#f8fafc; color:#64748b; font-weight:700; font-size:0.95rem;
                    cursor:pointer; transition:all 0.2s;
                ">취소</button>
                <button id="contact-edit-save" style="
                    flex:2; padding:14px; border-radius:14px; border:none;
                    background:linear-gradient(135deg,#3b82f6,#2563eb); color:white;
                    font-weight:800; font-size:0.95rem; cursor:pointer;
                    box-shadow:0 8px 20px rgba(59,130,246,0.35); transition:all 0.2s;
                ">💾 저장하기</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    document.getElementById('contact-edit-close').onclick  = closeModal;
    document.getElementById('contact-edit-cancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    document.getElementById('contact-edit-save').onclick = async () => {
        const saveBtn = document.getElementById('contact-edit-save');
        const newContact  = document.getElementById('edit-contact').value.trim();
        const newAddress  = document.getElementById('edit-address').value.trim();
        const newInstagram = document.getElementById('edit-instagram').value.trim();

        saveBtn.textContent = '저장 중...';
        saveBtn.disabled = true;

        try {
            await updateStudentContactInfo(student.pid, {
                contact:   newContact   || null,
                address:   newAddress   || null,
                instagram: newInstagram || null,
            });

            // 팝업 내 표시값 즉시 갱신 (UI 반영)
            student.contact   = newContact;
            student['연락처'] = newContact;
            student.address   = newAddress;
            student['주소']   = newAddress;
            student['집주소'] = newAddress;
            student.instagram_id = newInstagram;
            student.instagram    = newInstagram;
            student['인스타id']  = newInstagram;
            student['인스타']    = newInstagram;

            closeModal();
            // 팝업을 닫고 다시 열어 최신 정보 반영
            showPopup(student);
        } catch (err) {
            saveBtn.textContent = '💾 저장하기';
            saveBtn.disabled = false;
            alert('저장 실패: ' + err.message);
        }
    };
};
window.openParentContactEditModal = function(student) {
    // 혹시 이미 열려있으면 제거
    const existing = document.getElementById('parent-contact-edit-modal');
    if (existing) existing.remove();

    // 학부모 정보 추출 (students 테이블 필드 우선, 없으면 surveyData 등에서 추출된 값 사용)
    const currentParentContact  = student.parent_contact || student['보호자연락처'] || student['주보호자 연락처'] || '';
    const currentParentRelation = student.parent_relation || student['보호자관계'] || student['주보호자 관계'] || '';
    const studentName           = student['이름'] || '';
    const studentId             = student['학번'] || '';

    const modal = document.createElement('div');
    modal.id = 'parent-contact-edit-modal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(15,23,42,0.55); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; animation: fadeIn 0.2s ease;
    `;

    modal.innerHTML = `
        <div style="
            background: #fff; border-radius: 24px; padding: 28px 24px 24px;
            width: 100%; max-width: 420px; box-shadow: 0 32px 64px rgba(0,0,0,0.2);
            animation: slideUp 0.3s cubic-bezier(0.16,1,0.3,1);
        ">
            <!-- 헤더 -->
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:22px;">
                <div>
                    <div style="font-size:1.2rem; font-weight:800; color:#059669;">👨‍👩‍👧‍👦 보호자 정보 수정</div>
                    <div style="font-size:0.85rem; color:#64748b; margin-top:2px;">${studentId} ${studentName}</div>
                </div>
                <button id="parent-edit-close" style="
                    background:#f1f5f9; border:none; border-radius:50%;
                    width:36px; height:36px; font-size:1.1rem; cursor:pointer;
                    display:flex; align-items:center; justify-content:center; color:#64748b;
                ">✕</button>
            </div>

            <!-- 입력 필드들 -->
            <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:22px;">
                <div>
                    <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:6px;">부모 관계 (예: 부, 모, 조부 등)</label>
                    <input id="edit-parent-relation" type="text" value="${currentParentRelation}"
                        placeholder="예: 부"
                        style="width:100%; padding:13px 14px; border:1.5px solid #e2e8f0; border-radius:14px;
                               font-size:1rem; outline:none; font-family:inherit; transition:border-color 0.2s;
                               box-sizing:border-box;"
                        onfocus="this.style.borderColor='#10b981'"
                        onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div>
                    <label style="font-size:0.8rem; font-weight:700; color:#475569; display:block; margin-bottom:6px;">📞 보호자 연락처</label>
                    <input id="edit-parent-contact" type="tel" value="${currentParentContact}"
                        placeholder="예: 010-0000-0000"
                        style="width:100%; padding:13px 14px; border:1.5px solid #e2e8f0; border-radius:14px;
                               font-size:1rem; outline:none; font-family:inherit; transition:border-color 0.2s;
                               box-sizing:border-box;"
                        onfocus="this.style.borderColor='#10b981'"
                        onblur="this.style.borderColor='#e2e8f0'">
                </div>
            </div>

            <!-- 버튼 -->
            <div style="display:flex; gap:10px;">
                <button id="parent-edit-cancel" style="
                    flex:1; padding:14px; border-radius:14px; border:1.5px solid #e2e8f0;
                    background:#f8fafc; color:#64748b; font-weight:700; font-size:0.95rem;
                    cursor:pointer; transition:all 0.2s;
                ">취소</button>
                <button id="parent-edit-save" style="
                    flex:2; padding:14px; border-radius:14px; border:none;
                    background:linear-gradient(135deg,#10b981,#059669); color:white;
                    font-weight:800; font-size:0.95rem; cursor:pointer;
                    box-shadow:0 8px 20px rgba(16,185,129,0.3); transition:all 0.2s;
                ">💾 저장하기</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    document.getElementById('parent-edit-close').onclick  = closeModal;
    document.getElementById('parent-edit-cancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    document.getElementById('parent-edit-save').onclick = async () => {
        const saveBtn = document.getElementById('parent-edit-save');
        const newRelation = document.getElementById('edit-parent-relation').value.trim();
        const newContact  = document.getElementById('edit-parent-contact').value.trim();

        saveBtn.textContent = '저장 중...';
        saveBtn.disabled = true;

        try {
            const { updateStudentContactInfo } = await import('./api.js');
            await updateStudentContactInfo(student.pid, {
                parent_relation: newRelation || null,
                parent_contact:  newContact  || null,
            });

            // 팝업 내 표시값 즉시 갱신 (UI 반영)
            student.parent_relation = newRelation;
            student['보호자관계']   = newRelation;
            student['주보호자 관계'] = newRelation;
            
            student.parent_contact  = newContact;
            student['보호자연락처'] = newContact;
            student['주보호자 연락처'] = newContact;

            closeModal();
            // 팝업을 닫고 다시 열어 최신 정보 반영
            showPopup(student);
        } catch (err) {
            saveBtn.textContent = '💾 저장하기';
            saveBtn.disabled = false;
            alert('저장 실패: ' + err.message);
        }
    };
};

// =========================================================================
// [추가] 인쇄 및 내보내기 설정 모달 및 기능
// =========================================================================
window.openPrintModal = function() {
    openPrintModal(grade, classNum);
};

// =========================================================================
// [추가] 학급 빈 화면 롱프레스 시 전입생 (신규 학생) 추가 기능
// =========================================================================
function setupEmptyAreaLongPress() {
    const listContainer = document.getElementById("student-list") || document.querySelector(".container");
    if (!listContainer || listContainer.dataset.longPressBound) return;
    listContainer.dataset.longPressBound = "true";

    let pressTimer = null;
    let isLongPress = false;
    let startX = 0, startY = 0;

    const onStart = (e) => {
        // 학생 카드, 버튼, 팝업 클릭 시 빈 영역 롱프레스 무시
        if (e.target.closest('.student-card') || e.target.closest('button') || e.target.closest('#popup')) {
            return;
        }

        // 권한 체크: 담임교사 또는 소유자/어드민인지 검사
        const myEmail = getCurrentTeacherEmail();
        const currentClassInfo = window.classInfoData ? window.classInfoData.find(c => c.grade === grade && c.class === classNum) : null;
        const isOwner = acIsAdmin();
        const isAdmin = acIsAdmin();
        const isMyClass = isOwner || isAdmin || (currentClassInfo && (currentClassInfo.homeroomEmail === myEmail || currentClassInfo.subEmail === myEmail));

        if (!isMyClass) return;

        const touch = e.type.indexOf('touch') === 0 ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        isLongPress = false;

        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            isLongPress = true;
            if (navigator.vibrate) navigator.vibrate(50);
            openAddStudentModal();
        }, 700);
    };

    const onMove = (e) => {
        if (!startX || !startY) return;
        const touch = e.type.indexOf('touch') === 0 ? e.touches[0] : e;
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (dx > 10 || dy > 10) {
            clearTimeout(pressTimer);
        }
    };

    const onEnd = () => {
        clearTimeout(pressTimer);
        startX = startY = 0;
    };

    listContainer.addEventListener("touchstart", onStart, { passive: true });
    listContainer.addEventListener("touchmove", onMove, { passive: true });
    listContainer.addEventListener("touchend", onEnd);
    listContainer.addEventListener("touchcancel", onEnd);

    listContainer.addEventListener("mousedown", onStart);
    listContainer.addEventListener("mousemove", onMove);
    listContainer.addEventListener("mouseup", onEnd);
    listContainer.addEventListener("mouseleave", onEnd);
}

function openAddStudentModal() {
    const popup = document.getElementById("popup");
    const overlay = document.getElementById("overlay");
    if (!popup || !overlay) return;

    // 추천 학번 계산 (기존 학번 중 최대값 + 1)
    let maxIdNum = 0;
    if (window.allStudents_Cache && window.allStudents_Cache.length > 0) {
        window.allStudents_Cache.forEach(s => {
            const rawId = s.student_id || s["학번"];
            if (rawId) {
                const parsed = parseInt(rawId);
                if (!isNaN(parsed) && parsed > maxIdNum) {
                    maxIdNum = parsed;
                }
            }
        });
    }
    
    let recommendedId = "";
    if (maxIdNum > 0) {
        recommendedId = String(maxIdNum + 1);
    } else {
        const paddedClass = String(classNum).padStart(2, '0');
        recommendedId = `${grade}${paddedClass}01`;
    }

    popup.className = "print-modal-wrapper";
    popup.innerHTML = `
        <div class="add-student-dialog" style="position: relative; font-family: inherit;">
            <button type="button" class="popup-close-x" id="add-stu-close-btn" style="position: absolute; top: 0px; right: 0px; background: #f1f5f9; border: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: #64748b; cursor: pointer; transition: all 0.2s; z-index: 10;">✕</button>
            <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 1.2rem; font-weight: 800; color: #1e293b; text-align: center;">➕ 전입생 (신규 학생) 등록</h3>
            
            <form id="add-student-form">
                <div style="margin-bottom: 12px; text-align: left;">
                    <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #475569; margin-bottom: 4px;">학번 <span style="color: #ef4444;">*</span></label>
                    <input type="text" id="new-stu-id" required value="${recommendedId}" placeholder="예: 20335" style="width: 100%; padding: 10px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box; outline: none;">
                </div>
                
                <div style="margin-bottom: 12px; text-align: left;">
                    <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #475569; margin-bottom: 4px;">이름 <span style="color: #ef4444;">*</span></label>
                    <input type="text" id="new-stu-name" required placeholder="예: 홍길동" style="width: 100%; padding: 10px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box; outline: none;">
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                    <div style="flex: 1; text-align: left;">
                        <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #475569; margin-bottom: 4px;">성별</label>
                        <select id="new-stu-gender" style="width: 100%; padding: 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box;">
                            <option value="남">남</option>
                            <option value="여">여</option>
                        </select>
                    </div>
                    <div style="flex: 1; text-align: left;">
                        <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #475569; margin-bottom: 4px;">학적 상태</label>
                        <select id="new-stu-status" style="width: 100%; padding: 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box;">
                            <option value="전입" selected>전입</option>
                            <option value="재학">재학</option>
                        </select>
                    </div>
                </div>

                <div style="margin-bottom: 18px; text-align: left;">
                    <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #475569; margin-bottom: 4px;">보호자 연락처 (선택)</label>
                    <input type="tel" id="new-stu-parent-contact" placeholder="010-0000-0000" style="width: 100%; padding: 10px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.95rem; box-sizing: border-box; outline: none;">
                </div>

                <button type="submit" id="save-new-stu-btn" style="width: 100%; padding: 12px; border: none; border-radius: 8px; background: #3b82f6; color: white; font-size: 1rem; font-weight: 700; cursor: pointer; transition: background 0.2s; box-shadow: 0 4px 6px rgba(59,130,246,0.2);">전입생 등록하기</button>
            </form>
        </div>
    `;

    document.body.style.overflow = "hidden";
    popup.style.display = "block";
    overlay.style.display = "block";

    const closeAddModal = () => {
        popup.style.display = "none";
        overlay.style.display = "none";
        popup.className = "";
        document.body.style.overflow = "";
        overlay.onclick = null;
    };

    document.getElementById("add-stu-close-btn").onclick = closeAddModal;
    overlay.onclick = closeAddModal;

    // 폼 제출 이벤트
    const form = document.getElementById("add-student-form");
    form.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById("save-new-stu-btn");
        const stuId = document.getElementById("new-stu-id").value.trim();
        const stuName = document.getElementById("new-stu-name").value.trim();
        const stuGender = document.getElementById("new-stu-gender").value;
        const stuStatus = document.getElementById("new-stu-status").value;
        const parentContact = document.getElementById("new-stu-parent-contact").value.trim();

        if (!stuId || !stuName) {
            alert("학번과 이름을 모두 입력해주세요.");
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "등록 중...";
        submitBtn.style.background = "#94a3b8";

        try {
            const classInfoStr = `${grade}-${classNum}`;
            const { data, error } = await supabase
                .from('students')
                .insert([{
                    academic_year: API_CONFIG.CURRENT_ACADEMIC_YEAR,
                    class_info: classInfoStr,
                    student_id: stuId,
                    name: stuName,
                    gender: stuGender,
                    status: stuStatus,
                    parent_contact: parentContact || null,
                    photo_url: null
                }])
                .select();

            if (error) throw error;

            alert(`전입생 [${stuName}] 학생이 성공적으로 등록되었습니다.`);
            closeAddModal();
            loadStudents(); // 학급 학생 목록 새로고침
        } catch (err) {
            console.error("Student Insert Error:", err);
            alert("학생 등록 실패: " + (err.message || "오류가 발생했습니다."));
            submitBtn.disabled = false;
            submitBtn.textContent = "전입생 등록하기";
            submitBtn.style.background = "#3b82f6";
        }
    };
}
