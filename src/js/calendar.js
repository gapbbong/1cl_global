import { API_CONFIG } from './config.js';
import CryptoJS from 'crypto-js';
import { supabase } from './supabase.js';

const CONFIG = {
    // [M2] GAS 경로 폐기 — 캘린더는 Supabase(schedules 테이블)만 사용
    API_URL: null
};

let viewMode = 'month'; // 'month', 'all', 'academic_only'
let currentYear = 2026;
let currentMonth = 3;

const today = new Date();
if (today.getFullYear() === 2026 && today.getMonth() + 1 >= 3) {
    currentMonth = today.getMonth() + 1;
} else if (today.getFullYear() > 2026) {
    currentYear = today.getFullYear();
    currentMonth = today.getMonth() + 1;
}

let loadedEvents = [];

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const isAuthenticated = await initAuth();
        if (!isAuthenticated) return;

        await initCalendar();
    } catch (error) {
        console.error("Initialization error:", error);
    }
});

async function initCalendar() {
    setupButtons();
    await loadMonthData(currentYear, currentMonth);
}

function setupButtons() {
    const btnNext = document.getElementById('btn-next-month');
    const btnFull = document.getElementById('btn-full-year');
    const btnBack = document.getElementById('btn-back-home');
    const btnAcademic = document.getElementById('btn-filter-academic');

    if (btnBack) {
        btnBack.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }

    if (btnAcademic) {
        btnAcademic.addEventListener('click', () => {
            showAcademicPopup();
        });
    }

    const btnClosePopup = document.getElementById('close-academic-btn');
    if (btnClosePopup) {
        btnClosePopup.addEventListener('click', closeAcademicPopup);
    }

    // 오버레이 클릭 시 닫기
    const overlay = document.getElementById('academic-popup-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeAcademicPopup();
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', async () => {
            // [V3.6.1] 새로운 달을 보기 위해 현재 떠 있는 달들을 모두 접음
            const currentSeparators = document.querySelectorAll('.month-separator:not(.collapsed)');
            currentSeparators.forEach(sep => {
                const foldBtn = sep.querySelector('.month-fold-btn');
                if (foldBtn) sep.click(); // 강제 클릭으로 접기 트리거
            });

            currentMonth++;
            if (currentMonth > 12) {
                currentMonth = 1;
                currentYear++;
            }
            await loadMonthData(currentYear, currentMonth, true);
        });
    }

    if (btnFull) {
        btnFull.addEventListener('click', async () => {
            const confirmed = confirm("2026학년도 전체 일정을 가져오시겠습니까?\n\n모든 데이터를 한꺼번에 불러오므로 시간과 데이터가 약간 소모될 수 있습니다. 잠시만 기다려 주세요.");
            if (confirmed) {
                viewMode = 'all';
                await loadAllData();
            }
        });
    }
}

async function loadMonthData(year, month, append = false) {
    let progress = 10;
    const interval = setInterval(() => {
        if (progress < 95) {
            const diff = (98 - progress) / 12;
            progress += Math.max(0.1, Math.random() * diff);
            showLoading(true, `${month}월 일정을 불러오고 있습니다...`, "Supabase 캐시에서 데이터를 신속하게 가져옵니다.", Math.floor(progress));
        }
    }, 100);

    showLoading(true, `${month}월 일정을 불러오고 있습니다...`, "안정적인 클라우드 DB에서 일정을 조회합니다.", 10);
    try {
        // [V3.9.0] Supabase 캐시 우선 로딩: 현재 월과 다음 월을 동시에 요청
        const nextMonth = (month % 12) + 1;
        
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonthYear = month === 12 ? year + 1 : year;
        const endDate = new Date(nextMonthYear, nextMonth, 0).toISOString().split('T')[0];

        console.log(`📡 [Calendar] ${month}월 일정 요청:`, startDate, "~", endDate);
        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .neq('type_name', '월중')
            .order('date', { ascending: true });

        clearInterval(interval);
        if (error) {
            console.error("❌ [Calendar] Supabase 조회 에러:", error);
            throw error;
        }

        console.log(`✅ [Calendar] ${data.length}건의 일정 로드됨:`, data);

        // 기존 형식(typeName)으로 변환
        const formattedData = data.map(item => ({
            ...item,
            typeName: item.type_name
        }));

        showLoading(true, `로딩 완료!`, "화면 정렬을 시작합니다.", 100);

        if (append) {
            loadedEvents.push(...formattedData);
        } else {
            loadedEvents = formattedData;
        }

        if (viewMode === 'academic_only') {
            renderCalendarAcademic(loadedEvents);
        } else {
            // 현재 월과 다음 달만 먼저 렌더링
            const monthsToRender = append ? [month] : [month, nextMonth];
            monthsToRender.forEach(m => {
                const y = (m === 1 && month === 12) ? year + 1 : year;
                renderCalendar(eventsToRender(loadedEvents, y, m), y, m, append || (m !== monthsToRender[0]));
            });
        }

        showLoading(true, `완료!`, "일정이 표시됩니다.", 100);
        setTimeout(() => scrollToRelevantDate(), 300);

        // [V3.9.0] 나머지 월 데이터 백그라운드 로딩 (Supabase는 빨라서 한 번에 여러 달 가능)
        if (!append) {
            loadRemainingMonthsInBackground(year, month);
        }

    } catch (e) {
        clearInterval(interval);
        console.error("Supabase Load Error:", e);
        // [Fallback] Supabase 실패 시 기존 GAS API 시도 (선택 사항)
    } finally {
        setTimeout(() => showLoading(false), 500);
    }
}

/**
 * [V3.7.0] 백그라운드에서 학년도 순서(3월~익년 2월)에 맞춰 조용히 수집
 */
async function loadRemainingMonthsInBackground(year, month) {
    try {
        // [V3.9.0] Supabase의 성능을 활용하여 한 번에 전체 학년도 일정을 가져옵니다.
        const startDate = `${year}-03-01`;
        const endDate = `${year + 1}-02-28`;

        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .neq('type_name', '월중')
            .order('date', { ascending: true });

        if (error) throw error;

        // 기존 loadedEvents와 중복되지 않게 합치기
        const formattedData = data.map(item => ({
            ...item,
            typeName: item.type_name
        }));

        console.log(`📦 [Calendar] 백그라운드 로드 완료: ${formattedData.length}건`);
        if (formattedData.length > 0) {
            console.log("📅 [Calendar] 로드된 첫 5건 날짜:", formattedData.slice(0, 5).map(e => e.date));
        }

        // 이미 로드된 이벤트(현재 월, 다음 월)는 제외하고 추가
        const existingKeys = new Set(loadedEvents.map(ev => `${ev.date}|${ev.title}|${ev.type}`));
        const newEvents = formattedData.filter(ev => !existingKeys.has(`${ev.date}|${ev.title}|${ev.type}`));
        
        loadedEvents.push(...newEvents);

        // 각 월별로 렌더링 (이미 렌더링된 월은 제외)
        const academicOrder = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
        const nextMonth = (month % 12) + 1;
        
        for (const m of academicOrder) {
            // [Fix] 이미 렌더링된 현재 월(month)과 다음 월(nextMonth)은 건너뜀
            if (m === Number(month) || m === Number(nextMonth)) continue;
            const y = (m < 3) ? Number(year) + 1 : Number(year);
            const monthEvents = eventsToRender(loadedEvents, y, m);
            
            // 일정이 있는 달만 그리거나, 혹은 최소한 구역은 확보 (사용자 요구에 따라 선택)
            if (viewMode !== 'academic_only') {
                 renderCalendar(monthEvents, y, m, true);
            }
        }
    } catch (e) {
        console.warn(`Background Load Error:`, e);
    }
}

function eventsToRender(allEvents, year, month) {
    return allEvents.filter(ev => {
        const parts = ev.date.split('-').map(Number);
        return parts[0] === year && parts[1] === month;
    });
}

async function loadAllData() {
    showLoading(true, "전체 일정을 불러오는 중입니다...", "Supabase 통합 캐시 조회 중", 5);
    try {
        const startDate = `2026-03-01`;
        const endDate = `2027-02-28`;

        const { data, error } = await supabase
            .from('schedules')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .neq('type_name', '월중')
            .order('date', { ascending: true });

        if (error) throw error;

        showLoading(true, "데이터 수신 완료!", "전체 일정을 구성합니다", 100);
        
        const formattedData = data.map(item => ({
            ...item,
            typeName: item.type_name
        }));
        
        loadedEvents = formattedData;

        if (viewMode === 'academic_only') {
            renderCalendarAcademic(loadedEvents);
        } else {
            renderCalendarAll(loadedEvents);
        }

        const btnNext = document.getElementById('btn-next-month');
        if (btnNext) btnNext.style.display = 'none';
        const btnFull = document.getElementById('btn-full-year');
        if (btnFull) btnFull.style.display = 'none';

        showLoading(true, "로딩 완료!", "화면으로 이동합니다.", 100);
    } catch (e) {
        console.error("Supabase Load All Error:", e);
    } finally {
        setTimeout(() => {
            showLoading(false);
            scrollToRelevantDate();
        }, 500);
    }
}

/**
 * 일반 리스트 뷰 (1일~말일)
 */
function renderCalendar(events, year, month, append = false) {
    const listContainer = document.getElementById("day-list");
    if (!listContainer) return;
    console.log(`🎨 [Calendar] renderCalendar 시작 (events: ${events.length}건, ${year}년 ${month}월)`);
    if (events.length > 0) {
        console.log("🔍 [Calendar] 첫 번째 이벤트 상세:", events[0]);
    }
    if (!append) listContainer.innerHTML = "";

    const lastDay = new Date(year, month, 0).getDate();
    let lastMonth = -1;
    let matchCount = 0;

    for (let d = 1; d <= lastDay; d++) {
        const dateObj = new Date(year, month - 1, d);
        const currentDayIdx = dateObj.getDay();

        // 토요일(6), 일요일(0) 제외
        if (currentDayIdx === 0 || currentDayIdx === 6) continue;

        const m = dateObj.getMonth() + 1;

        if (m !== lastMonth) {
            // [V3.7.8] 스티키 헤더 수평 정렬 및 스타일 최적화 (인라인 제거)
            const separator = document.createElement("div");
            separator.className = `month-separator`;

            separator.innerHTML = `
                <span class="m-text">${m}월</span>
                <span class="s-text">SCHEDULE</span>
            `;

            listContainer.appendChild(separator);
            lastMonth = m;
        }

        // 이전 월인 경우 카드 초기 숨김 처리
        const isPreviousMonthCard = (year === 2026 && m < currentMonth);

        const dayEvents = events.filter(ev => {
            const parts = ev.date.split('-').map(Number);
            return parts[0] === year && parts[1] === month && parts[2] === d;
        });
        if (dayEvents.length > 0) matchCount++;

        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const dayClasses = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const isToday = dateObj.toDateString() === new Date().toDateString();

        const card = document.createElement("div");
        card.id = `day-${year}-${m}-${d}`; // [v3.0.2] 고유 ID 부여
        const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        card.dataset.date = dateStr;
        card.className = `day-card ${isToday ? 'today' : ''} ${dayClasses[currentDayIdx]}`;

        // [V3.8.1] 주말(토/일)이면 다음 주 월요일 강조
        const today = new Date();
        const tDay = today.getDay();
        if (tDay === 0 || tDay === 6) {
            const nextMon = new Date(today);
            nextMon.setDate(today.getDate() + (tDay === 0 ? 1 : 2));
            if (dateObj.getFullYear() === nextMon.getFullYear() &&
                dateObj.getMonth() === nextMon.getMonth() &&
                dateObj.getDate() === nextMon.getDate()) {
                card.classList.add('next-monday-pulse');
            }
        }

        // 이전 월이면 숨김 (V3.6.0)
        if (isPreviousMonthCard) {
            card.style.display = 'none';
        }

        const eventsHtml = dayEvents.map((ev, idx) => {
            if (ev.typeName === '창체') {
                return `
                <div class="event-item">
                    <span class="event-seq">${idx + 1}.</span>
                    <span class="event-title"><span class="event-tag changche">[창체]</span> ${ev.title}</span>
                </div>`;
            }
            return `
            <div class="event-item">
                <span class="event-seq">${idx + 1}.</span>
                <span class="event-title">${ev.title} <span class="event-tag">[${ev.typeName}]${ev.dept ? ` <span class="event-dept">(${ev.dept})</span>` : ''}</span></span>
            </div>`;
        }).join('') || '<div class="no-event">일정이 없습니다.</div>';

        card.innerHTML = `
            <div class="day-info">
                <span class="day-name">${m}월 ${d}일 (${days[currentDayIdx]})</span>
            </div>
            <div class="event-content">
                ${eventsHtml}
            </div>
        `;
        listContainer.appendChild(card);
    }
    console.log(`🎨 [Calendar] ${month}월 렌더링 완료 (일정이 있는 일수: ${matchCount}일)`);
}

/**
 * 연간 학사일정만 모아보기 필터 뷰
 */
function renderCalendarAcademic(events) {
    const listContainer = document.getElementById("day-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    const academicOnly = events.filter(ev => ev.typeName === '연간' || ev.type === 'academic');

    if (academicOnly.length === 0) {
        listContainer.innerHTML = '<div class="no-event" style="padding:40px; text-align:center;">등록된 연간 학사일정이 없습니다.</div>';
        return;
    }

    renderGroupedEvents(listContainer, academicOnly);
}

/**
 * 연도 전체 데이터 렌더링
 */
function renderCalendarAll(events) {
    const listContainer = document.getElementById("day-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";
    renderGroupedEvents(listContainer, events);
}

function renderGroupedEvents(container, events) {
    const grouped = {};
    events.forEach(ev => {
        if (!grouped[ev.date]) grouped[ev.date] = [];
        grouped[ev.date].push(ev);
    });

    const sortedDates = Object.keys(grouped).sort((a, b) => {
        const da = a.split('-').map(Number);
        const db = b.split('-').map(Number);
        return new Date(da[0], da[1] - 1, da[2]) - new Date(db[0], db[1] - 1, db[2]);
    });

    let lastMonth = -1;
    sortedDates.forEach(dateStr => {
        const parts = dateStr.split('-').map(Number);
        const y = parts[0], m = parts[1], d = parts[2];
        const dateObj = new Date(y, m - 1, d);
        const currentDayIdx = dateObj.getDay();

        // 토요일(6), 일요일(0) 제외
        if (currentDayIdx === 0 || currentDayIdx === 6) return;

        if (m !== lastMonth) {
            const isPreviousMonth = (y === 2026 && m < currentMonth);
            const separator = document.createElement("div");
            separator.className = `month-separator ${isPreviousMonth ? 'collapsed' : ''}`;
            separator.innerHTML = `
                <div class="month-title-row">
                    <span>${m}월</span><span class="schedule-text">SCHEDULE</span>
                </div>
                <button class="month-fold-btn">${isPreviousMonth ? '펼치기' : '접기'}</button>
            `;

            separator.addEventListener('click', () => {
                const btn = separator.querySelector('.month-fold-btn');
                const isCollapsed = separator.classList.toggle('collapsed');
                btn.innerText = isCollapsed ? '펼치기' : '접기';

                let next = separator.nextElementSibling;
                while (next && !next.classList.contains('month-separator')) {
                    if (next.classList.contains('day-card')) {
                        next.style.display = isCollapsed ? 'none' : 'block';
                    }
                    next = next.nextElementSibling;
                }
            });

            container.appendChild(separator);
            lastMonth = m;
        }

        const isPreviousMonthCard = (y === 2026 && m < currentMonth);

        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const dayClasses = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

        const card = document.createElement("div");
        card.id = `day-${y}-${m}-${d}`; // [v3.0.2] 고유 ID 부여
        card.className = `day-card ${dayClasses[currentDayIdx]}`;

        if (isPreviousMonthCard) {
            card.style.display = 'none';
        }

        const dayEvents = grouped[dateStr];
        const eventsHtml = dayEvents.map((ev, idx) => {
            if (ev.typeName === '창체') {
                return `
                <div class="event-item">
                    <span class="event-seq">${idx + 1}.</span>
                    <span class="event-title"><span class="event-tag changche">[창체]</span> ${ev.title}</span>
                </div>`;
            }
            return `
            <div class="event-item">
                <span class="event-seq">${idx + 1}.</span>
                <span class="event-title">${ev.title} <span class="event-tag">[${ev.typeName}]${ev.dept ? ` <span class="event-dept">(${ev.dept})</span>` : ''}</span></span>
            </div>`;
        }).join('');

        card.innerHTML = `
            <div class="day-info">
                <span class="day-name">${m}월 ${d}일 (${days[currentDayIdx]})</span>
            </div>
            <div class="event-content">
                ${eventsHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

/**
 * 교사 인증 로직
 */
async function initAuth() {
    const authModal = document.getElementById('auth-modal');
    const authInput = document.getElementById('auth-email-input');
    const authSubmit = document.getElementById('auth-submit-btn');
    const errorMsg = document.getElementById('auth-error-msg');
    const container = document.querySelector('.calendar-container');

    const storedEmail = getStoredEmail();
    if (storedEmail) {
        if (authModal) authModal.style.display = 'none';
        return true;
    }

    if (container) container.style.display = 'none';
    if (authModal) {
        authModal.style.display = 'flex';
    }

    return new Promise((resolve) => {
        authSubmit.addEventListener('click', async () => {
            const email = authInput.value.trim();
            if (!email) {
                errorMsg.style.display = 'block';
                errorMsg.textContent = '이메일을 입력해주세요.';
                return;
            }

            authSubmit.textContent = '확인 중...';
            authSubmit.disabled = true;

            try {
                const { supabase } = await import('./supabase.js');
                const { data, error } = await supabase
                    .from('teachers')
                    .select('email')
                    .eq('email', email)
                    .maybeSingle();

                if (error || !data) {
                    errorMsg.style.display = 'block';
                    errorMsg.textContent = '등록되지 않은 교사 이메일입니다.';
                    authSubmit.textContent = '인증하기';
                    authSubmit.disabled = false;
                } else {
                    setStoredEmail(data.email);
                    authModal.style.display = 'none';
                    if (container) container.style.display = 'block';
                    resolve(true);
                }
            } catch (err) {
                errorMsg.style.display = 'block';
                errorMsg.textContent = '인증 중 오류가 발생했습니다.';
                authSubmit.textContent = '인증하기';
                authSubmit.disabled = false;
            }
        });
    });
}

function getStoredEmail() {
    const encrypted = localStorage.getItem('teacher_auth_token');
    if (!encrypted) return null;
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, API_CONFIG.SECRET_KEY);
        const email = bytes.toString(CryptoJS.enc.Utf8);
        return email || null;
    } catch (e) { return null; }
}

function setStoredEmail(email) {
    const encrypted = CryptoJS.AES.encrypt(email, API_CONFIG.SECRET_KEY).toString();
    localStorage.setItem('teacher_auth_token', encrypted);
}

function showLoading(show, text = "불러오는 중...", subText = "", percent = null) {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
        overlay.style.display = show ? "flex" : "none";
        const p = overlay.querySelector('p');
        const percentEl = document.getElementById("loading-percent");
        const gaugeBar = document.getElementById("loading-gauge-bar");

        if (p) {
            const baseText = text.includes("...") ? text.split("...")[0] + "..." : text;
            p.childNodes[0].textContent = baseText + " ";
        }

        if (percentEl) {
            percentEl.innerText = percent !== null ? `(${Math.floor(percent)}%)` : "";
        }

        if (gaugeBar && percent !== null) {
            gaugeBar.style.width = `${percent}%`;
        }

        let subEl = overlay.querySelector('.loading-text-detail');
        if (subEl) subEl.innerText = subText;
    }
}

/**
 * [V3.8.1] 현재 상황에 맞는 최적의 위치로 스크롤 (안정성 강화)
 */
function scrollToRelevantDate() {
    const tryScroll = (retryCount = 0) => {
        const today = new Date();
        const day = today.getDay(); // 0:일, 1:월, ... 6:토
        
        let targetDate = new Date(today);
        if (day === 0) { // 일요일 -> 내일(월)
            targetDate.setDate(today.getDate() + 1);
        } else if (day === 6) { // 토요일 -> 모레(월)
            targetDate.setDate(today.getDate() + 2);
        }
        
        const targetStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
        let targetCard = document.querySelector(`.day-card[data-date="${targetStr}"]`);

        // 만약 해당 날짜 카드가 없으면(공동실습소 등으로 수집 안됨), 가장 가까운 미래의 카드를 찾음
        if (!targetCard) {
            const allCards = Array.from(document.querySelectorAll('.day-card:not([style*="display: none"])'));
            targetCard = allCards.find(card => card.dataset.date >= targetStr);
        }

        if (targetCard) {
            const headerHeight = 70; 
            const viewPortOffset = window.innerHeight * 0.15; // 상단 15% 지점 (V4.16)
            const rect = targetCard.getBoundingClientRect();
            const targetY = rect.top + window.pageYOffset - headerHeight - viewPortOffset;

            window.scrollTo({ top: targetY, behavior: retryCount > 0 ? 'smooth' : 'auto' });

            // 레이아웃 보정 (3회)
            if (retryCount < 3) {
                setTimeout(() => tryScroll(retryCount + 1), 250);
            }
        } else if (retryCount < 15) {
            setTimeout(() => tryScroll(retryCount + 1), 150);
        }
    };

    requestAnimationFrame(() => tryScroll());
}

/**
 * 연간 학사일정 팝업 표시
 */
async function showAcademicPopup() {
    const overlay = document.getElementById('academic-popup-overlay');
    const grid = document.getElementById('academic-grid');

    // 팝업 표시 및 스크롤 방지
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // 이미 렌더링되어 있다면 재사용
    if (grid.children.length > 0) return;

    async function fetchYearlyAcademicData() {
        const grid = document.getElementById('academic-grid');
        if (!grid) return;

        try {
            console.log("📡 연간 학사 일정 데이터 요청 중...", CONFIG.API_URL);

            grid.innerHTML = `
            <div style="text-align:center; padding: 60px; width:100%; display:flex; flex-direction:column; align-items:center; gap:15px;">
                <div class="loader-spinner"></div>
                <div style="font-size: 1.1rem; font-weight: 600; color: #333;">학사 일정을 가져오고 있습니다...</div>
                <div id="loading-progress" style="font-size: 0.9rem; color: #666;">연결 중 (0%)</div>
                <div style="width: 200px; height: 6px; background: #eee; border-radius: 3px; overflow: hidden;">
                    <div id="loading-bar" style="width: 0%; height: 100%; background: var(--primary-color, #4A90E2); transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;

            const progressText = document.getElementById('loading-progress');
            const progressBar = document.getElementById('loading-bar');

            let progress = 0;
            const progressInterval = setInterval(() => {
                if (progress < 96) {
                    const diff = (98 - progress) / 10;
                    progress += Math.max(0.1, Math.random() * diff);
                    if (progressText) progressText.innerText = `일정을 분석 중입니다 (${Math.floor(progress)}%)`;
                    if (progressBar) progressBar.style.width = `${progress}%`;
                }
            }, 200);

            const { data: yearlyData, error } = await supabase
                .from('schedules')
                .select('*')
                .eq('type', 'academic') // 학사 일정 위주 또는 전체
                .order('date', { ascending: true });

            if (error) throw error;
            
            // 기존 격자 형식(날짜 키: {text, bg, fc})으로 변환
            const gridData = { _version: "v3.9.0-Supabase" };
            yearlyData.forEach(ev => {
                if (!gridData[ev.date]) {
                    gridData[ev.date] = { text: ev.title, bg: ev.color, fc: ev.font_color };
                } else {
                    gridData[ev.date].text += "\n" + ev.title;
                }
            });

            clearInterval(progressInterval);
            if (progressBar) progressBar.style.width = "100%";
            if (progressText) progressText.innerText = "로딩 완료! (100%)";

            setTimeout(() => {
                renderAcademicGrid(gridData);
            }, 200);

        } catch (error) {
            console.error("❌ 데이터 로드 중 치명적 오류:", error);
            grid.innerHTML = `<div style="color:red; text-align:center; padding:50px;">데이터 로드 실패: ${error.message}</div>`;
        }
    }
    fetchYearlyAcademicData();
}

function closeAcademicPopup() {
    const overlay = document.getElementById('academic-popup-overlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

/**
 * 전교생 연간 일정을 월별 달력 격자로 렌더링
 */
function renderAcademicGrid(data) {
    const grid = document.getElementById('academic-grid');
    grid.innerHTML = '';

    // 2026년 3월부터 2027년 2월까지
    const months = [
        [2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8],
        [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2]
    ];

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    months.forEach(([year, month]) => {
        const monthBox = document.createElement('div');
        monthBox.className = 'academic-month-box';
        // 당월 식별을 위해 ID 또는 데이터 속성 부여
        if (year === currentYear && month === currentMonth) {
            monthBox.id = 'current-month-section';
        }

        // [V3.6.8] 상단 타이틀 영역 (접기 버튼 제거, 폰트 축소)
        monthBox.innerHTML = `
            <div class="academic-month-row" data-month="${month}">
                <div class="academic-month-title">${month}월</div>
                <div class="academic-day-grid">
                    <div class="academic-day-header">월</div>
                    <div class="academic-day-header">화</div>
                    <div class="academic-day-header">수</div>
                    <div class="academic-day-header">목</div>
                    <div class="academic-day-header">금</div>
                    ${generateMonthHTML(year, month, data)}
                </div>
            </div>
        `;
        grid.appendChild(monthBox);
    });

    // [V3.8.4] 4월부터만 자동 스크롤 적용 (3월은 최상단이므로 제외)
    if (currentMonth >= 4) {
        setTimeout(() => {
            const currentSection = document.getElementById('current-month-section');
            const popupBody = document.querySelector('.academic-popup-body');

            if (currentSection && popupBody) {
                setTimeout(() => {
                    // 부모 컨테이너(#academic-grid)의 위치를 고려하여 계산
                    const grid = document.getElementById('academic-grid');
                    const targetY = Math.max(0, currentSection.getBoundingClientRect().top - popupBody.getBoundingClientRect().top + popupBody.scrollTop - 20); // 당월 타이틀이 가려지지 않고 노출되도록 약간 덜 올림 (-20px)

                    popupBody.scrollTo({
                        top: targetY,
                        behavior: 'smooth'
                    });
                }, 100);
            }
        }, 550); // 팝업 애니메이션 대기 시간을 약간 늘림 (안정성)
    }
}

function generateMonthHTML(year, month, events) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    let html = '';

    if (firstDay >= 1 && firstDay <= 5) {
        for (let i = 1; i < firstDay; i++) {
            html += '<div class="academic-day-cell other-month"></div>';
        }
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dateStrNoZero = `${year}-${month}-${d}`;
        const eventData = events[dateStr] || events[dateStrNoZero] || null;
        const isToday = (dateStr === todayStr); // 오늘 여부 확인

        let eventText = "";
        let eventBg = "";
        let eventFontColor = "";

        if (typeof eventData === 'string') {
            eventText = eventData;
        } else if (eventData && typeof eventData === 'object') {
            eventText = eventData.text || "";
            eventBg = eventData.bg || "";
            eventFontColor = eventData.fc || ""; // 추가된 필드
        }

        const dayOfWeek = (firstDay + d - 1) % 7;
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // 주말 건너뜀

        let classes = 'academic-day-cell';
        if (eventText) classes += ' has-event';
        if (isToday) classes += ' is-today'; // [v2.33] 오늘 강조

        // 배경색 및 텍스트 대비 처리
        let styleStr = "";
        let textColor = eventFontColor || "#000000"; // 시트 글자색 우선, 없으면 검정
        let isDark = false;

        // 배경색 적용
        if (eventBg && eventBg !== "#ffffff" && eventBg !== "white" && eventBg !== "transparent") {
            styleStr = `style="background-color: ${eventBg};"`;

            // 만약 글자색이 명시되지 않았을 때만 자동 대비 계산
            if (!eventFontColor && eventBg.startsWith('#')) {
                const hex = eventBg.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                if (brightness < 140) {
                    isDark = true;
                    textColor = "#ffffff";
                }
            }

            // 빨간색 계열이면 공휴일 스타일 적용 (선택적)
            if (eventBg.startsWith('#')) { // Check again for hex format
                const hex = eventBg.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                if (r > 200 && g < 150 && b < 150) classes += ' holiday';
            }
        }

        // 글자색이 흰색 계열이면 shadow 추가 (가독성)
        const isWhiteText = textColor.toLowerCase() === "#ffffff" || textColor.toLowerCase() === "white";
        const textStyle = `style="color: ${textColor}; ${isWhiteText ? 'text-shadow: 0 1px 2px rgba(0,0,0,0.5);' : 'text-shadow: 0 0 1px #fff;'}"`;
        // [V3.6.6] 투명도 제거: rgba(0,0,0,0.6) -> #000000
        const numStyle = `style="color: ${isWhiteText ? 'rgba(255,255,255,0.9)' : '#000000'};"`;

        html += `
            <div class="${classes}" ${styleStr}>
                <div class="academic-day-num" ${numStyle}>${d}</div>
                ${eventText ? `<div class="academic-day-event" ${textStyle} title="${eventText.replace(/\n/g, ', ')}">${eventText.replace(/\n/g, '<br/>')}</div>` : ''}
            </div>
        `;
    }

    return html;
}
