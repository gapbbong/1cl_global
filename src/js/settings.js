import { getTeacherProfile, fetchCustomMenus, updateTeacherSettings, saveCustomMenu, deleteCustomMenu, fetchAllStudents } from './api.js';
import { API_CONFIG } from './config.js';
import CryptoJS from 'crypto-js';

// Global functions for inline actions
window.deleteCustomMenu = deleteCustomMenuAndReload;
window.editCustomMenuGroupStudents = editCustomMenuGroupStudents;
window.addCustomMenuInline = addCustomMenuInline;
window.showCustomGroupStudents = showCustomGroupStudents;

// SW 등록 여부 능동적 확인 및 등록 (settings.html 직행 시 대비)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(err => {
        console.warn('⚠️ settings.js SW Registration failed: ', err);
    });
}

window.sendTestNotification = async () => {
    if (!('Notification' in window)) {
        alert("이 브라우저는 알림을 지원하지 않습니다.");
        return;
    }
    
    console.log("🔔 [테스트] 알림 권한 상태:", Notification.permission);
    
    // 권한이 'denied'면 설정 안내
    if (Notification.permission === 'denied') {
        alert("알림 권한이 차단되어 있습니다.\n\n삼성 인터넷 앱 설정 → 사이트 설정 → 알림에서 '1cl.netlify.app'을 찾아 허용으로 변경해 주세요.");
        return;
    }

    // 권한이 'default'이면 요청
    if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert("알림 권한이 거부되었습니다.\n\n브라우저 설정 > 알림에서 이 사이트를 허용해 주세요.");
            return;
        }
    }

    const options = {
        body: "테스트 알림입니다. 기기에서 알림이 온다면 정상입니다!",
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'test-notification-' + Date.now(),
        renotify: true,
        vibrate: [200, 100, 200],
        requireInteraction: true,
        silent: false
    };

    try {
        console.log("🚀 [테스트] 알림 발송 시도...");
        
        let sent = false;

        // Service Worker를 통한 발송 지원 여부 확인
        if ('serviceWorker' in navigator) {
            try {
                // ready 대신 명시적으로 등록 상태를 가져오거나 다시 등록 시도
                let reg = await navigator.serviceWorker.getRegistration();
                if (!reg) {
                    console.log("⚠️ SW 미등록 상태 - 새로 등록 시도");
                    reg = await navigator.serviceWorker.register('/service-worker.js');
                }
                
                if (reg && reg.showNotification) {
                    console.log("✅ [테스트] Service Worker를 통한 발송");
                    await reg.showNotification('OneClass 테스트 알림', options);
                    sent = true;
                    console.log("✅ [테스트] SW 알림 발송 성공");
                } else {
                    console.warn("⚠️ [테스트] Service Worker가 여전히 준비되지 않았거나 showNotification을 지원하지 않음");
                }
            } catch (swErr) {
                console.warn("⚠️ [테스트] SW 알림 실패:", swErr.message);
            }
        } else {
            console.warn("⚠️ [테스트] 브라우저가 Service Worker를 지원하지 않습니다.");
        }

        // SW를 지원하지 않는 데스크탑 등 구형 환경을 위한 폴백 (모바일에서는 여기서 에러 발생)
        if (!sent) {
            try {
                console.log("⚠️ [테스트] Notification API 직접 호출 시도 (PC 환경용)");
                const n = new Notification('OneClass 테스트 알림', options);
                n.onclick = () => { window.focus(); n.close(); };
                sent = true;
            } catch (fallbackErr) {
                console.warn("⚠️ [테스트] 직접 호출 실패 (모바일 정상 동작):", fallbackErr.message);
                throw new Error("모바일 기기에서는 Service Worker가 필요합니다. 앱 초기화 중이거나 캐시 문제일 수 있습니다. 새로고침 후 다시 시도해주세요.");
            }
        }

        if (sent) {
            alert("테스트 알림을 보냈습니다!\n\n만약 알림이 전혀 안 온다면:\n• 폰의 '방해 금지 모드' 확인\n• 기기 설정 > 알림 > 삼성 인터넷에서 알림 허용 확인");
        }
    } catch (err) {
        console.error("❌ [테스트] 알림 발송 중 오류:", err);
        alert("알림 발송 중 오류가 발생했습니다: " + err.message);
    }
};

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
 * 커스텀 대화상자
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

document.addEventListener("DOMContentLoaded", async () => {
  renderSettings();
});

async function renderSettings() {
  const content = document.getElementById("settings-content");
  const email = getFullStoredEmail();
  
  if (!email) {
    location.href = 'index.html';
    return;
  }

  try {
    const teacher = await getTeacherProfile(email);
    const customMenus = await fetchCustomMenus(email);

    const settings = teacher?.settings || {
      initial_page: "home",
      menu_config: ["total-records", "bulk-record", "print-report", "student-stats", "map-3d", "quiz", "search", "check-survey"],
      notification_type: "none"
    };

    let html = `
      <div class="settings-container">
        <!-- 1. 시작 화면 -->
        <div class="settings-section">
          <div class="settings-title">🏠 시작 화면 설정</div>
          <div class="initial-page-grid">
            <label class="initial-page-option">
              <input type="radio" name="initial-page" value="home" ${settings.initial_page === 'home' ? 'checked' : ''}>
              <div class="option-pill">학급 목록 홈</div>
            </label>
            <label class="initial-page-option">
              <input type="radio" name="initial-page" value="my_photos" ${settings.initial_page === 'my_photos' ? 'checked' : ''}>
              <div class="option-pill">우리반 명렬(사진)</div>
            </label>
          </div>
        </div>

        <!-- 2. 알림 설정 -->
        <div class="settings-section">
          <div class="settings-title">🔔 실시간 기록 알림 수신</div>
          <div class="notif-page-grid">
            <label class="notif-option">
              <input type="radio" name="notif-type" value="all" ${settings.notification_type === 'all' ? 'checked' : ''}>
              <div class="option-pill">전체 알림</div>
            </label>
            <label class="notif-option">
              <input type="radio" name="notif-type" value="my_class" ${settings.notification_type === 'my_class' ? 'checked' : ''}>
              <div class="option-pill">우리반만</div>
            </label>
            <label class="notif-option">
              <input type="radio" name="notif-type" value="none" ${settings.notification_type === 'none' ? 'checked' : ''}>
              <div class="option-pill">받지 않음</div>
            </label>
          </div>
          
          <div style="background: rgba(0, 113, 227, 0.05); border-radius: 14px; padding: 14px; margin-top: 15px; border: 1px solid rgba(0, 113, 227, 0.1);">
            <div class="settings-title" style="font-size: 0.8rem; margin-bottom: 6px;">📱 알림 작동 확인</div>
            <button onclick="sendTestNotification()" class="btn-primary" style="padding: 8px !important; font-size: 0.85rem !important; margin-bottom: 8px;">지금 테스트 알림 보내기</button>
            <div style="font-size: 0.75rem; color: #424245; line-height: 1.5;">
              버튼을 눌러도 알림이 안 온다면 <strong>기기 설정 > 알림 > 삼성 인터넷</strong>에서 알림이 허용되어 있는지 확인해 주세요.
            </div>
          </div>
        </div>

        <!-- 3. 메뉴 구성 -->
        <div class="settings-section">
          <div class="settings-title">☰ 메뉴 가시성 설정</div>
          <div class="settings-item-list">
            <label class="menu-item-toggle"><input type="checkbox" value="search" ${settings.menu_config.includes('search') ? 'checked' : ''}> 검색</label>
            <label class="menu-item-toggle"><input type="checkbox" value="student-stats" ${settings.menu_config.includes('student-stats') ? 'checked' : ''}> 학생 분석</label>
            <label class="menu-item-toggle"><input type="checkbox" value="bulk-record" ${settings.menu_config.includes('bulk-record') ? 'checked' : ''}> 일괄기록</label>
            <label class="menu-item-toggle"><input type="checkbox" value="check-survey" ${settings.menu_config.includes('check-survey') ? 'checked' : ''}> 기초조사</label>
            <label class="menu-item-toggle"><input type="checkbox" value="print-report" ${settings.menu_config.includes('print-report') ? 'checked' : ''}> 통계/출력</label>
            <label class="menu-item-toggle"><input type="checkbox" value="map-3d" ${settings.menu_config.includes('map-3d') ? 'checked' : ''}> 위치</label>
            <label class="menu-item-toggle"><input type="checkbox" value="quiz" ${settings.menu_config.includes('quiz') ? 'checked' : ''}> 퀴즈</label>
            <label class="menu-item-toggle" style="background: #f0f7ff;"><input type="checkbox" value="notifications" ${settings.menu_config.includes('notifications') ? 'checked' : ''}> 알림센터</label>
          </div>
        </div>

        <!-- 4. 개인 그룹 -->
        <div class="settings-section">
          <div class="settings-title">⭐ 개인 그룹 관리</div>
          <p style="font-size: 0.8rem; color: #86868b; margin-top: -8px; margin-bottom: 12px;">동아리, 방과후 등 나만의 학생 목록을 만드세요.</p>
          
          <div style="display: flex; gap: 8px; margin-bottom: 15px; align-items: stretch;">
            <input type="text" id="new-group-name" placeholder="새 그룹 이름" style="flex: 1; min-width: 0; padding: 12px; border-radius: 12px; border: 1px solid #ddd; font-size: 0.9rem; outline: none; background: #fff;">
            <button class="btn btn-primary" style="white-space: nowrap; padding: 0 20px;" onclick="addCustomMenuInline()">추가</button>
          </div>

          <div class="custom-menu-list">
            ${customMenus.length === 0 ? '<p style="font-size: 0.85rem; color: #999; text-align: center; padding: 20px;">등록된 그룹이 없습니다.</p>' : ''}
            ${customMenus.map(menu => `
              <div class="custom-menu-card">
                <div class="custom-menu-name">
                  ${menu.name} <span class="custom-menu-count">(${menu.student_pids.length}명)</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-sm btn-primary" onclick="editCustomMenuGroupStudents(${menu.id}, '${menu.name.replace(/'/g, "\\'")}')">학생 선택</button>
                  <button class="btn btn-sm" style="background:#17a2b8; color:white; border:none;" onclick="showCustomGroupStudents(${menu.id})">확인</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteCustomMenu(${menu.id})">삭제</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <button id="group-save-btn">설정 모든 내용 저장하기</button>
        
        <div style="height: 50px;"></div>
      </div>
    `;

    content.innerHTML = html;

    // Event Binding
    document.getElementById("group-save-btn").onclick = saveAllSettings;

    const performLogout = async () => {
      if (await cConfirm("정말로 로그아웃 하시겠습니까?")) {
        localStorage.removeItem("teacher_auth_token");
        localStorage.removeItem("oc_session");
        location.href = 'index.html';
      }
    };

    const headerLogoutBtn = document.getElementById("header-logout-btn");
    if (headerLogoutBtn) headerLogoutBtn.onclick = performLogout;

  } catch (error) {
    content.innerHTML = `<div style="padding:40px; text-align:center; color:red;">오류 발생: ${error.message}</div>`;
  }
}

async function saveAllSettings() {
  const email = getFullStoredEmail();
  const initialPage = document.querySelector('input[name="initial-page"]:checked')?.value || 'home';
  const notificationType = document.querySelector('input[name="notif-type"]:checked')?.value || 'all';
  const menuCheckboxes = document.querySelectorAll(".menu-item-toggle input:checked");
  const menuConfig = ["total-records", ...Array.from(menuCheckboxes).map(cb => cb.value)];

  const settings = {
    initial_page: initialPage,
    notification_type: notificationType,
    menu_config: menuConfig
  };

  try {
    const saveBtn = document.getElementById("group-save-btn");
    saveBtn.textContent = "저장 중...";
    saveBtn.disabled = true;

    await updateTeacherSettings(email, settings);

    // [v5.01] 네이티브 알림 권한 요청 (알림 수신을 선택한 경우에만)
    if (notificationType !== 'none' && 'Notification' in window) {
      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          console.log('🔔 알림 권한이 허용되었습니다.');
        }
      }
    }

    await cAlert("설정이 저장되었습니다. 메인 화면으로 이동합니다.");
    location.href = 'index.html?force=home';
  } catch (e) {
    cAlert("저장 실패: " + e.message, "오류");
    const saveBtn = document.getElementById("group-save-btn");
    saveBtn.textContent = "설정 모든 내용 저장하기";
    saveBtn.disabled = false;
  }
}

async function addCustomMenuInline() {
  const email = getFullStoredEmail();
  const input = document.getElementById("new-group-name");
  const name = input.value.trim();
  if (!name) {
    cAlert("그룹 이름을 입력해 주세요.");
    return;
  }

  try {
    await saveCustomMenu(email, name, []);
    input.value = "";
    renderSettings(); // Re-render
  } catch (error) {
    if (error.message.includes("custom_menus")) {
      await cAlert("DB 테이블이 생성되지 않았습니다. 관리자에게 문의하거나 제공된 SQL을 실행해 주세요.", "DB 오류");
    } else {
      cAlert("그룹 추가 실패: " + error.message, "오류");
    }
  }
}

async function deleteCustomMenuAndReload(id) {
  if (!await cConfirm("이 개인 메뉴를 삭제하시겠습니까?")) return;
  try {
    await deleteCustomMenu(id);
    renderSettings();
  } catch (e) {
    cAlert("삭제 실패: " + e.message, "오류");
  }
}

async function showCustomGroupStudents(menuId) {
  try {
    const email = getFullStoredEmail();
    const menus = await fetchCustomMenus(email);
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return;

    if (!menu.student_pids || menu.student_pids.length === 0) {
      cAlert("이 그룹에는 아직 추가된 학생이 없습니다.", menu.name);
      return;
    }

    const students = await fetchAllStudents();
    const memberTextList = menu.student_pids.map(pid => {
      const s = students.find(x => x.pid === pid);
      if (s) return `${s.학년}-${s.반} ${s.이름}`;
      return `알 수 없는 학생(${pid})`;
    }).sort((a,b) => a.localeCompare(b));

    cAlert(`<div style="max-height: 400px; overflow-y: auto; text-align: left; line-height: 1.6; font-size: 0.95rem; padding: 10px; border: 1px solid #eee; border-radius: 8px; background: #fafafa;">
      ${memberTextList.map(t => `<div>• ${t}</div>`).join('')}
    </div>`, `👥 ${menu.name} 학생 목록`);
  } catch (e) {
    cAlert("학생 정보를 불러오는데 실패했습니다: " + e.message, "오류");
  }
}

async function editCustomMenuGroupStudents(menuId, menuName) {
  try {
    const students = await fetchAllStudents();
    const email = getFullStoredEmail();
    const menus = await fetchCustomMenus(email);
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return;

    const selectedPids = new Set(menu.student_pids || []);

    let overlay = document.getElementById('student-picker-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'student-picker-overlay';
      overlay.className = 'student-picker-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="student-picker-content" style="max-width: 400px; margin: auto;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div style="font-weight: 800; font-size: 1.1rem;">👥 그룹 구성: ${menuName}</div>
          <button class="btn btn-sm btn-outline-secondary" onclick="this.closest('.student-picker-overlay').style.display='none'">닫기</button>
        </div>
        
        <div style="display: flex; gap: 8px; margin-bottom: 20px;">
          <input type="text" id="picker-search-id" placeholder="학번 입력" maxlength="${(window.SCHOOL?.school?.student_id_rule?.length) || 6}" style="flex: 1; min-width: 0; padding: 12px; border-radius: 12px; border: 1px solid #ddd; font-size: 1rem; outline: none; background: #fff; text-align: center; letter-spacing: 2px;">
          <button class="btn btn-primary" id="lookup-btn" style="white-space: nowrap; padding: 0 20px;">조회</button>
        </div>

        <div id="lookup-result-area" style="text-align: center; min-height: 250px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8f9fa; border-radius: 16px; padding: 20px; border: 1px dashed #ccc;">
          <div style="color: #888; font-size: 0.95rem;">학생의 학번을 입력하고<br>조회 버튼을 눌러주세요.</div>
        </div>
      </div>
    `;

    overlay.style.display = 'flex';

    const searchInput = overlay.querySelector('#picker-search-id');
    const lookupBtn = overlay.querySelector('#lookup-btn');
    const resultArea = overlay.querySelector('#lookup-result-area');

    searchInput.onkeyup = (e) => {
      if (e.key === 'Enter') lookupBtn.click();
    };

    lookupBtn.onclick = () => {
      const q = searchInput.value.trim();
      const idLen = (window.SCHOOL?.school?.student_id_rule?.length) || 4;
      if (!q || isNaN(q) || (q.length !== idLen && q.length < 3)) {
        resultArea.innerHTML = `<div style="color: #d9534f; font-weight: bold; margin-bottom: 10px;">⚠️ 학번을 정확히 입력해주세요.</div>`;
        return;
      }
      
      const student = students.find(s => s.학번 === q || s.student_id === q);
      if (!student) {
        resultArea.innerHTML = `<div style="color: #d9534f; font-weight: bold; margin-bottom: 10px;">⚠️ 해당 학번의 학생을 찾을 수 없습니다.</div>`;
        return;
      }

      const isAlreadyInGroup = selectedPids.has(student.pid);
      const photoUrl = student.photo_url || student['사진이미지'] || 'img/default.png';
      
      let actionHtml = '';
      if (isAlreadyInGroup) {
        actionHtml = `<div style="margin-top: 15px; color: #5cb85c; font-weight: bold;">✅ 이미 이 그룹에 포함된 학생입니다.</div>`;
      } else {
        actionHtml = `<button class="btn btn-primary" id="add-student-btn" style="margin-top: 15px; width: 100%; padding: 12px; border-radius: 12px; font-weight: bold; font-size: 1rem; box-shadow: 0 4px 10px rgba(0, 113, 227, 0.3);">그룹에 저장하기</button>`;
      }

      resultArea.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <div style="position: relative; width: 120px; height: 160px; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-bottom: 15px; background: #eee;">
            <img src="${photoUrl}" alt="학생 사진" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='img/default.png'">
          </div>
          <div style="font-size: 1.1rem; font-weight: 800; color: #333;">${student.학번} ${student.이름}</div>
          <div style="font-size: 0.9rem; color: #666; margin-top: 4px;">${student.학년}학년 ${student.반}반</div>
          ${actionHtml}
        </div>
      `;

      const addBtn = resultArea.querySelector('#add-student-btn');
      if (addBtn) {
        addBtn.onclick = async () => {
          addBtn.textContent = '저장 중...';
          addBtn.disabled = true;
          try {
            const newPids = Array.from(selectedPids);
            newPids.push(student.pid);
            
            await saveCustomMenu(email, menuName, newPids, menuId);
            selectedPids.add(student.pid);
            
            lookupBtn.click();
            cAlert(`${student.이름} 학생이 추가되었습니다.`);
            
            renderSettings();
          } catch (e) {
            cAlert("저장 오류: " + e.message);
            addBtn.textContent = '그룹에 저장하기';
            addBtn.disabled = false;
          }
        };
      }
    };

  } catch (e) {
    cAlert("학생 목록 로드 실패: " + e.message);
  }
}
