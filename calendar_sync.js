/**
 * 학교 일정 통합 자동화 비서 (V4.92 - Supabase 최적화 및 UPSERT 반영)
 */

const CONFIG = {
    CALENDAR_ID: 'ks.cal153@gmail.com',
    YEAR: 2026,
    DOCS: {
        PLANNING: '1AdtB1ed5T3kAdwEZZN7EWVKUwK0-Q0bV',
        MONTHLY: '1qZ2NZPBJZiticNtzYUhwiBRkwUF2ORyb',
        ACADEMIC: '1VKHdSREQbEcCTcFFgwWxAcNbMxSx_kYgcwxvyMcWeJk',
        CREATIVE: '1iqMpHw9VW7Xz6hwTFr7WUC36v4ibtZRuUHfsKVpexr8'
    },
    PREFIX: {
        PLANNING: '[기획]',
        MONTHLY: '[월중]',
        ACADEMIC: '[연간]',
        CREATIVE: '[창체]'
    },
    SUPABASE: {
        URL: 'https://pwyflwjtafarkwbejoen.supabase.co',
        // [주의] 실제 운영 시 스크립트 속성(PropertiesService)에 저장하는 것을 권장합니다.
        KEY: (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY),
        TABLE: 'schedules'
    }
};

/**
 * 외부(웹 앱)에서 데이터를 요청할 때 호출되는 진입점
 * Supabase DB에서 캐싱된 데이터를 우선적으로 반환하여 응답 속도 최적화
 */
function doGet(e) {
    const month = e && e.parameter && e.parameter.month ? parseInt(e.parameter.month) : null;
    const isAll = e && e.parameter && e.parameter.all === 'true';
    const isYearly = e && e.parameter && e.parameter.type === 'yearly';

    if (isYearly) {
        return ContentService.createTextOutput(JSON.stringify(getAcademicYearData()))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Supabase에서 데이터 가져오기 시도 (성능 최적화)
    let data = fetchFromSupabase(month, isAll);

    // 2. Supabase 데이터가 없거나 실패한 경우 실시간 파싱 (폴백)
    if (!data || data.length === 0) {
        Logger.log("⚠️ Supabase에서 데이터를 가져오지 못했습니다. 실시간 파싱을 시작합니다.");
        data = getUnifiedData(isAll ? null : month);
    }

    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Supabase REST API를 사용하여 캐싱된 일정 데이터 조회
 */
function fetchFromSupabase(month = null, isAll = false) {
    let url = `${CONFIG.SUPABASE.URL}/rest/v1/${CONFIG.SUPABASE.TABLE}?select=date,title,type,type_name,dept,color,font_color`;
    
    if (month && !isAll) {
        // 특정 월 필터링 (학년도 기준: 3월~다음해 2월)
        const year = (month < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
        
        url += `&date=gte.${startDate}&date=lte.${endDate}`;
    }
    
    url += `&order=date.asc`;

    const options = {
        method: 'get',
        headers: {
            'apikey': CONFIG.SUPABASE.KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`
        },
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        if (response.getResponseCode() === 200) {
            const result = JSON.parse(response.getContentText());
            // 프라이머리 데이터 구조와 호환되도록 매핑
            return result.map(item => ({
                ...item,
                typeName: item.type_name
            }));
        }
    } catch (e) {
        Logger.log("❌ Supabase fetch error: " + e.toString());
    }
    return null;
}


function syncAllSchedules() {
    Logger.log("=== 프로세스 시작 (V3.1 - Supabase 전용 동기화) ===");
    
    // 캘린더 관련 로직 제거
    // syncSchedulesToSupabase()만 호출하여 DB 최신화
    syncSchedulesToSupabase();
    
    Logger.log("=== 모든 프로세스 종료 ===");
}

/**
 * 모든 시트 데이터를 수집하여 Supabase에 동기화 (오늘 이후 일정 초기화 후 재등록)
 */
function syncSchedulesToSupabase() {
    Logger.log("🚀 Supabase 동기화 프로세스 시작...");
    const data = getUnifiedData();
    
    if (!data || data.length === 0) {
        Logger.log("⚠️ 동기화할 데이터가 없습니다. 시계 정보를 확인해주세요.");
        return;
    }

    Logger.log(`📊 수집된 총 일정 수: ${data.length}건`);
    
    // 월별 데이터 분포 확인 (로그용)
    const monthStats = {};
    data.forEach(ev => {
        const m = ev.date.split('-')[1];
        monthStats[m] = (monthStats[m] || 0) + 1;
    });
    Logger.log("📅 월별 수집 현황: " + JSON.stringify(monthStats));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString().split('T')[0];

    // 1. 오늘 이후의 기존 일정 삭제 (중복 방지 및 수정 반영)
    const deleteUrl = `${CONFIG.SUPABASE.URL}/rest/v1/${CONFIG.SUPABASE.TABLE}?date=gte.${todayIso}`;
    const deleteOptions = {
        method: 'delete',
        headers: {
            'apikey': CONFIG.SUPABASE.KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`
        },
        muteHttpExceptions: true
    };

    try {
        const delRes = UrlFetchApp.fetch(deleteUrl, deleteOptions);
        Logger.log(`🧹 기존 데이터 정리 완료 (오늘 이후): ${delRes.getResponseCode()}`);
    } catch (e) {
        Logger.log(`⚠️ 삭제 중 오류 (무시하고 진행): ${e.toString()}`);
    }

    // 2. 새로운 일정 삽입 (기본 한도는 1000개이나 안전을 위해 200개씩 분할 전송)
    const payloadBase = data.map(ev => ({
        date: ev.date,
        title: ev.title,
        type: ev.type,
        type_name: ev.typeName,
        dept: ev.dept || null,
        color: ev.color || null,
        font_color: ev.fontColor || null,
        updated_at: new Date().toISOString()
    }));

    const chunkSize = 200;
    for (let i = 0; i < payloadBase.length; i += chunkSize) {
        const chunk = payloadBase.slice(i, i + chunkSize);
        
        const url = `${CONFIG.SUPABASE.URL}/rest/v1/${CONFIG.SUPABASE.TABLE}?on_conflict=date,title,type`;
        const options = {
            method: 'post',
            contentType: 'application/json',
            headers: {
                'apikey': CONFIG.SUPABASE.KEY,
                'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`,
                'Prefer': 'resolution=merge-duplicates'
            },
            payload: JSON.stringify(chunk),
            muteHttpExceptions: true
        };

        try {
            const response = UrlFetchApp.fetch(url, options);
            const code = response.getResponseCode();
            if (code >= 200 && code < 300) {
                Logger.log(`✅ 성공: ${i + chunk.length} / ${payloadBase.length} 건 전송 완료`);
            } else {
                Logger.log(`❌ 실패 (청크 ${i/chunkSize + 1}, 코드 ${code}): ${response.getContentText()}`);
            }
        } catch (e) {
            Logger.log(`❌ 네트워크 오류 (청크 ${i/chunkSize + 1}): ${e.toString()}`);
        }
    }
    
    Logger.log("✨ Supabase 동기화 최종 완료!");
}

function getUnifiedData(requestedMonth = null) {
    let allEvents = [];

    // 1. 학사 일정 추출
    try {
        let academicEvents = getAcademicData();
        if (requestedMonth) {
            academicEvents = academicEvents.filter(ev => parseInt(ev.date.split('-')[1]) === requestedMonth);
        }
        allEvents.push(...academicEvents);
    } catch (e) { Logger.log("Academic data error: " + e); }

    // 2. 창체 활동 추출
    try {
        let creativeEvents = getCreativeData();
        if (requestedMonth) {
            creativeEvents = creativeEvents.filter(ev => parseInt(ev.date.split('-')[1]) === requestedMonth);
        }
        allEvents.push(...creativeEvents);
    } catch (e) { Logger.log("Creative data error: " + e); }

    // 3. 월중 일정 추출 (파일 필터링으로 속도 향상)
    try {
        const monthlyEvents = getMonthlyData(requestedMonth);
        allEvents.push(...monthlyEvents);
    } catch (e) { Logger.log("Monthly data error: " + e); }

    // 4. 기획 회의 추출
    try {
        const planningEvents = getPlanningData(requestedMonth);
        allEvents.push(...planningEvents);
    } catch (e) { Logger.log("Planning data error: " + e); }

    // 최종 중복 제거 (날짜 + 제목(공백제거) + 타입)
    const uniqueMap = new Map();
    allEvents.forEach(ev => {
        const normalizedTitle = ev.title.replace(/\s+/g, '');
        const key = `${ev.date}|${normalizedTitle}|${ev.type}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, ev);
        }
    });

    return Array.from(uniqueMap.values());
}

/**
 * 날짜 포맷 헬퍼 (YYYY-MM-DD)
 */
function formatDate(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 날짜 데이터를 Date 객체로 파싱하는 통합 헬퍼
 */
function parseDateValue(val) {
    if (!val) return null;
    if (val instanceof Date) return val;

    const dateStr = val.toString().trim();
    // '3.6', '3/6', '2026-03-06' 등 모든 숫자 패턴 추출
    const parts = dateStr.match(/\d+/g);
    if (!parts || parts.length < 2) return null;

    let y = CONFIG.YEAR, m, d;
    if (parts.length >= 3) {
        y = parseInt(parts[0]);
        if (y < 100) y += 2000;
        m = parseInt(parts[1]);
        d = parseInt(parts[2]);
    } else {
        // 월.일 형태 (예: 3.6)
        m = parseInt(parts[0]);
        d = parseInt(parts[1]);
        // 3월 이후는 올해, 1~2월은 내년으로 간주 (학년도 기준)
        y = (m < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
    }

    // 유효한 날짜인지 검증
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;

    return new Date(y, m - 1, d);
}

function getAcademicData() {
    Logger.log("🗓️ 학사 일정 수집 시작 (v2.27 - 글자색 동기화)...");
    const events = [];
    const ss = SpreadsheetApp.openById(CONFIG.DOCS.ACADEMIC);
    const sheet = ss.getSheetByName('확정') || ss.getSheets()[0];
    const range = sheet.getDataRange();
    const data = range.getValues();
    const bgColors = range.getBackgrounds();
    const fontColors = range.getFontColors();

    let rowMonth = 3;

    for (let r = 0; r < data.length; r++) {
        const row = data[r];
        if (!row || row.length < 5) continue;

        // 1. 월 정보 업데이트 (B열: index 1 또는 A열: index 0)
        const cellA = row[0];
        const cellB = row[1];
        const potentialMonth = (cellB !== "" && cellB !== null) ? cellB : cellA;

        if (potentialMonth instanceof Date) {
            rowMonth = potentialMonth.getMonth() + 1;
        } else if (potentialMonth !== "" && potentialMonth !== null) {
            const mMatch = potentialMonth.toString().match(/(\d+)/);
            if (mMatch) {
                const m = parseInt(mMatch[0]);
                if (m >= 1 && m <= 12) rowMonth = m;
            }
        }

        // 2. 평일 수집 (월~금: D, F, H, J, L열) -> index 3, 5, 7, 9, 11
        for (let c = 3; c <= 11; c += 2) {
            const rawDay = row[c];
            const eventName = (row[c + 1] || "").toString().trim();
            const bgColorRaw = bgColors[r][c + 1];
            const fontColorRaw = fontColors[r][c + 1];

            const bgColor = (bgColorRaw === "#000000" || !bgColorRaw) ? "#ffffff" : bgColorRaw;
            const fontColor = (fontColorRaw === "#000000" || !fontColorRaw) ? "#000000" : fontColorRaw;

            let dayValue = NaN;
            if (rawDay instanceof Date) {
                dayValue = rawDay.getDate();
            } else if (rawDay !== "" && rawDay !== null) {
                const dMatch = rawDay.toString().match(/\d+/);
                if (dMatch) dayValue = parseInt(dMatch[0]);
            }

            if (!isNaN(dayValue) && dayValue >= 1 && dayValue <= 31 && eventName && !isGarbageContent(eventName)) {
                let eventMonth = rowMonth;
                if (dayValue >= 25 && c < 7) eventMonth = (rowMonth === 1) ? 12 : rowMonth - 1;
                else if (dayValue <= 7 && c > 9) eventMonth = (rowMonth === 12) ? 1 : rowMonth + 1;

                const year = (eventMonth < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
                events.push({
                    date: formatDate(year, eventMonth, dayValue),
                    title: cleanAcademicTitle(eventName),
                    type: 'academic',
                    typeName: '학사',
                    color: bgColor,
                    fontColor: fontColor
                });
            }
        }

        // 3. 토요일 수집 (N열: index 13)
        const satContent = (row[13] || "").toString().trim();
        const satBgRaw = bgColors[r][13];
        const satFontRaw = fontColors[r][13];
        const satBg = (satBgRaw === "#000000" || !satBgRaw) ? "#ffffff" : satBgRaw;
        const satFont = (satFontRaw === "#000000" || !satFontRaw) ? "#000000" : satFontRaw;

        if (satContent && !isGarbageContent(satContent)) {
            const friDayRaw = row[11];
            let friDay = NaN;
            if (friDayRaw instanceof Date) friDay = friDayRaw.getDate();
            else if (friDayRaw) friDay = parseInt(friDayRaw.toString().match(/\d+/)?.[0]);

            if (!isNaN(friDay)) {
                const satDay = friDay + 1;
                let eventMonth = rowMonth;
                const year = (eventMonth < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
                const finalDay = (satDay > 31) ? 1 : satDay;
                events.push({
                    date: formatDate(year, eventMonth, finalDay),
                    title: cleanAcademicTitle(satContent),
                    type: 'academic',
                    typeName: '학사',
                    color: satBg,
                    fontColor: satFont
                });
            }
        }
    }
    return events;
}

function getAcademicYearData() {
    Logger.log("🎨 연간 학사일정 정밀 파싱 시작 (v2.27 - 글자색 동기화)...");
    const ss = SpreadsheetApp.openById(CONFIG.DOCS.ACADEMIC);
    const sheet = ss.getSheetByName('확정') || ss.getSheets()[0];
    const range = sheet.getDataRange();
    const data = range.getValues();
    const bgColors = range.getBackgrounds();
    const fontColors = range.getFontColors();

    const result = { _version: "v2.27_SYNC" };
    let rowMonth = 3;

    for (let r = 0; r < data.length; r++) {
        const row = data[r];
        if (!row || row.length < 5) continue;

        const cellA = row[0];
        const cellB = row[1];
        const potentialMonth = (cellB !== "" && cellB !== null) ? cellB : cellA;

        if (potentialMonth instanceof Date) {
            rowMonth = potentialMonth.getMonth() + 1;
        } else if (potentialMonth !== "" && potentialMonth !== null) {
            const mMatch = potentialMonth.toString().match(/(\d+)/);
            if (mMatch) {
                const m = parseInt(mMatch[0]);
                if (m >= 1 && m <= 12) rowMonth = m;
            }
        }

        for (let c = 3; c <= 11; c += 2) {
            const rawDay = row[c];
            const content = (row[c + 1] || "").toString().trim();
            const bgColorRaw = bgColors[r][c + 1];
            const fontColorRaw = fontColors[r][c + 1];
            const bgColor = (bgColorRaw === "#000000" || !bgColorRaw) ? "#ffffff" : bgColorRaw;
            const fontColor = (fontColorRaw === "#000000" || !fontColorRaw) ? "#000000" : fontColorRaw;

            let dayValue = NaN;
            if (rawDay instanceof Date) dayValue = rawDay.getDate();
            else if (rawDay) dayValue = parseInt(rawDay.toString().match(/\d+/)?.[0]);

            if (!isNaN(dayValue) && dayValue >= 1 && dayValue <= 31 && content) {
                let eventMonth = rowMonth;
                if (dayValue >= 25 && c < 7) eventMonth = (rowMonth === 1) ? 12 : rowMonth - 1;
                else if (dayValue <= 7 && c > 9) eventMonth = (rowMonth === 12) ? 1 : rowMonth + 1;

                const year = (eventMonth < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
                const dateStr = formatDate(year, eventMonth, dayValue);
                const cleanedTitle = cleanAcademicTitle(content);

                // [v2.30] 필터링된 결과가 비어 있으면 스킵 (원본 fallback 제거)
                if (!cleanedTitle) continue;

                if (!result[dateStr]) {
                    result[dateStr] = { text: cleanedTitle, bg: bgColor, fc: fontColor };
                } else if (!result[dateStr].text.includes(cleanedTitle)) {
                    result[dateStr].text += "\n" + cleanedTitle;
                    // 배경색이 비어있으면 업데이트
                    if (result[dateStr].bg === "#ffffff" || result[dateStr].bg === "white" || !result[dateStr].bg) {
                        result[dateStr].bg = bgColor;
                        result[dateStr].fc = fontColor;
                    }
                }
            }
        }

        const satContent = (row[13] || "").toString().trim();
        const satBgRaw = bgColors[r][13];
        const satFontRaw = fontColors[r][13];
        const satBg = (satBgRaw === "#000000" || !satBgRaw) ? "#ffffff" : satBgRaw;
        const satFont = (satFontRaw === "#000000" || !satFontRaw) ? "#000000" : satFontRaw;

        if (satContent && !isGarbageContent(satContent)) {
            const friDayRaw = row[11];
            let friDay = NaN;
            if (friDayRaw instanceof Date) friDay = friDayRaw.getDate();
            else if (friDayRaw) friDay = parseInt(friDayRaw.toString().match(/\d+/)?.[0]);
            if (!isNaN(friDay)) {
                const satDay = friDay + 1;
                let eventMonth = rowMonth;
                const year = (eventMonth < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
                const dateStr = formatDate(year, eventMonth, satDay);
                const cleanedSat = cleanAcademicTitle(satContent);

                // [v2.30] 필터링된 결과가 비어 있으면 스킵 (원본 fallback 제거)
                if (!cleanedSat) continue;

                if (!result[dateStr]) result[dateStr] = { text: cleanedSat, bg: satBg, fc: satFont };
                else if (!result[dateStr].text.includes(cleanedSat)) {
                    result[dateStr].text += "\n" + cleanedSat;
                    if (result[dateStr].bg === "#ffffff" || result[dateStr].bg === "white") {
                        result[dateStr].bg = satBg;
                        result[dateStr].fc = satFont;
                    }
                }
            }
        }
    }
    return result;
}

/**
 * '월1', '화2', '토1' 등 요일+숫자 접두사 제거
 */
function cleanAcademicTitle(text) {
    if (!text) return "";

    const lines = text.split('\n').map(line => {
        // 1. 요일+숫자+공백 패턴 제거 (예: "월1 ", "화 2")
        let cleaned = line.replace(/^([월화수목금토일]\s*\d+\s*)+/g, '').trim();

        // 2. 가비지 데이터 최종 확인
        if (isGarbageContent(cleaned)) return null;
        return cleaned;
    }).filter(v => v);

    if (lines.length === 0) return "";
    return lines.join(' / ');
}

function isGarbageContent(text) {
    if (!text) return true;
    const t = text.toString().trim();

    // 1. 순수 숫자만 있는 경우 (날짜 오인식 방지)
    if (/^\d+$/.test(t)) return true;

    // 2. 요일(+공백)+숫자만 있는 경우 (예: "월1", "토 2")
    if (/^[월화수목금토일]\s*\d+$/.test(t)) return true;

    // 3. 너무 짧은 텍스트 (창/체 제외)
    if (t.length < 2 && t !== "창" && t !== "체") return true;

    return false;
}

function getCreativeData() {
    Logger.log("🔍 창체 데이터 정밀 수집 시작 (6/7교시 주제 전용)...");
    const events = [];
    const ss = SpreadsheetApp.openById(CONFIG.DOCS.CREATIVE);
    const sheets = ss.getSheets();

    // 26, 2026, 창체 키워드 조합으로 올해 시트 검색
    const sheet = sheets.find(s => (s.getName().includes('26') || s.getName().includes('2026')) && s.getName().includes('창체')) ||
        sheets.find(s => s.getName().includes('창체')) ||
        sheets[0];

    Logger.log("📄 대상 창체 시트: [" + sheet.getName() + "]");
    const data = sheet.getDataRange().getValues();

    // 1. 헤더에서 '6교시 주제', '7교시 주제' 열 위치 찾기 (상단 10행 이내 탐색)
    let col6 = -1, col7 = -1;
    for (let r = 0; r < Math.min(data.length, 10); r++) {
        for (let c = 0; c < data[r].length; c++) {
            const val = data[r][c]?.toString() || "";
            // '담당'이 포함되지 않고 '주제'가 포함된 '6교시/7교시' 열 찾기
            if (val.includes("6교시") && val.includes("주제") && !val.includes("담당")) col6 = c;
            if (val.includes("7교시") && val.includes("주제") && !val.includes("담당")) col7 = c;
        }
        if (col6 !== -1 && col7 !== -1) break;
    }

    // 헤더를 못 찾은 경우 안전한 기본값 사용 (경험적 인덱스 4, 5열)
    if (col6 === -1) col6 = 4;
    if (col7 === -1) col7 = 5;
    Logger.log(`📍 추출 열 확정: 6교시 주제(${col6}열), 7교시 주제(${col7}열)`);

    let successCount = 0;
    for (let r = 0; r < data.length; r++) {
        const row = data[r];
        let parsedDate = null;
        let dateColIdx = -1;

        // 날짜 찾기 (A~C열 위주)
        for (let c = 0; c < Math.min(row.length, 3); c++) {
            parsedDate = parseDateValue(row[c]);
            if (parsedDate) {
                dateColIdx = c;
                break;
            }
        }

        if (!parsedDate) continue;

        const dateStr = formatDate(parsedDate.getFullYear(), parsedDate.getMonth() + 1, parsedDate.getDate());

        // 2. 지정된 6, 7교시 열에서만 주제 추출
        let rowContents = [];
        [col6, col7].forEach(c => {
            if (c < row.length) {
                const val = row[c]?.toString().trim() || "";
                // 시수(숫자만 있는 경우) 제외, 글자수가 2자 이상인 주제만 채택
                if (val && !/^\d+$/.test(val) && val.length >= 2 && !isGarbageContent(val)) {
                    if (!rowContents.includes(val)) rowContents.push(val);
                }
            }
        });

        if (rowContents.length > 0) {
            events.push({
                date: dateStr,
                title: rowContents.join(' / '),
                type: 'creative',
                typeName: '창체'
            });
            successCount++;
        }
    }
    Logger.log(`📊 창체 수집 완료: 총 ${successCount}건 (6/7교시 필터링 적용)`);
    return events;
}

function getMonthlyData(requestedMonth) {
    const events = [];
    const folder = DriveApp.getFolderById(CONFIG.DOCS.MONTHLY);
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
        const file = files.next();
        const fileName = file.getName();

        // 요청한 월이 있는 경우 파일명 필터링
        if (requestedMonth) {
            const mStr = requestedMonth.toString();
            const mStrPad = mStr.padStart(2, '0');
            if (!fileName.includes(mStr + '월') && !fileName.includes(mStrPad + '월')) continue;
        }

        const ss = SpreadsheetApp.open(file);
        ss.getSheets().forEach(sheet => {
            const sheetName = sheet.getName();
            if (!sheetName.includes('월')) return;

            // 학년도 필터링: 작년(2025/25) 시트는 명시적으로 제외 (올해 시트가 있는 경우)
            if (sheetName.includes('2025') || sheetName.includes('25')) {
                const has2026Sheet = ss.getSheets().some(s => s.getName().includes('2026') || s.getName().includes('26'));
                if (has2026Sheet) {
                    Logger.log(`🚫 작년 시트 제외: ${sheetName}`);
                    return;
                }
            }

            const data = sheet.getDataRange().getValues();
            const monthMatch = sheetName.match(/(\d+)월/);
            if (!monthMatch) return;
            const month = parseInt(monthMatch[1]);

            if (requestedMonth && month !== requestedMonth) return;

            Logger.log(`📂 월중행사 시트 분석 중: ${sheetName}`);

            const year = (month < 3) ? CONFIG.YEAR + 1 : CONFIG.YEAR;
            for (let r = 0; r < data.length; r++) {
                let dVal = data[r][0];
                let day = (typeof dVal === 'number') ? dVal : (dVal?.toString().match(/(\d+)/) ? parseInt(dVal.toString().match(/(\d+)/)[1]) : null);
                if (day) {
                    let content = [];
                    for (let c = 2; c < data[r].length; c++) {
                        const val = data[r][c]?.toString().trim() || "";
                        if (val && !isGarbageContent(val)) {
                            if (!content.includes(val)) content.push(val);
                        }
                    }
                    if (content.length > 0) {
                        events.push({
                            date: formatDate(year, month, day),
                            title: content.join(' / '),
                            type: 'monthly',
                            typeName: '월중'
                        });
                    }
                }
            }
        });
    }
    return events;
}

function getPlanningData(requestedMonth = null) {
    const events = [];
    const folder = DriveApp.getFolderById(CONFIG.DOCS.PLANNING);
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

    while (files.hasNext()) {
        const file = files.next();
        const ss = SpreadsheetApp.open(file);
        const sheets = ss.getSheets();

        sheets.forEach(sheet => {
            const sheetName = sheet.getName();
            // [수정] "26.3.16." 등 날짜 형식이 포함된 모든 시트 매칭
            const dateMatch = sheetName.match(/(\d+)\.(\d+)\.(\d+)/);
            if (!dateMatch) return;

            const month = parseInt(dateMatch[2]);
            if (requestedMonth && month !== requestedMonth) return;

            Logger.log("📂 기획 회의 시트 분석 중: " + sheetName);
            const data = sheet.getDataRange().getValues();
            
            // [수정] 컬럼 위치 자동 감지
            let colDept = 0, colDate = -1, colContent = -1;
            for (let r = 0; r < Math.min(data.length, 10); r++) {
                for (let c = 0; c < data[r].length; c++) {
                    const val = data[r][c]?.toString() || "";
                    if (val.includes("부서명")) colDept = c;
                    if (val.includes("일자")) colDate = c;
                    if (val.includes("협의") && val.includes("내용")) colContent = c;
                }
            }

            // 헤더를 못 찾은 경우 기본값 백업 (B, C열 또는 D, E열)
            if (colDate === -1) {
                // 데이터 행(5행) 확인하여 숫자가 있으면 B열로 간주
                colDate = (data[5] && data[5][1] && data[5][1].toString().match(/\d/)) ? 1 : 3;
            }
            if (colContent === -1) {
                colContent = (colDate === 1) ? 2 : 4;
            }

            let lastDept = "";
            for (let r = 5; r < data.length; r++) {
                let dept = data[r][colDept]?.toString().trim() || "";
                if (dept) lastDept = dept;

                const dateRaw = data[r][colDate]?.toString().trim() || "";
                const content = data[r][colContent]?.toString().trim() || "";

                if (dateRaw && content && !isGarbageContent(content) && content !== "없음") {
                    const mMatch = dateRaw.match(/(\d+)\.(\d+)/);
                    if (mMatch) {
                        const m = parseInt(mMatch[1]), d = parseInt(mMatch[2]);
                        const year = (m < 3 ? CONFIG.YEAR + 1 : CONFIG.YEAR);
                        events.push({
                            date: formatDate(year, m, d),
                            title: content,
                            dept: lastDept,
                            type: 'planning',
                            typeName: '기획'
                        });
                    }
                }
            }
        });
    }
    return events;
}

// 캘린더 동기화 보조 함수들 삭제 (Supabase 전용으로 변경)
