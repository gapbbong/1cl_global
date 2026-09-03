/**
 * School (tenant) configuration loader.
 *
 * One call to the gateway `/api/config` returns the whole settings bundle for
 * the logged-in teacher's school. Every page that renders school structure,
 * menus, labels or permissions should read from `window.SCHOOL` instead of
 * hard-coding "3 grades × 6 classes" / "경성전자고" / role names.
 */
import { getSessionToken, ensureSession } from './supabase.js';

const GATEWAY = `${location.origin}/api`;
let _cache = null;
let _inflight = null;

export async function loadSchool({ force = false } = {}) {
  if (_cache && !force) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const token = getSessionToken() || (await ensureSession());
    const r = await fetch(`${GATEWAY}/config`, { headers: { 'x-teacher-token': token }, cache: 'no-store' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `config_http_${r.status}`);
    }
    _cache = await r.json();
    window.SCHOOL = _cache;
    return _cache;
  })().finally(() => { _inflight = null; });
  return _inflight;
}

export function school() { return _cache?.school || null; }
export function units()  { return _cache?.units || []; }
export function me()     { return _cache?.me || null; }
export function surveyFields() { return _cache?.survey?.fields || []; }
export function recordTypes()  { return _cache?.record_types || []; }
/** 설문 필드 id → 한글 라벨 (기초조사 표시용). 없으면 id 그대로. */
export function surveyLabel(id, lang = 'ko') {
  const f = surveyFields().find((x) => x.id === id);
  return (f && f.label && (f.label[lang] || f.label.ko)) || id;
}

/** Distinct levels in order: [{ order, label, units: [...] }] */
export function levels() {
  const map = new Map();
  for (const u of units()) {
    if (!u.active) continue;
    if (!map.has(u.level_order)) map.set(u.level_order, { order: u.level_order, label: u.level_label, units: [] });
    map.get(u.level_order).units.push(u);
  }
  return [...map.values()].sort((a, b) => a.order - b.order)
    .map((l) => ({ ...l, units: l.units.sort((a, b) => a.class_order - b.class_order) }));
}

/** Canonical class_info string, e.g. "1-1" / "1-A". Keep parsing in one place. */
export function unitKey(u) { return `${u.level_order}-${u.class_order}`; }
export function unitLabel(u) { return `${u.level_label} ${u.class_label}`; }

/** class_info("g-c") → 학과명 (school_units.major). 없으면 "미지정". */
export function majorOf(classInfo) {
  const m = String(classInfo || '').match(/(\d+)-(\d+)/);
  if (!m) return '미지정';
  const u = units().find((x) => x.level_order === +m[1] && x.class_order === +m[2]);
  return u?.major || '미지정';
}
export function majors() { return [...new Set(units().map((u) => u.major).filter(Boolean))]; }

/** All active units as [{ value:"1-1", label:"1학년 1반", grade, class }] — for <select> building. */
export function classOptions() {
  return units().filter((u) => u.active).map((u) => ({
    value: unitKey(u), label: unitLabel(u),
    grade: u.level_order, class: u.class_order,
  }));
}
/** Fill a <select> element with class options. */
export function fillClassSelect(sel, { placeholder } = {}) {
  if (!sel) return;
  sel.innerHTML = (placeholder ? `<option value="">${placeholder}</option>` : '')
    + classOptions().map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
}

/** Permission helper. perm('records','write') → "all" | "own_class" | "none" | undefined */
export function perm(area, action) {
  const p = me()?.permissions || {};
  const node = p[area];
  if (node == null) return undefined;
  return typeof node === 'object' ? node[action] : node;
}
export function isAdmin() {
  const m = me();
  if (!m) return false;
  if (m.role_key === 'admin') return true;
  return !!(m.permissions?.admin) && Object.values(m.permissions.admin).some(Boolean);
}
export function feature(key) { return (school()?.features || []).includes(key); }

// ── 공통 권한/식별 헬퍼 (하드코딩된 이메일 목록 대체) ────────────────
/** 현재 로그인 교사 이메일 */
export function myEmail() { return (me()?.email || '').toLowerCase(); }
export function myRoleKey() { return me()?.role_key || ''; }
/** 지킴이(구 keeper@kse.hs.kr) 여부 */
export function isGatekeeper() { return myRoleKey() === 'gatekeeper' || (me()?.extra_roles || []).includes('gatekeeper'); }
/** 관리자 또는 상담교사 등 전교 열람 권한자 */
export function isPrivileged() { return isAdmin() || perm('records', 'read') === 'all' || ['admin', 'counselor'].includes(myRoleKey()); }
/**
 * 특정 학급(classInfo 문자열 "g-c" 또는 {grade,class})을 관리할 수 있는가.
 * 관리자거나, 내가 그 반 담임/부담임이면 true.
 */
export function canManageClass(classInfo, infoList) {
  if (isAdmin() || perm('records', 'write') === 'all') return true;
  const key = typeof classInfo === 'string' ? classInfo
    : classInfo ? `${classInfo.grade}-${classInfo.class}` : '';
  const list = infoList || _cache?.classInfo || [];
  const row = list.find((c) => c.key === key || `${c.grade}-${c.class}` === key);
  if (!row) return false;
  const em = myEmail();
  return row.homeroomEmail === em || row.subEmail === em;
}
/** 학번 자릿수 (기본 4) */
export function studentIdLength() { return Number(school()?.student_id_rule?.length) || 4; }
/**
 * 학번 문자열 → { grade, class, num }.
 * compose 'grade_class_no' (기본): 첫 자리=학년, 둘째 자리=반, 나머지=번호.
 * compose 'free': 파싱 불가 → null 값.
 */
export function studentIdParts(id) {
  const s = String(id || '').trim();
  const compose = school()?.student_id_rule?.compose || 'grade_class_no';
  if (compose === 'free' || !/^\d{3,}$/.test(s)) return { grade: null, class: null, num: null };
  return { grade: parseInt(s[0], 10), class: parseInt(s[1], 10), num: parseInt(s.slice(2), 10) };
}
export function studentIdPattern() {
  const rule = school()?.student_id_rule || {};
  if (rule.regex) {
    try { return new RegExp(rule.regex); } catch { console.warn('invalid student_id_rule.regex'); }
  }
  return new RegExp(`^\\d{${studentIdLength()}}$`);
}

/** Apply school name / title / theme colour to the current page. Call after loadSchool(). */
export function applySchoolBranding() {
  const s = school();
  if (!s) return;
  const label = s.short_name || s.name;
  if (label) {
    document.title = document.title.includes('·')
      ? document.title.replace(/^[^·]+·/, `${label} ·`)
      : `${label} 학급 목록`;
    document.querySelectorAll('.school-name, [data-school-name]').forEach((el) => { el.textContent = label; });
  }
  const primary = s.theme?.primary;
  if (primary) {
    document.documentElement.style.setProperty('--school-primary', primary);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', primary);
  }
  if (s.locale && s.locale !== 'ko') document.documentElement.lang = s.locale;
  if (s.support_contact) {
    document.querySelectorAll('[data-support-contact]').forEach((el) => {
      el.textContent = `문의: ${s.support_contact}`;
    });
  }
}

/** Current academic year — school config wins, arg is a fallback for legacy callers. */
export function academicYear(fallback) { return school()?.academic_year || fallback || new Date().getFullYear(); }
