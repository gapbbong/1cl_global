import { isLightColor } from './utils.js';
import { fetchClassStats, fetchClassInfo, getTeacherProfile, logPageView, fetchCustomMenus, getCurrentTeacherEmail } from './api.js';
import { API_CONFIG } from './config.js';
import { initRealtimeNotifications } from './notification-service.js';
import { loadSchool, applySchoolBranding, levels as schoolLevels, unitKey, me as schoolMe } from './school.js';

// CryptoJS 임포트 (Vite 환경)
import CryptoJS from 'crypto-js';

let classInfo = [];

console.log("index.js loaded successfully");

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOMContentLoaded triggered");

  // [v4.77.0] 스플래시 화면 1일 1회 표시 로직 및 설정 레이아웃 개선
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').then(registration => {
        console.log('✅ ServiceWorker registration successful with scope: ', registration.scope);
      }, err => {
        console.log('❌ ServiceWorker registration failed: ', err);
      });
    });
  }

  const splash = document.getElementById("splash-screen");
  const today = new Date().toDateString();
  const splashShownDate = localStorage.getItem("splash_shown_date");
  const isSplashShownToday = splashShownDate === today;

  // [v4.77] 오늘 이미 보았다면 스플래시 즉시 제거 (인라인 스크립트 보조)
  if (isSplashShownToday && splash) {
    splash.remove();
  }

  // [v4.15] 스플래시 화면 최소 노출 시간 (1.2초) - 오늘 처음 접속 시에만 적용
  const splashPromise = isSplashShownToday
    ? Promise.resolve() 
    : new Promise(resolve => setTimeout(resolve, 1200));

  if (!isSplashShownToday) {
    localStorage.setItem("splash_shown_date", today);
  }

  try {
    // 인증 체크
    console.log("Starting authentication check...");
    const isAuthenticated = await initAuth();
    console.log("Authentication result:", isAuthenticated);
    if (!isAuthenticated) return;

    // [M2] 학교(테넌트) 설정 로드 — 이후 모든 렌더가 window.SCHOOL 참조
    try {
      await loadSchool({ force: true });
      applySchoolBranding();
    } catch (e) {
      console.error('학교 설정 로드 실패:', e);
    }

    // 실시간 알림 시스템 초기화 복구 (v4.77.1)
    initRealtimeNotifications();

    // [Step 2] 활동 로그 기록
    const email = getFullStoredEmail();
    if (email) {
      logPageView(email, "메인 홈 (index.html)");
    }

    const container = document.getElementById("class-list");
    if (!container) {
      console.error("class-list container not found");
      return;
    }
    container.innerHTML = "";
    container.classList.add("loading-records");

    const recordCountVal = document.getElementById("record-count-val");
    if (recordCountVal) {
      recordCountVal.innerText = "";
      recordCountVal.classList.add("loading-dots");
    }

    console.log("Starting data fetch...");
    // 1. 교사 정보(DB) 및 통계 데이터 병렬 조회
    const [infoData, stats] = await Promise.all([
      fetchClassInfo().catch(e => {
        console.error("fetchClassInfo failed:", e);
        return [];
      }),
      fetchClassStats().catch(e => {
        console.error("fetchClassStats failed:", e);
        return { grandTotal: 0, classStats: {} };
      })
    ]);

    console.log("Data fetch finished. infoData:", infoData, "stats:", stats);
    classInfo = infoData;

    // [New] 교사 설정에 따른 초기 화면 리다이렉트 (v5.00)
    const teacherProfile = await getTeacherProfile(email);
    const settings = teacherProfile?.settings || { initial_page: 'home' };
    const page = settings.initial_page || 'home';

    if (page !== 'home' && !window.location.search.includes('force=home')) {
      let g = "1", c = "1";
      if (teacherProfile.assigned_class) {
        [g, c] = teacherProfile.assigned_class.split('-');
      }

      const redirectMap = {
        'my_class': `class-analysis.html?grade=${g}&class=${c}`,
        'my_photos': `stu-list.html?grade=${g}&class=${c}`
      };

      if (redirectMap[page]) {
        console.log(`Redirecting to initial page: ${page} for ${g}-${c}`);
        // 화이트아웃 방지 및 몰입감 있는 로딩 표시
        document.body.innerHTML = `
          <div style="height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:-apple-system, sans-serif; background:#ffffff;">
            <div class="splash-loader" style="position:static; margin-bottom:20px; width:40px; height:40px; border:4px solid #f1f5f9; border-top:4px solid #0071e3; border-radius:50%; animation:spin 1s linear infinite;"></div>
            <p style="font-weight:700; color:#1d1d1f; letter-spacing:-0.03em;">설정된 화면으로 이동 중...</p>
          </div>
          <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        window.location.href = redirectMap[page];
        return;
      }
    }

    // 2. DB 정보를 바탕으로 기본 레이아웃을 그립니다.
    console.log("Rendering initial grid...");
    renderInitialGrid(container);
    console.log("Grid rendering finished.");

    // 3. 상단 총 건수 업데이트
    if (recordCountVal && stats) {
      const grandTotal = stats.grandTotal !== undefined ? stats.grandTotal : 0;
      recordCountVal.classList.remove("loading-dots");
      recordCountVal.innerText = grandTotal;
    }

    // 4. 각 반 박스의 배지 업데이트
    if (stats && stats.classStats) {
      console.log("Updating badges...");
      updateClassBadges(stats.classStats);
    }

    container.classList.remove("loading-records");
    console.log("Startup process finished successfully.");

    // [v4.15] 데이터 로딩 완료 후 스플래시 화면 제거
    await splashPromise;
    const splash = document.getElementById("splash-screen");
    if (splash) {
      splash.classList.add("fade-out");
      setTimeout(() => splash.remove(), 600); // 트랜지션 완료 후 제거
    }

  } catch (error) {
    console.error("CRITICAL ERROR during index load:", error);
    window.alert("화면을 불러오는 중 오류가 발생했습니다: " + error.message);
    const container = document.getElementById("class-list");
    if (container) {
      container.innerHTML = `<div style="padding:20px; color:red;">❌ 오류 발생: ${error.message}<br>콘솔 로그를 확인해주세요.</div>`;
      container.classList.remove("loading-records");
    }
  }

  // 5. 모달 서비스 및 기타 UI 초기화
  initContactModal();
  initGlobalTip();
  initHeaderMenu();
  updateDynamicCalendar();
  window.addEventListener('resize', updateDynamicCalendar);
});

/**
 * 캘린더 아이콘에 오늘 날짜와 요일을 표시하고,
 * 화면 크기에 따라 PC(월별), 모바일(주별) 링크를 다르게 설정합니다.
 */
function updateDynamicCalendar() {
  const dayEl = document.querySelector(".cal-day");
  const dateEl = document.querySelector(".cal-date");
  const calendarLink = document.getElementById("calendar-link");

  if (!dayEl || !dateEl) return;

  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayColors = [
    '#ea4335', // 일: 빨강
    '#f57c00', // 월: 주황
    '#388e3c', // 화: 초록
    '#1976d2', // 수: 파랑
    '#7b1fa2', // 목: 보라
    '#00796b', // 금: 청록
    '#303f9f'  // 토: 남색
  ];

  const dayIndex = now.getDay();
  const dayName = days[dayIndex];
  const dayColor = dayColors[dayIndex];
  const dateNum = now.getDate();

  dayEl.innerText = dayName;
  dayEl.style.backgroundColor = dayColor;
  dateEl.innerText = dateNum;
  dateEl.style.color = dayColor;

  if (calendarLink) {
    calendarLink.href = "calendar.html";
    // 타겟 제거 (현재창 이동)
    calendarLink.removeAttribute("target");

    // [v3.4.1] 캘린더 힌트 소멸 로직
    const isHintHidden = localStorage.getItem('calendar_hint_hidden') === 'true';
    if (isHintHidden) {
      calendarLink.classList.add('hide-hint');
    }

    // 클릭 시 힌트 영구 숨김
    calendarLink.addEventListener('click', () => {
      localStorage.setItem('calendar_hint_hidden', 'true');
      calendarLink.classList.add('hide-hint');
    }, { once: true });
  }
}


// ----------------------------------------------------
// 헤더 메뉴 및 로그아웃 로직
// ----------------------------------------------------
function initHeaderMenu() {
  const hamburgerBtn = document.getElementById("hamburger-btn");
  const hamburgerDropdown = document.getElementById("hamburger-dropdown");

  if (hamburgerBtn && hamburgerDropdown) {
    // 햄버거 아이콘 클릭 (토글)
    hamburgerBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // 바디 클릭 방지
      const isOpen = hamburgerDropdown.style.display === "block";
      hamburgerDropdown.style.display = isOpen ? "none" : "block";
      
      // [v5.00] 메뉴 열 때마다 동적으로 다시 그리기 (설정/개인메뉴 반영)
      if (!isOpen) {
        // [v5.05] 열자마자 즉시 비워서 옛날 데이터 노출 차단
        hamburgerDropdown.innerHTML = ''; 
        renderDynamicMenu();
        const email = getFullStoredEmail();
        if (email) {
          logPageView(email, "햄버거 메뉴 열기", "menu_open");
        }
      }
    });

    // 화면 다른 곳 클릭하면 닫히게 설정
    document.addEventListener("click", () => {
      hamburgerDropdown.style.display = "none";
    });
  }
}

/**
 * 커스텀 대화상자를 표시합니다.
 */
const showCustomDialog = ({ title, message, type = 'alert', placeholder = '', defaultValue = '' }) => {
  return new Promise((resolve) => {
    let overlay = document.getElementById('custom-dialog-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-dialog-overlay';
      overlay.className = 'custom-dialog-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="custom-dialog-content">
        <div style="width: 40px; height: 4px; background: rgba(0,0,0,0.1); border-radius: 2px; margin: -10px auto 15px auto;"></div>
        <div class="custom-dialog-title">${title}</div>
        <div class="custom-dialog-message">${message}</div>
        ${type === 'prompt' ? `<input type="text" class="custom-dialog-input" id="custom-dialog-input" placeholder="${placeholder}" value="${defaultValue}">` : ''}
        <div class="custom-dialog-actions">
          ${type !== 'alert' ? `<button class="custom-dialog-btn custom-dialog-btn-secondary" id="custom-dialog-cancel">취소</button>` : ''}
          <button class="custom-dialog-btn custom-dialog-btn-primary" id="custom-dialog-ok">확인</button>
        </div>
      </div>
    `;

    overlay.style.display = 'flex';
    const input = overlay.querySelector('#custom-dialog-input');
    if (input) {
      input.focus();
      input.onkeyup = (e) => { if (e.key === 'Enter') okBtn.click(); };
    }

    const okBtn = overlay.querySelector('#custom-dialog-ok');
    const cancelBtn = overlay.querySelector('#custom-dialog-cancel');

    okBtn.onclick = () => {
      const val = type === 'prompt' ? input.value : true;
      overlay.style.display = 'none';
      resolve(val);
    };

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        overlay.style.display = 'none';
        resolve(type === 'prompt' ? null : false);
      };
    }
  });
};

const cAlert = (msg, title = '알림') => showCustomDialog({ title, message: msg, type: 'alert' });
const cConfirm = (msg, title = '확인') => showCustomDialog({ title, message: msg, type: 'confirm' });
const cPrompt = (msg, def = '', title = '입력') => showCustomDialog({ title, message: msg, type: 'prompt', defaultValue: def });

/**
 * 동적 햄버거 메뉴를 렌더링합니다.
 */
async function renderDynamicMenu() {
  const dropdown = document.getElementById("hamburger-dropdown");
  if (!dropdown) return;

  const email = getFullStoredEmail();
  if (!email) return;

  try {
    // [v5.05] 병렬 호출로 속도 극대화 및 불필요한 import 제거
    const [teacher, customMenus] = await Promise.all([
      getTeacherProfile(email).catch(() => null),
      fetchCustomMenus(email).catch(() => [])
    ]);

    // 기본 메뉴 설정 (설정이 없으면 모두 표시)
    const settings = teacher?.settings || {
      menu_config: ["total-records", "check-survey", "bulk-record", "print-report", "analysis", "map-3d", "quiz", "student-stats", "search"]
    };
    const showMenu = (id) => settings.menu_config.includes(id);

    let html = '';

    // 0. 버전 정보 상단 고정
    html += `
      <div style="font-size: 0.75rem; color: #86868b; text-align: right; margin-bottom: 8px; padding-right: 5px;">
        v5.08
      </div>
    `;

    // 1. 공통 상단 (기록 건수) - 비동기 로딩 방식으로 변경
    html += `
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .rotating-hourglass {
          display: inline-block;
          animation: spin 1.5s linear infinite;
        }
        #menu-total-records-count {
          display: inline-block;
          min-width: 42px;
          text-align: center;
        }
      </style>
      <button onclick="location.href='total-records.html?sort=time'">
          📋 전체 기록 <strong id="menu-total-records-count" style="color:#0071e3;"><span class="rotating-hourglass">⏳</span></strong>건
      </button>
      <div class="menu-divider"></div>
    `;

    // [New] 학생 현황/검색
    if (showMenu('search')) {
      html += `<button onclick="location.href='search.html'">🔍 학생 현황/검색</button>`;
    }

    if (showMenu('student-stats')) {
      html += `<button onclick="location.href='analysis.html'">📈 학생 분석</button>`;
    }

    // [v5.02] 학급 분석 메뉴 다시 추가 (명칭 변경)
    if (teacher?.assigned_class) {
      const [g, c] = teacher.assigned_class.split('-');
      html += `<button onclick="location.href='class-analysis.html?grade=${g}&class=${c}'">📊 학급 분석</button>`;
    }

    // 2. 기초조사 (설정에 따라)
    if (showMenu('bulk-record')) {
      html += `<button onclick="location.href='bulk-record.html'">✍️ 일괄 기록하기</button>`;
    }

    if (showMenu('check-survey')) {
      html += `<button onclick="location.href='check-survey.html'">📝 기초조사 확인</button>`;
    }

    if (showMenu('print-report')) {
      html += `<button onclick="location.href='print-report.html'">🖨️ 기록 통계/출력</button>`;
    }

    if (showMenu('map-3d')) {
      html += `<button onclick="location.href='map-3d.html'">🏫 실 위치</button>`;
    }

    if (showMenu('quiz')) {
      html += `<button onclick="location.href='quiz.html'">🎮 인물 퀴즈</button>`;
    }

    html += `<div class="menu-divider"></div>`;

    if (showMenu('notifications')) {
      html += `<button onclick="openSettingsModal('${email}')">🔔 알림 설정/센터</button>`;
    }

    if (showMenu('custom-groups')) {
      html += `<button onclick="openSettingsModal('${email}')">⭐ 그룹 관리</button>`;
    }

    // [M2] 하드코딩된 관리자 이메일 목록 제거 → 역할 기반 판정
    const isAdminEmail = (schoolMe()?.role_key === 'admin')
      || Object.values(schoolMe()?.permissions?.admin || {}).some(Boolean);

    // 5. 개인 메뉴 (커스텀 메뉴)

    // 5. 개인 메뉴 (커스텀 메뉴)
    if (customMenus && customMenus.length > 0) {
      html += `<div class="menu-divider"></div>`;
      html += `<div class="menu-section-title">개인 메뉴</div>`;
      customMenus.forEach(menu => {
        html += `<button onclick="location.href='stu-list.html?custom_menu_id=${menu.id}'">⭐ ${menu.name}</button>`;
      });
    }

    // 6. 하단 공통 (2025 명렬, 로그아웃, 설정)
    html += `<button onclick="location.href='index-2025.html'">📅 25학년 명렬</button>`;
    
    // [New] 설정 메뉴 추가
    html += `<button onclick="location.href='settings.html'" style="color: #5856D6; font-weight: bold;">⚙️ 설정</button>`;

    if (isAdminEmail) {
      html += `<div class="menu-divider"></div>`;
      html += `<button style="color:#365cf5; font-weight:700;" onclick="location.href='admin-console.html${location.search}'">⚙️ 학교 설정 콘솔</button>`;
      html += `<button style="color: #000000; font-weight: 500; font-size: 0.95rem;" onclick="location.href='admin.html'">📜 user log</button>`;
    }

    dropdown.innerHTML = html;

    // [비동기] 전체 기록 건수 비동기 로딩 및 화면 갱신
    fetchClassStats()
      .then(stats => {
        const countSpan = document.getElementById("menu-total-records-count");
        if (countSpan) {
          countSpan.innerHTML = stats?.grandTotal || 0;
        }
      })
      .catch(err => {
        console.error("Failed to fetch class stats:", err);
        const countSpan = document.getElementById("menu-total-records-count");
        if (countSpan) {
          countSpan.innerHTML = "0";
        }
      });
  } catch (e) {
    console.error("Dynamic menu rendering failed", e);
  }
}

/**
 * 암호화된 이메일 불러오기 (마스킹됨)
 */
function getStoredEmail() {
  const encrypted = localStorage.getItem('teacher_auth_token');
  if (!encrypted) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
    const email = bytes.toString(CryptoJS.enc.Utf8);
    return email ? maskEmailPrefix(email.split('@')[0]) : "교사";
  } catch (e) {
    return "교사";
  }
}

/**
 * 암호화된 전체 이메일 불러오기
 */
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

/**
 * 암호화하여 저장
 */
function setStoredEmail(email) {
  const encrypted = CryptoJS.AES.encrypt(email, API_CONFIG.SECRET_KEY).toString();
  localStorage.setItem('teacher_auth_token', encrypted);
}

// ----------------------------------------------------
// 교사 인증 로직 (Local Storage + Crypto JS)
// ----------------------------------------------------
async function initAuth() {
  const authModal = document.getElementById('auth-modal');
  const authInput = document.getElementById('auth-email-input');
  const authSubmit = document.getElementById('auth-submit-btn');
  const errorMsg = document.getElementById('auth-error-msg');
  const titleBar = document.querySelector('.title-bar');
  const classGrid = document.querySelector('.class-grid');

  // 저장된 세션이 있으면 서버에서 유효한 교사인지 검증 (레거시 토큰은 자동 마이그레이션됨)
  const fullEmail = getFullStoredEmail();
  if (fullEmail || localStorage.getItem('oc_session')) {
    try {
      const { verifySession } = await import('./supabase.js');
      const session = await verifySession();

      if (session && (session.email || session.offline)) {
        const email = session.email || fullEmail;
        if (email && window.clarity) window.clarity("identify", email);
        // [M2] keeper 이메일 하드코딩 → 지킴이 역할 기반
        if ((session.role || session.role_key) === 'gatekeeper') {
          window.location.href = `keeper.html${location.search}`;
          return false;
        }
        authModal.style.display = 'none';
        return true;
      }
      // 등록 해제/삭제된 교사 → 세션 초기화 후 재인증 유도
      console.warn('유효하지 않은 세션 — 재인증이 필요합니다.');
      localStorage.removeItem('teacher_auth_token');
      localStorage.removeItem('oc_session');
    } catch (e) {
      console.error('세션 검증 중 오류:', e);
      authModal.style.display = 'none';
      return true;
    }
  }

  // 인증 안 되어 있으면 모달 메인에 강제 노출 (배경 콘텐츠 숨기기)
  titleBar.style.display = 'none';
  classGrid.style.display = 'none';

  // [v4.18] 인증 모달이 가려지는 문제 해결
  const splash = document.getElementById("splash-screen");
  if (splash) splash.remove();

  authModal.style.display = 'flex';
  authModal.style.zIndex = '100001'; // 스플래시보다 높게 설정
  authModal.style.backgroundColor = 'rgba(255,255,255,1)'; // 불투명하게 덮기

  return new Promise((resolve) => {
    authSubmit.addEventListener('click', async () => {
      const email = authInput.value.trim();
      if (!email) {
        errorMsg.style.display = 'block';
        errorMsg.textContent = '이메일을 입력해주세요.';
        return;
      }

      authSubmit.textContent = '확인 중...';
      errorMsg.style.display = 'none';

      try {
        // API 게이트웨이로 로그인 → 서명된 세션 토큰 발급 (브라우저는 DB 키를 갖지 않음)
        const { loginTeacher } = await import('./supabase.js');
        const res = await loginTeacher(email);

        if (!res.ok) {
          errorMsg.style.display = 'block';
          errorMsg.textContent = ({
            not_registered: '등록되지 않은 교사 이메일입니다.',
            no_tenant: '학교 주소로 접속해 주세요. (예: demo.creat1324.com — 로컬은 ?school=demo)',
            school_not_found: '해당 학교가 존재하지 않습니다. 주소를 확인해 주세요.',
            school_suspended: '이 학교는 현재 비활성 상태입니다.',
            teacher_inactive: '비활성 처리된 계정입니다. 학교 관리자에게 문의하세요.',
          }[res.error]) || '인증에 실패했습니다. 잠시 후 다시 시도해주세요.';
          authSubmit.textContent = '인증하기';
        } else {
          const data = { email: res.email };
          // 인증 통과
          setStoredEmail(data.email);

          if (window.clarity) {
            window.clarity("identify", data.email);
          }

          // [M2] keeper 이메일 하드코딩 → 지킴이 역할 기반
          if ((res.role || res.role_key) === 'gatekeeper') {
            window.location.href = `keeper.html${location.search}`;
            resolve(false);
            return;
          }
          authModal.style.display = 'none';
          // 화면 복구
          titleBar.style.display = 'flex';
          classGrid.style.display = 'flex';
          resolve(true);
        }
        // 실시간 알림 초기화
    initRealtimeNotifications();
  } catch (err) {
        console.error('Auth error', err);
        errorMsg.style.display = 'block';
        errorMsg.textContent = '네트워크 오류가 발생했습니다.';
        authSubmit.textContent = '인증하기';
      }
    });

    // 엔터키 지원
    authInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        authSubmit.click();
      }
    });
  });
}


function initGlobalTip() {
  const tipEl = document.getElementById("global-tip");
  const hideCheckbox = document.getElementById("hide-global-tip");
  const closeBtn = document.getElementById("close-global-tip");

  if (!tipEl || !hideCheckbox) return;

  if (localStorage.getItem("hideGlobalTip") !== "true") {
    tipEl.style.display = "flex";
  }

  // 체크박스 누르면 바로 사라지게 처리
  hideCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      localStorage.setItem("hideGlobalTip", "true");
      tipEl.style.display = "none";
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      tipEl.style.display = "none";
    });
  }
}

function renderInitialGrid(container) {
  container.innerHTML = "";

  // [M2] 학교 설정(school_units)으로 격자를 그린다. 3학년×6반 하드코딩 제거.
  const lvls = schoolLevels();
  if (!lvls.length) {
    container.innerHTML = '<div style="padding:20px;color:#888">학년·반 구조가 설정되지 않았습니다. 관리자 콘솔에서 학년·반을 추가해 주세요.</div>';
    return;
  }

  lvls.forEach((lvl, li) => {
    const col = document.createElement("div");
    col.className = "grade-column";
    // 학년별 색상: 하드코딩 대신 팔레트에서 순환 (테마 gradeColors 우선)
    const palette = window.SCHOOL?.school?.theme?.gradeColors;
    const hue = Array.isArray(palette) && palette.length
      ? null
      : [150, 210, 30, 280, 0, 190][li % 6];

    lvl.units.forEach((u, ci) => {
      const box = document.createElement("div");
      box.className = "class-box";
      box.dataset.grade = u.level_order;
      box.dataset.class = u.class_order;
      const key = unitKey(u);                 // "1-1"
      const info = classInfo.find(c => c.key === key)
        || classInfo.find(c => c.grade === u.level_order && c.class === u.class_order)
        || {};

      const light = Math.max(35, 90 - (ci + 1) * 12);
      const bgColor = hue == null
        ? palette[ci % palette.length]
        : `hsl(${hue}, 60%, ${light}%)`;
      const dark = hue == null ? false : light < 55;

      box.innerHTML = `
        <section class="class-section"
                 style="background-color:${bgColor}; ${dark ? 'color:#fff;' : ''} cursor:pointer; -webkit-tap-highlight-color:transparent;">
          <h3 class="class-title" style="${dark ? 'color:#fff;' : 'color:#333; -webkit-text-stroke:0.5px #fff; paint-order:stroke fill;'} pointer-events:none; text-shadow:${dark ? '0 2px 4px rgba(0,0,0,.5)' : '0 2px 3px rgba(0,0,0,.2)'};">
            <span class="class-label">${u.level_label} ${u.class_label}</span>
            <span id="badge-${key}" class="badge-placeholder"></span>
          </h3>
          <div class="teacher-line" style="pointer-events:none; ${dark ? 'color:#fff; -webkit-text-stroke:0.3px #000; text-shadow:0 1px 2px rgba(0,0,0,.8);' : 'color:#000;'}">
            <div><strong>${info.homeroom || ''}</strong></div>
            <div><strong>${info.sub || ''}</strong></div>
          </div>
        </section>`;

      const section = box.querySelector(".class-section");
      if (section) {
        section.addEventListener("click", (e) => window.handleClassClick(e, u.level_order, u.class_order));
      }
      col.appendChild(box);
    });
    container.appendChild(col);
  });

  attachLongPressEvents();
}

function updateClassBadges(classStats) {
  Object.keys(classStats).forEach(key => {
    const badgeEl = document.getElementById(`badge-${key}`);
    const count = classStats[key];
    if (badgeEl && count > 0) {
      const [grade, classNum] = key.split("-");
      // TODO: 설정 기능 추가 시 토글 가능하도록 복구할 예정
      // badgeEl.innerHTML = `<a href="total-records.html?grade=${grade}&class=${classNum}" class="count-badge-link"><span class="count-badge">(${count}건)</span></a>`;
      badgeEl.innerHTML = ``; // 현재는 무조건 숨김
    }
  });
}

// ----------------------------------------------------
// 연락처 롱프레스 및 모달 로직
// ----------------------------------------------------

let pressTimer;
let isPressing = false;
let startX = 0, startY = 0;
let lastLongPressTime = 0;

window.handleClassClick = function (e, g, c) {
  // 모달이 열려있거나 롱프레스 직후라면 이동 방지
  const modal = document.getElementById("contact-modal");
  const isModalOpen = modal && (modal.style.display === "flex" || modal.style.display === "block");
  const now = Date.now();
  const justLongPressed = (now - lastLongPressTime < 500);

  console.log("Class Click:", g, c, "ModalOpen:", isModalOpen, "JustPressed:", justLongPressed);

  if (isModalOpen || justLongPressed) {
    if (e) e.preventDefault();
    return;
  }

  // stu-list.html이 기대하는 파라미터로 명시적 이동
  const targetUrl = `stu-list.html?grade=${g}&class=${c}`;
  console.log("Redirecting to:", targetUrl);
  window.location.href = targetUrl;
};

function attachLongPressEvents() {
  const boxes = document.querySelectorAll(".class-box");

  boxes.forEach((box) => {
    // [M2] data-grade/data-class 속성으로 매칭 (라벨 문자열 파싱 제거)
    const grade = parseInt(box.dataset.grade, 10);
    const classNum = parseInt(box.dataset.class, 10);
    if (!Number.isFinite(grade) || !Number.isFinite(classNum)) return;
    const info = classInfo.find(c => c.grade === grade && c.class === classNum);
    if (!info) return;

    // 터치/마우스 다운 (박스 전체)
    const startPress = (e) => {
      // 롱프레스 시 내부의 a 태그의 기본 이동을 막거나 제어하기 위한 플래그
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX;
      startY = touch.clientY;

      isPressing = true;
      box.classList.add("pressing");

      pressTimer = setTimeout(() => {
        if (isPressing) {
          e.preventDefault(); // 기본 동작 막기
          if (navigator.vibrate) navigator.vibrate(50); // 햅틱 피드백
          lastLongPressTime = Date.now();
          openContactModal(info);
        }
      }, 400); // 0.4초 길게 누르면 발동 (전작 600ms에서 단축)
    };

    // 터치/마우스 업 및 취소
    const endPress = (e) => {
      clearTimeout(pressTimer);
      isPressing = false;
      box.classList.remove("pressing");
    };

    // 스크롤 시 취소
    const cancelPress = (e) => {
      if (!isPressing) return;

      const touch = e.touches ? e.touches[0] : e;
      const moveX = Math.abs(touch.clientX - startX);
      const moveY = Math.abs(touch.clientY - startY);

      // 조금만 움직여도 취소 (스크롤용)
      if (moveX > 10 || moveY > 10) {
        clearTimeout(pressTimer);
        isPressing = false;
        box.classList.remove("pressing");
      }
    };

    // 박스 전체에 이벤트 리스너 등록
    box.addEventListener("mousedown", startPress);
    box.addEventListener("touchstart", startPress, { passive: false }); // preventDefault 사용을 위해 passive: false

    box.addEventListener("mouseup", endPress);
    box.addEventListener("mouseleave", endPress);
    box.addEventListener("touchend", endPress);
    box.addEventListener("touchcancel", endPress);

    box.addEventListener("mousemove", cancelPress);
    box.addEventListener("touchmove", cancelPress, { passive: true });

    // 브라우저 기본 메뉴(복사, 공유 등) 방지
    box.addEventListener("contextmenu", (e) => {
      if (isPressing || (modal && modal.style.display === "flex")) {
        e.preventDefault();
      }
    });


  });
}

function openContactModal(info) {
  const modal = document.getElementById("contact-modal");
  const title = document.getElementById("contact-modal-title");
  const body = document.getElementById("contact-modal-body");

  if (!modal) return;

  title.innerText = `${info.grade}학년 ${info.class}반 교사 연락처`;

  // 담임/부담임 전화/문자 버튼 생성
  let bodyHtml = '';

  // 1. 담임 정보
  if (info.homeroom && info.homeroom !== '미정') {
    bodyHtml += `
      <div class="teacher-contact-row">
          <span>👤 담임: ${info.homeroom}</span>
          <div class="teacher-contact-actions">
              ${info.homeroomPhone ? `
                <a href="tel:${info.homeroomPhone}" style="color:#FF3B30">📞</a>
                <a href="sms:${info.homeroomPhone}" style="color:#34C759">💬</a>
              ` : '<span style="font-size:0.8rem; color:#999;">연락처 없음</span>'}
          </div>
      </div>`;
  }

  // 2. 부담임 정보
  if (info.sub && info.sub !== '미정') {
    bodyHtml += `
      <div class="teacher-contact-row">
          <span>👤 부담임: ${info.sub}</span>
          <div class="teacher-contact-actions">
              ${info.subPhone ? `
                <a href="tel:${info.subPhone}" style="color:#FF3B30">📞</a>
                <a href="sms:${info.subPhone}" style="color:#34C759">💬</a>
              ` : '<span style="font-size:0.8rem; color:#999;">연락처 없음</span>'}
          </div>
      </div>`;
  }

  if (!bodyHtml) bodyHtml = '<div style="padding:10px; color:#999;">등록된 교사 정보가 없습니다.</div>';
  body.innerHTML = bodyHtml;

  modal.style.display = "flex";
}

function initContactModal() {
  const modal = document.getElementById("contact-modal");
  if (!modal) return;

  const closeBtn = document.getElementById("close-contact-modal");

  // 닫기 버튼으로 닫기
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // 배경 클릭 시 닫기
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  // ESC 키로 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (modal.style.display === "flex") {
        modal.style.display = "none";
      }
      
      const settingsModal = document.getElementById("settings-modal");
      if (settingsModal && settingsModal.style.display === "flex") {
        settingsModal.style.display = "none";
      }

      const tipEl = document.getElementById("global-tip");
      if (tipEl && tipEl.style.display !== "none") {
        tipEl.style.display = "none";
      }
    }
  });
}

// checkClassAnalysisPermission 함수는 renderDynamicMenu 내부로 통합되어 제거되었습니다.

// [v5.01] 설정 로직이 settings.html/js로 이동하여 관련 함수들을 삭제했습니다.

// 전역 함수 등록
window.deleteCustomMenu = async (id) => {
  // [v5.01] 개인 그룹 및 인라인 추가 로직이 settings.js로 이동했습니다.
};


// [Global] 토스트 알림 함수
window.showToast = function (message, type = 'error') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;

  let icon = '🔔';
  if (type === 'error') icon = '⚠️';
  if (type === 'success') icon = '✅';
  if (type === 'info') icon = 'ℹ️';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
      if (container.childNodes.length === 0) container.remove();
    });
  }, 3500);
};

// [Global] 실시간 알림 연동
// initRealtimeNotifications was moved to src/js/notification-service.js

