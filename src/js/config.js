// GlobalHub 멀티테넌트: GAS/SCRIPT_URL 경로는 폐기됨. 백엔드는 /api 게이트웨이 단일.
export const API_CONFIG = {
    // 레거시 AES 토큰 복호화용 (신규 세션은 게이트웨이 서명 토큰 사용)
    SECRET_KEY: 'oneclass25-secret-auth-key',

    // [M2] 학년도는 학교(테넌트) 설정에서 옴. window.SCHOOL 로드 전에는 폴백값.
    get CURRENT_ACADEMIC_YEAR() {
        try {
            return (typeof window !== 'undefined' && window.SCHOOL?.school?.academic_year)
                || Number(import.meta.env?.VITE_FALLBACK_ACADEMIC_YEAR)
                || new Date().getFullYear();
        } catch {
            return new Date().getFullYear();
        }
    },
};
