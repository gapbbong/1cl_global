/**
 * 구글 드라이브 URL에서 파일 ID를 추출합니다.
 * @param {string} url - 구글 드라이브 URL
 * @returns {string|null} 파일 ID 또는 null
 */
export function extractDriveId(url) {
    if (!url) return null;
    const match = url.match(/(?:\/d\/|id=)([\w-]{25,})/);
    return match ? match[1] : null;
}

/**
 * 썸네일 이미지 URL을 생성합니다.
 * @param {string} fileId - 파일 ID
 * @returns {string} 썸네일 URL
 */
export function getThumbnailUrl(fileId) {
    // lh3.googleusercontent.com 은 구글 드라이브 썸네일의 고성능 CDN 도메인입니다.
    // =s220 은 가로 220px 크기를 의미합니다.
    return fileId
        ? `https://lh3.googleusercontent.com/d/${fileId}=s220`
        : "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
}

/**
 * 날짜를 포맷팅합니다.
 * @param {string} isoStr - ISO 날짜 문자열
 * @returns {string} 포맷팅된 날짜 문자열
 */
export function formatDate(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return isNaN(d)
        ? isoStr
        : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 학교 시간표에 따른 교시를 반환합니다.
 * @param {Date} date - 대상 날짜 객체
 * @returns {string} 교시 정보
 */
export function getPeriod(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // 시간표 정의 (분 단위)
    const schedule = [
        { name: '1교시', start: 9 * 60, end: 9 * 60 + 50 },
        { name: '2교시', start: 10 * 60, end: 10 * 60 + 50 },
        { name: '3교시', start: 11 * 60, end: 11 * 60 + 50 },
        { name: '4교시', start: 12 * 60, end: 12 * 60 + 50 },
        { name: '점심시간', start: 12 * 60 + 50, end: 13 * 60 + 40 },
        { name: '5교시', start: 13 * 60 + 40, end: 14 * 60 + 30 },
        { name: '6교시', start: 14 * 60 + 40, end: 15 * 60 + 30 },
        { name: '7교시', start: 15 * 60 + 40, end: 16 * 60 + 30 }
    ];

    for (let i = 0; i < schedule.length; i++) {
        const item = schedule[i];
        // 해당 교시 시간 내 (시작 5분 전부터 해당 교시로 반올림)
        if (totalMinutes >= item.start - 5 && totalMinutes < item.end) {
            return item.name;
        }

        // 쉬는 시간 및 반올림 처리
        if (i < schedule.length - 1) {
            const nextItem = schedule[i + 1];
            if (totalMinutes >= item.end && totalMinutes < nextItem.start - 5) {
                // 이전 교시 종료 후 다음 교시 반올림 전까지는 이전 교시로 처리하거나 "쉬는시간"
                return `${item.name} 쉬는시간`;
            }
        }
    }

    if (totalMinutes < 9 * 60 - 5) return "일과 전";
    if (totalMinutes >= 16 * 60 + 30) return "방과 후";

    return "";
}

/**
 * 상대 시간 문자열을 반환합니다. (방금, N분 전, 오늘, 어제, N일 전)
 * @param {Date} date - 대상 날짜 객체
 * @returns {string} 상대 시간 문자열
 */
export function getRelativeDateString(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    // 날짜 차이 계산 (시간 상관 없이 날짜만 비교)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - targetDate) / (1000 * 60 * 60 * 24));

    if (diffMin < 1) return "방금 전";
    if (diffMin < 60) return `${diffMin}분 전`;

    if (diffDays === 0) return "오늘";
    if (diffDays === 1) return "어제";
    if (diffDays === 2) return "그저께";

    // 무조건 'N일 전'으로 표시 (사용자 요청 반영: 상대시간으로 표시되게)
    return `${diffDays}일 전`;
}

/**
 * 상대 시간과 교시를 조합하여 포맷팅합니다.
 * @param {string} isoStr - ISO 날짜 문자열
 * @returns {string} 포맷팅된 문자열
 */
export function formatRelativeWithPeriod(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d)) return isoStr;

    const relative = getRelativeDateString(d);
    const period = getPeriod(d);

    // 모든 시각에 대해 교시 정보(일과 전/방과 후 포함)를 한글로 표시
    if (period) {
        return `${relative} ${period}`;
    }

    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${relative} ${h}:${m}`;
}

/**
 * 배경색이 밝은지 확인합니다.
 * @param {string} hex - HEX 색상 코드
 * @returns {boolean} 밝으면 true
 */
export function isLightColor(hex) {
    const c = hex.substring(1);
    const rgb = parseInt(c, 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160;
}
