/**
 * GlobalHub — 학교 관리자 콘솔
 * 학교 설정 / 학년·반 구조 / 교사 / 역할·권한을 코드 수정 없이 관리.
 *
 * 모든 쓰기는 게이트웨이를 통과하며, 게이트웨이가
 *   (1) 세션의 school_id 를 강제 주입/필터 (테넌트 격리)
 *   (2) 이 테이블들은 role_key === 'admin' 만 쓰기 허용
 * 을 강제한다. 즉 이 화면의 버튼을 조작해도 남의 학교/권한은 못 건드린다.
 */
import { supabase, verifySession, getSessionToken } from './supabase.js';
import { loadSchool } from './school.js';

const API = `${location.origin}/api`;
const apiGet = (path) => fetch(`${API}${path}`, { headers: { 'x-teacher-token': getSessionToken() } }).then((r) => r.json());
const apiPost = (path, body) => fetch(`${API}${path}`, {
  method: 'POST', headers: { 'x-teacher-token': getSessionToken(), 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
}).then((r) => r.json());

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EDUCATION_TYPES = [
  ['elem', '초등학교'], ['middle', '중학교'], ['high', '고등학교'],
  ['college2', '전문대(2·3년제)'], ['college4', '대학교(4년제)'], ['kinder', '유치원·어린이집'],
];
const FEATURES = [
  ['search', '학생 검색'], ['bulk-record', '일괄 기록'], ['check-survey', '기초조사 확인'],
  ['print-report', '통계/출력'], ['analysis', '학생 분석'], ['map-3d', '실 위치'],
  ['quiz', '인물 퀴즈'], ['calendar', '캘린더'], ['notifications', '실시간 알림'],
  ['teacher-profile', '교사 프로필'],
];

let CFG = null;      // { school, units, roles, me }
let TAB = 'school';

// 비차단 확인 대화 (native confirm() 은 자동화/렌더러를 멈추므로 사용 안 함)
function confirmDialog(message) {
  return new Promise((resolve) => {
    const ov = el(`<div style="position:fixed;inset:0;background:#17203355;display:flex;align-items:center;justify-content:center;z-index:100">
      <div style="background:#fff;border-radius:14px;padding:22px;max-width:360px;width:90%;box-shadow:0 20px 50px #17203340">
        <p style="margin:0 0 18px;line-height:1.6">${esc(message)}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn ghost" data-x>취소</button><button class="btn danger" data-ok>삭제</button>
        </div>
      </div></div>`);
    ov.querySelector('[data-x]').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('[data-ok]').onclick = () => { ov.remove(); resolve(true); };
    document.body.appendChild(ov);
  });
}

function toast(msg, err = false) {
  let t = $('.toast');
  if (!t) { t = el('<div class="toast"></div>'); document.body.appendChild(t); }
  t.textContent = msg;
  t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
}

async function boot() {
  const session = await verifySession();
  if (!session || (!session.email && !session.offline)) {
    location.href = `index.html${location.search}`;
    return;
  }
  try {
    CFG = await loadSchool({ force: true });
  } catch (e) {
    $('#ac-app').innerHTML = `<div class="ac-loading">설정을 불러오지 못했습니다: ${esc(e.message)}<br><br>
      <small>이 학교(테넌트)가 아직 생성되지 않았을 수 있습니다. Supabase에서
      <code>select bootstrap_school(...)</code> 로 학교를 먼저 만들어 주세요.</small></div>`;
    return;
  }
  if (!CFG.school) {
    $('#ac-app').innerHTML = `<div class="ac-loading">학교 정보가 없습니다. 관리자에게 문의하세요.</div>`;
    return;
  }
  if ((CFG.me?.role_key) !== 'admin') {
    $('#ac-app').innerHTML = `<div class="ac-loading">관리자만 접근할 수 있는 화면입니다.<br>
      <a href="index.html${location.search}">돌아가기</a></div>`;
    return;
  }
  renderShell();
}

function renderShell() {
  const app = $('#ac-app');
  app.className = '';
  app.innerHTML = `
    <div class="ac-shell">
      <aside class="ac-side">
        <div class="ac-logo">Global<span>Hub</span></div>
        <div class="ac-school">${esc(CFG.school.name)}<br>${esc(CFG.school.domain_name)}.creat1324.com</div>
        <nav class="ac-nav">
          <button data-tab="school">학교 설정</button>
          <button data-tab="units">학년·반 구조</button>
          <button data-tab="teachers">교사</button>
          <button data-tab="roles">역할·권한</button>
          <button data-tab="survey">설문 문항</button>
          <button data-tab="records">생활기록 항목</button>
          <button data-tab="students">학생 명단</button>
          <button data-tab="privacy">개인정보</button>
          <button data-tab="_back" style="margin-top:20px;color:#647086">← 앱으로</button>
        </nav>
      </aside>
      <main class="ac-main" id="ac-main"></main>
    </div>`;
  app.querySelectorAll('.ac-nav button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.tab === '_back') { location.href = `index.html${location.search}`; return; }
      TAB = b.dataset.tab; renderTab();
    };
  });
  renderTab();
}

function renderTab() {
  document.querySelectorAll('.ac-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === TAB));
  ({ school: tabSchool, units: tabUnits, teachers: tabTeachers, roles: tabRoles, survey: tabSurvey, records: tabRecords, students: tabStudents, privacy: tabPrivacy }[TAB] || tabSchool)();
}

// ============================================================ 학교 설정
function tabSchool() {
  const s = CFG.school;
  const rule = s.student_id_rule || {};
  const main = $('#ac-main');
  main.innerHTML = `
    <h1>학교 설정</h1>
    <p class="sub">학교명·학교급·학년도·학번 규칙·기능 노출을 설정합니다.</p>
    <div class="card">
      <h2>기본 정보</h2>
      <div class="grid2">
        <div class="field"><label>학교명</label><input id="f-name" value="${esc(s.name)}"></div>
        <div class="field"><label>약칭 (헤더 표시)</label><input id="f-short" value="${esc(s.short_name || '')}"></div>
        <div class="field"><label>학교급</label><select id="f-edu">${EDUCATION_TYPES.map(([v, l]) => `<option value="${v}" ${s.education_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>학년도</label><input id="f-year" type="number" value="${esc(s.academic_year)}"></div>
        <div class="field"><label>기본 언어</label><input id="f-locale" value="${esc(s.locale || 'ko')}"></div>
        <div class="field"><label>지원 문의 (안내문 표시)</label><input id="f-support" value="${esc(s.support_contact || '')}"></div>
      </div>
    </div>
    <div class="card">
      <h2>학번 규칙</h2>
      <div class="grid3">
        <div class="field"><label>자릿수</label><input id="f-idlen" type="number" min="1" max="20" value="${esc(rule.length || 4)}"></div>
        <div class="field"><label>구성 방식</label><select id="f-idcompose">
          <option value="grade_class_no" ${rule.compose !== 'free' ? 'selected' : ''}>학년+반+번호</option>
          <option value="free" ${rule.compose === 'free' ? 'selected' : ''}>자유 형식</option>
        </select></div>
        <div class="field"><label>검증 정규식 (선택)</label><input id="f-idregex" value="${esc(rule.regex || '')}" placeholder="^\\d{4}$"></div>
      </div>
    </div>
    <div class="card">
      <h2>화면 테마</h2>
      <div class="grid2">
        <div class="field"><label>주 색상</label><input id="f-primary" type="color" value="${esc((s.theme || {}).primary || '#365cf5')}"></div>
        <div class="field"><label>로고 이미지 URL (선택)</label><input id="f-logo" value="${esc((s.theme || {}).logoUrl || '')}"></div>
      </div>
    </div>
    <div class="card">
      <h2>기능 노출</h2>
      <div class="checks">
        ${FEATURES.map(([k, l]) => `<label><input type="checkbox" data-feat="${k}" ${(s.features || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}
      </div>
    </div>
    <div class="dirty-bar">
      <span class="note">변경 후 저장을 눌러야 반영됩니다.</span>
      <button class="btn primary" id="save-school">학교 설정 저장</button>
    </div>`;

  $('#save-school').onclick = async (ev) => {
    ev.target.disabled = true;
    const payload = {
      name: $('#f-name').value.trim(),
      short_name: $('#f-short').value.trim() || null,
      education_type: $('#f-edu').value,
      academic_year: Number($('#f-year').value) || s.academic_year,
      locale: $('#f-locale').value.trim() || 'ko',
      support_contact: $('#f-support').value.trim() || null,
      student_id_rule: {
        length: Number($('#f-idlen').value) || 4,
        compose: $('#f-idcompose').value,
        regex: $('#f-idregex').value.trim() || null,
      },
      theme: { ...(s.theme || {}), primary: $('#f-primary').value, logoUrl: $('#f-logo').value.trim() || null },
      features: [...main.querySelectorAll('[data-feat]:checked')].map((c) => c.dataset.feat),
    };
    const { error } = await supabase.from('schools').update(payload).eq('id', s.id);
    ev.target.disabled = false;
    if (error) return toast(`저장 실패: ${error.message}`, true);
    Object.assign(CFG.school, payload);
    toast('저장되었습니다.');
  };
}

// ============================================================ 학년·반 구조
function groupLevels(units) {
  const m = new Map();
  units.forEach((u) => {
    if (!m.has(u.level_order)) m.set(u.level_order, []);
    m.get(u.level_order).push(u);
  });
  return [...m.entries()].sort((a, b) => a[0] - b[0])
    .map(([order, us]) => ({ order, label: us[0].level_label, units: us.sort((a, b) => a.class_order - b.class_order) }));
}

async function reloadUnits() {
  const { data, error } = await supabase.from('school_units').select('*').order('level_order').order('class_order');
  if (error) return toast(`목록 로드 실패: ${error.message}`, true);
  CFG.units = data || [];
  tabUnits();
}

function tabUnits() {
  const levels = groupLevels(CFG.units);
  const nextLevel = (levels.at(-1)?.order || 0) + 1;
  $('#ac-main').innerHTML = `
    <h1>학년·반 구조</h1>
    <p class="sub">학년(레벨)과 반을 추가·삭제·이름 변경합니다. 초·중·고·대 모두 자유롭게 표현하세요. (대학: 레벨=학년, 반=분반)</p>
    <div class="card">
      ${levels.map((lv) => `
        <div class="lvl" data-lvl="${lv.order}">
          <div class="lvl-head">
            <input class="lvl-label" value="${esc(lv.label)}" data-order="${lv.order}">
            <span class="tag gray">${lv.units.length}개 반</span>
            <span class="grow"></span>
            <button class="btn ghost sm add-class" data-order="${lv.order}">+ 반</button>
            <button class="btn danger sm del-level" data-order="${lv.order}">학년 삭제</button>
          </div>
          <div>
            ${lv.units.map((u) => `
              <span class="chip">
                <input value="${esc(u.class_label)}" data-id="${u.id}" data-fld="class_label">
                <input value="${esc(u.major || '')}" placeholder="학과(선택)" data-id="${u.id}" data-fld="major" style="width:96px">
                <button class="x" data-del="${u.id}" title="반 삭제">✕</button>
              </span>`).join('')}
          </div>
        </div>`).join('') || '<p class="sub">아직 학년이 없습니다.</p>'}
      <button class="btn ghost" id="add-level">+ ${nextLevel}학년(레벨) 추가</button>
    </div>
    <div class="dirty-bar">
      <span class="note">이름/학과 변경은 저장을 눌러야 반영됩니다. 추가·삭제는 즉시 적용됩니다.</span>
      <button class="btn primary" id="save-units">이름 변경 저장</button>
    </div>`;

  const main = $('#ac-main');

  main.querySelectorAll('.add-class').forEach((b) => b.onclick = async () => {
    const order = Number(b.dataset.order);
    const us = CFG.units.filter((u) => u.level_order === order);
    const cls = (us.at(-1)?.class_order || 0) + 1;
    const lvLabel = us[0]?.level_label || `${order}학년`;
    const { error } = await supabase.from('school_units').insert({
      level_label: lvLabel, level_order: order, class_label: `${cls}반`, class_order: cls,
    });
    if (error) return toast(error.message, true);
    reloadUnits();
  });

  main.querySelectorAll('.del-level').forEach((b) => b.onclick = async () => {
    const order = Number(b.dataset.order);
    if (!(await confirmDialog(`${order}학년(레벨)과 그 반들을 모두 삭제할까요? 이미 학생이 배정된 반이면 되돌리기 어렵습니다.`))) return;
    const { error } = await supabase.from('school_units').delete().eq('level_order', order);
    if (error) return toast(error.message, true);
    reloadUnits();
  });

  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog('이 반을 삭제할까요?'))) return;
    const { error } = await supabase.from('school_units').delete().eq('id', b.dataset.del);
    if (error) return toast(error.message, true);
    reloadUnits();
  });

  $('#add-level').onclick = async () => {
    const { error } = await supabase.from('school_units').insert({
      level_label: `${nextLevel}학년`, level_order: nextLevel, class_label: '1반', class_order: 1,
    });
    if (error) return toast(error.message, true);
    reloadUnits();
  };

  $('#save-units').onclick = async (ev) => {
    ev.target.disabled = true;
    const ops = [];
    main.querySelectorAll('.lvl-label').forEach((inp) => {
      const order = Number(inp.dataset.order);
      const label = inp.value.trim();
      if (label && CFG.units.some((u) => u.level_order === order && u.level_label !== label)) {
        ops.push(supabase.from('school_units').update({ level_label: label }).eq('level_order', order));
      }
    });
    main.querySelectorAll('.chip input[data-id]').forEach((inp) => {
      const u = CFG.units.find((x) => x.id === inp.dataset.id);
      if (!u) return;
      const fld = inp.dataset.fld;
      const val = inp.value.trim() || (fld === 'major' ? null : u[fld]);
      if (u[fld] !== val) ops.push(supabase.from('school_units').update({ [fld]: val }).eq('id', u.id));
    });
    if (!ops.length) { ev.target.disabled = false; return toast('변경사항이 없습니다.'); }
    const res = await Promise.all(ops);
    ev.target.disabled = false;
    const err = res.find((r) => r.error);
    if (err) return toast(`일부 저장 실패: ${err.error.message}`, true);
    reloadUnits();
    toast('저장되었습니다.');
  };
}

// ============================================================ 교사
async function reloadTeachers() {
  const { data, error } = await supabase.from('teachers').select('*').order('name');
  if (error) return toast(`교사 목록 로드 실패: ${error.message}`, true);
  CFG._teachers = data || [];
  tabTeachers();
}

function tabTeachers() {
  if (!CFG._teachers) { reloadTeachers(); $('#ac-main').innerHTML = '<div class="ac-loading">불러오는 중…</div>'; return; }
  const roleOpts = CFG.roles.map((r) => `<option value="${r.key}">${esc(r.label)}</option>`).join('');
  const unitOpts = ['<option value="">담임 없음</option>'].concat(
    groupLevels(CFG.units).flatMap((lv) => lv.units.map((u) => `<option value="${u.id}">${esc(lv.label)} ${esc(u.class_label)}</option>`)),
  ).join('');

  $('#ac-main').innerHTML = `
    <h1>교사</h1>
    <p class="sub">여기에 등록된 이메일만 로그인할 수 있습니다. (인증 화이트리스트)</p>
    <div class="card">
      <h2>교사 추가</h2>
      <div class="grid3">
        <div class="field"><label>이메일</label><input id="t-email" placeholder="teacher@school.com"></div>
        <div class="field"><label>이름</label><input id="t-name"></div>
        <div class="field"><label>역할</label><select id="t-role">${roleOpts}</select></div>
        <div class="field"><label>담임 반</label><select id="t-unit">${unitOpts}</select></div>
        <div class="field"><label>연락처(선택)</label><input id="t-phone"></div>
      </div>
      <button class="btn primary" id="t-add">추가</button>
      <div style="border-top:1px solid #edf0f5;margin-top:14px;padding-top:12px">
        <p class="sub" style="margin:0 0 8px">여러 명 한 번에: CSV/엑셀 (헤더 <b>이메일, 이름</b> · 선택 <b>역할, 담임반, 연락처</b>). 역할은 key(admin/homeroom/…) 또는 라벨.</p>
        <input type="file" id="t-file" accept=".csv,.xlsx,.xls">
        <div id="t-import"></div>
      </div>
    </div>
    <div class="card">
      <h2>교사 목록 <span class="tag gray">${CFG._teachers.length}명</span></h2>
      ${CFG._teachers.map((t) => `
        <div class="row" data-id="${t.id}">
          <div class="grow">
            <b>${esc(t.name)}</b> <span class="${t.active ? 'tag' : 'tag gray'}">${t.active ? '활성' : '비활성'}</span><br>
            <small style="color:#718096">${esc(t.email)}</small>
          </div>
          <select class="t-role-sel">${CFG.roles.map((r) => `<option value="${r.key}" ${t.role_key === r.key ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
          <select class="t-unit-sel">${['<option value="">담임없음</option>'].concat(groupLevels(CFG.units).flatMap((lv) => lv.units.map((u) => `<option value="${u.id}" ${t.homeroom_unit === u.id ? 'selected' : ''}>${esc(lv.label)} ${esc(u.class_label)}</option>`))).join('')}</select>
          <button class="btn ghost sm t-toggle">${t.active ? '비활성' : '활성'}</button>
          <button class="btn danger sm t-del">삭제</button>
        </div>`).join('')}
    </div>`;

  $('#t-add').onclick = async (ev) => {
    const email = $('#t-email').value.trim().toLowerCase();
    const name = $('#t-name').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) return toast('이메일과 이름을 확인해 주세요.', true);
    ev.target.disabled = true;
    const { error } = await supabase.from('teachers').insert({
      email, name, role_key: $('#t-role').value,
      homeroom_unit: $('#t-unit').value || null,
      phone: $('#t-phone').value.trim() || null, active: true,
    });
    ev.target.disabled = false;
    if (error) return toast(error.message.includes('duplicate') ? '이미 등록된 이메일입니다.' : error.message, true);
    reloadTeachers();
    toast('추가되었습니다.');
  };

  // CSV/xlsx 교사 일괄 등록
  $('#t-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
      const H = (rows[0] || []).map((h) => String(h || '').trim());
      const col = (names) => H.findIndex((h) => names.some((n) => h.replace(/\s/g, '').includes(n)));
      const cE = col(['이메일', 'email']), cN = col(['이름', '성명', 'name']),
        cR = col(['역할', 'role']), cU = col(['담임', '반', 'class']), cP = col(['연락처', '전화', 'phone']);
      if (cE < 0 || cN < 0) return toast('이메일·이름 열이 필요합니다.', true);
      const roleByLabel = {}; CFG.roles.forEach((r) => { roleByLabel[r.label] = r.key; roleByLabel[r.key] = r.key; });
      const unitByKey = {}; CFG.units.forEach((u) => { unitByKey[`${u.level_order}-${u.class_order}`] = u.id; });
      const payload = [];
      for (const r of rows.slice(1)) {
        const email = String(r[cE] ?? '').trim().toLowerCase();
        const name = String(r[cN] ?? '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) continue;
        const row = { email, name, active: true, role_key: (cR >= 0 && roleByLabel[String(r[cR]).trim()]) || 'subject' };
        if (cU >= 0 && unitByKey[String(r[cU]).trim()]) row.homeroom_unit = unitByKey[String(r[cU]).trim()];
        if (cP >= 0 && r[cP] != null && String(r[cP]).trim()) row.phone = String(r[cP]).trim();
        payload.push(row);
      }
      const box = $('#t-import');
      if (!payload.length) { box.innerHTML = '<p class="err">유효한 행이 없습니다.</p>'; return; }
      box.innerHTML = `<p class="sub" style="margin-top:8px">${payload.length}명 감지. <button class="btn primary sm" id="t-do">등록</button></p>`;
      $('#t-do').onclick = async (ev) => {
        ev.target.disabled = true;
        const { error } = await supabase.from('teachers').upsert(payload, { onConflict: 'school_id,email', ignoreDuplicates: false });
        ev.target.disabled = false;
        if (error) return toast(error.message, true);
        toast(`${payload.length}명 반영되었습니다.`);
        reloadTeachers();
      };
    } catch (err) { toast('파일 오류: ' + err.message, true); }
  };

  $('#ac-main').querySelectorAll('.row[data-id]').forEach((row) => {
    const id = row.dataset.id;
    const t = CFG._teachers.find((x) => x.id === id);
    const patch = async (p, okMsg) => {
      const { error } = await supabase.from('teachers').update(p).eq('id', id);
      if (error) return toast(error.message, true);
      Object.assign(t, p); if (okMsg) toast(okMsg);
    };
    row.querySelector('.t-role-sel').onchange = (e) => patch({ role_key: e.target.value }, '역할 변경됨');
    row.querySelector('.t-unit-sel').onchange = (e) => patch({ homeroom_unit: e.target.value || null }, '담임 반 변경됨');
    row.querySelector('.t-toggle').onclick = () => patch({ active: !t.active }).then(reloadTeachers);
    row.querySelector('.t-del').onclick = async () => {
      if (!(await confirmDialog(`${t.name} 교사를 삭제할까요? (로그인 불가 처리)`))) return;
      const { error } = await supabase.from('teachers').delete().eq('id', id);
      if (error) return toast(error.message, true);
      reloadTeachers();
    };
  });
}

// ============================================================ 역할·권한
const SCOPE_OPTS = [['all', '전체 학생'], ['own_class', '담임 반만'], ['none', '없음']];
const RW_OPTS = [['all', '전체'], ['own_class', '담임 반만'], ['none', '없음']];

function permEditor(r) {
  const p = r.permissions || {};
  const stu = p.students || {};
  const sel = (id, opts, val) => `<select data-perm="${id}">${opts.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const chk = (id, on) => `<label><input type="checkbox" data-perm="${id}" ${on ? 'checked' : ''}>`;
  return `
    <div class="perm-grid">
      <span class="k">학생 접근 범위</span>${sel('scope', SCOPE_OPTS, p.scope || 'none')}
      <span class="k">학생 정보 읽기</span>
      <span class="checks">
        ${chk('students.read.basic', (stu.read || []).includes('basic'))} 기본</label>
        ${chk('students.read.contact', (stu.read || []).includes('contact'))} 연락처</label>
        ${chk('students.read.sensitive', (stu.read || []).includes('sensitive'))} 민감(보호자·건강 등)</label>
      </span>
      <span class="k">학생 정보 수정</span>
      <span class="checks">${chk('students.write.contact', (stu.write || []).includes('contact'))} 연락처 수정</label></span>
      <span class="k">기초조사 읽기</span>${sel('survey.read', RW_OPTS, (p.survey || {}).read || 'none')}
      <span class="k">생활기록 읽기</span>${sel('records.read', RW_OPTS, (p.records || {}).read || 'none')}
      <span class="k">생활기록 작성</span>${sel('records.write', RW_OPTS, (p.records || {}).write || 'none')}
      <span class="k">관리자 권한</span>
      <span class="checks">
        ${chk('admin.school', (p.admin || {}).school)} 학교설정</label>
        ${chk('admin.units', (p.admin || {}).units)} 학년·반</label>
        ${chk('admin.teachers', (p.admin || {}).teachers)} 교사</label>
        ${chk('admin.roles', (p.admin || {}).roles)} 역할</label>
        ${chk('admin.survey_schema', (p.admin || {}).survey_schema)} 설문문항</label>
      </span>
    </div>`;
}

function collectPerm(root, base) {
  const p = JSON.parse(JSON.stringify(base || {}));
  p.students = p.students || {}; p.survey = p.survey || {}; p.records = p.records || {}; p.admin = p.admin || {};
  const setArr = (obj, key, val, on) => {
    obj[key] = obj[key] || [];
    obj[key] = obj[key].filter((x) => x !== val);
    if (on) obj[key].push(val);
  };
  root.querySelectorAll('[data-perm]').forEach((n) => {
    const path = n.dataset.perm;
    if (n.tagName === 'SELECT') {
      if (path === 'scope') p.scope = n.value;
      else { const [a, b] = path.split('.'); p[a][b] = n.value; }
    } else {
      const on = n.checked;
      if (path.startsWith('students.read.')) setArr(p.students, 'read', path.split('.')[2], on);
      else if (path.startsWith('students.write.')) setArr(p.students, 'write', path.split('.')[2], on);
      else if (path.startsWith('admin.')) p.admin[path.split('.')[1]] = on;
    }
  });
  return p;
}

async function reloadRoles() {
  const { data, error } = await supabase.from('roles').select('*').order('sort_order');
  if (error) return toast(`역할 로드 실패: ${error.message}`, true);
  CFG.roles = data || [];
  tabRoles();
}

function tabRoles() {
  $('#ac-main').innerHTML = `
    <h1>역할·권한</h1>
    <p class="sub">역할별로 학생 데이터·기초조사·생활기록 접근 범위를 정합니다. 교사에게는 [교사] 탭에서 역할을 배정합니다.</p>
    ${CFG.roles.map((r) => `
      <div class="card" data-role="${r.id}">
        <div class="row" style="border:0;padding:0 0 8px">
          <input class="r-label" value="${esc(r.label)}" style="font-weight:800;font-size:15px;border:1px solid #eef1f5;border-radius:6px;padding:6px 8px">
          <span class="tag gray">key: ${esc(r.key)}</span>
          <span class="grow"></span>
          <label style="font-weight:400;font-size:12px">첫 화면
            <input class="r-landing" value="${esc(r.landing_page || 'home')}" style="width:120px;border:1px solid #dfe4ec;border-radius:6px;padding:4px 6px">
          </label>
          ${r.is_system ? '<span class="tag">시스템</span>' : '<button class="btn danger sm r-del">삭제</button>'}
        </div>
        ${permEditor(r)}
        <div style="text-align:right;margin-top:10px"><button class="btn primary sm r-save">이 역할 저장</button></div>
      </div>`).join('')}
    <div class="card">
      <h2>역할 추가</h2>
      <div class="grid3">
        <div class="field"><label>key (영문, 고유)</label><input id="nr-key" placeholder="vice_principal"></div>
        <div class="field"><label>이름</label><input id="nr-label" placeholder="교감"></div>
      </div>
      <button class="btn primary" id="nr-add">추가</button>
    </div>`;

  $('#ac-main').querySelectorAll('[data-role]').forEach((card) => {
    const r = CFG.roles.find((x) => x.id === card.dataset.role);
    card.querySelector('.r-save').onclick = async (ev) => {
      ev.target.disabled = true;
      const payload = {
        label: card.querySelector('.r-label').value.trim() || r.label,
        landing_page: card.querySelector('.r-landing').value.trim() || 'home',
        permissions: collectPerm(card, r.permissions),
      };
      const { error } = await supabase.from('roles').update(payload).eq('id', r.id);
      ev.target.disabled = false;
      if (error) return toast(error.message, true);
      Object.assign(r, payload);
      toast('저장되었습니다.');
    };
    const del = card.querySelector('.r-del');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`역할 "${r.label}" 삭제? 이 역할의 교사는 임시로 권한이 없어집니다.`))) return;
      const { error } = await supabase.from('roles').delete().eq('id', r.id);
      if (error) return toast(error.message, true);
      reloadRoles();
    };
  });

  $('#nr-add').onclick = async (ev) => {
    const key = $('#nr-key').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const label = $('#nr-label').value.trim();
    if (!key || !label) return toast('key와 이름을 입력해 주세요.', true);
    ev.target.disabled = true;
    const { error } = await supabase.from('roles').insert({
      key, label, sort_order: (CFG.roles.at(-1)?.sort_order || 100) + 10,
      permissions: { scope: 'none', students: { read: ['basic'] }, survey: { read: 'none' }, records: { read: 'none', write: 'none' }, admin: {} },
    });
    ev.target.disabled = false;
    if (error) return toast(error.message.includes('duplicate') ? '이미 있는 key입니다.' : error.message, true);
    reloadRoles();
    toast('역할이 추가되었습니다.');
  };
}

// ============================================================ 설문 문항
const FIELD_TYPES = [
  ['short', '단답'], ['long', '서술'], ['select', '객관식'], ['tel', '연락처'],
  ['date', '날짜'], ['number', '숫자'], ['photo', '사진'], ['rating', '별점'],
];
const FORM_HOST = /\.creat1324\.com$/.test(location.hostname) ? 'q.creat1324.com/f' : `${location.host}/survey-form.html?token=`;

async function reloadSurvey() {
  const [schemaRes, tokRes] = await Promise.all([
    supabase.from('survey_schema').select('*').limit(1).maybeSingle(),
    supabase.from('form_tokens').select('*').order('created_at'),
  ]);
  CFG._schema = schemaRes.data || null;
  CFG._tokens = tokRes.data || [];
  CFG._surveyLoaded = true;
  tabSurvey();
}

function formUrl(token) {
  return /\.creat1324\.com$/.test(location.hostname)
    ? `https://q.creat1324.com/f/${token}`
    : `${location.origin}/survey-form.html?token=${token}`;
}

function tabSurvey() {
  if (!CFG._surveyLoaded) {
    $('#ac-main').innerHTML = '<div class="ac-loading">불러오는 중…</div>';
    reloadSurvey();
    return;
  }
  const schema = CFG._schema;
  if (!schema) {
    $('#ac-main').innerHTML = `<h1>설문 문항</h1>
      <div class="card"><p class="sub">이 학교에 설문 스키마가 없습니다.</p>
      <button class="btn primary" id="sv-init">기본 설문 만들기</button></div>`;
    $('#sv-init').onclick = async (e) => {
      e.target.disabled = true;
      const { error } = await supabase.from('survey_schema').insert({ school_id: CFG.school.id, fields: [] });
      if (error) return toast(error.message, true);
      reloadSurvey();
    };
    return;
  }

  const fields = [...(schema.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const langs = (schema.languages || ['ko']).join(', ');

  $('#ac-main').innerHTML = `
    <h1>설문 문항 <span class="tag gray">v${schema.version || 1}</span></h1>
    <p class="sub">학생 기초조사 문항을 넣고/빼고/이동합니다. 저장하면 학생용 폼에 즉시 반영됩니다.</p>

    <div class="card">
      <h2>배포 링크 / QR</h2>
      ${CFG._tokens.map((t) => `
        <div class="row" data-tok="${t.token}">
          <div class="grow">
            <a href="${esc(formUrl(t.token))}" target="_blank" style="color:var(--primary);word-break:break-all">${esc(formUrl(t.token))}</a><br>
            <small style="color:#718096">${esc(t.label || '')} ${t.class_filter ? '· ' + esc(t.class_filter) + '반 고정' : '· 전교'} ${t.active ? '' : '· 중지됨'}</small>
          </div>
          <button class="btn ghost sm" data-copy="${esc(formUrl(t.token))}">주소 복사</button>
          <button class="btn ghost sm" data-qr="${t.token}">QR</button>
          <button class="btn ghost sm" data-toggle="${t.token}">${t.active ? '중지' : '재개'}</button>
          <button class="btn ghost sm" data-rotate="${t.token}">토큰 교체</button>
        </div>`).join('')}
      <button class="btn ghost" id="sv-newtok" style="margin-top:8px">+ 새 배포 링크</button>
    </div>

    <div class="card">
      <h2>언어</h2>
      <div class="field"><label>지원 언어 코드 (콤마 구분, 첫번째=기본)</label>
        <input id="sv-langs" value="${esc(langs)}" placeholder="ko, vi, uz"></div>
    </div>

    <div class="card">
      <h2>문항 <span class="tag gray">${fields.length}개</span></h2>
      <div id="sv-list">
        ${fields.map((f, i) => `
          <div class="row" data-fid="${esc(f.id)}" style="${f.hidden ? 'opacity:.5' : ''}">
            <div style="display:flex;flex-direction:column;gap:2px">
              <button class="btn ghost sm" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="btn ghost sm" data-mv="${i}:1" ${i === fields.length - 1 ? 'disabled' : ''}>▼</button>
            </div>
            <input class="f-label" value="${esc(f.label?.ko || f.id)}" style="flex:1;min-width:120px">
            <select class="f-type">${FIELD_TYPES.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input class="f-group" value="${esc(f.group || '')}" placeholder="그룹" style="width:90px">
            <label style="font-weight:400;font-size:12px;white-space:nowrap"><input type="checkbox" class="f-req" ${f.required ? 'checked' : ''}> 필수</label>
            <label style="font-weight:400;font-size:12px;white-space:nowrap"><input type="checkbox" class="f-pii" ${f.piiLevel === 'sensitive' ? 'checked' : ''}> 민감</label>
            <button class="btn ghost sm" data-hide="${esc(f.id)}">${f.hidden ? '표시' : '숨김'}</button>
            <button class="btn danger sm" data-del="${esc(f.id)}">삭제</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <input id="sv-newname" placeholder="새 문항 이름" style="flex:1;border:1px solid #dfe4ec;border-radius:8px;padding:9px">
        <button class="btn ghost" id="sv-add">+ 문항 추가</button>
      </div>
    </div>

    <div class="dirty-bar">
      <span class="note">저장 시 버전이 올라가고 학생용 폼에 반영됩니다.</span>
      <a class="btn ghost" href="${CFG._tokens[0] ? esc(formUrl(CFG._tokens[0].token)) : '#'}" target="_blank">미리보기</a>
      <button class="btn primary" id="sv-save">설문 저장</button>
    </div>`;

  const main = $('#ac-main');
  const work = fields.map((f) => ({ ...f }));

  main.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('주소를 복사했습니다.'));
  });
  main.querySelectorAll('[data-qr]').forEach((b) => b.onclick = () => {
    const u = formUrl(b.dataset.qr);
    const ov = el(`<div style="position:fixed;inset:0;background:#17203366;display:flex;align-items:center;justify-content:center;z-index:100" data-x>
      <div style="background:#fff;border-radius:14px;padding:24px;text-align:center">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(u)}" width="260" height="260" alt="QR">
        <p style="word-break:break-all;max-width:280px;font-size:12px">${esc(u)}</p>
        <button class="btn ghost" data-x>닫기</button>
      </div></div>`);
    ov.querySelectorAll('[data-x]').forEach((x) => x.onclick = () => ov.remove());
    document.body.appendChild(ov);
  });
  main.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
    const t = CFG._tokens.find((x) => x.token === b.dataset.toggle);
    const { error } = await supabase.from('form_tokens').update({ active: !t.active }).eq('token', t.token);
    if (error) return toast(error.message, true);
    reloadSurvey();
  });
  main.querySelectorAll('[data-rotate]').forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog('이 링크의 토큰을 교체하면 기존 QR/링크는 폐기됩니다. 계속?'))) return;
    const old = CFG._tokens.find((x) => x.token === b.dataset.rotate);
    const newTok = crypto.getRandomValues(new Uint8Array(9)).reduce((s, x) => s + x.toString(16).padStart(2, '0'), '');
    const ins = await supabase.from('form_tokens').insert({ token: newTok, school_id: CFG.school.id, label: old.label, class_filter: old.class_filter });
    if (ins.error) return toast(ins.error.message, true);
    await supabase.from('form_tokens').delete().eq('token', old.token);
    reloadSurvey();
    toast('새 토큰이 발급되었습니다.');
  });
  $('#sv-newtok').onclick = async () => {
    const newTok = crypto.getRandomValues(new Uint8Array(9)).reduce((s, x) => s + x.toString(16).padStart(2, '0'), '');
    const { error } = await supabase.from('form_tokens').insert({ token: newTok, school_id: CFG.school.id, label: '배포 링크' });
    if (error) return toast(error.message, true);
    reloadSurvey();
  };

  main.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
    const [i, dir] = b.dataset.mv.split(':').map(Number);
    const j = i + dir;
    if (j < 0 || j >= work.length) return;
    [work[i], work[j]] = [work[j], work[i]];
    work.forEach((f, k) => { f.order = k + 1; });
    CFG._schema.fields = work; tabSurvey();
  });
  main.querySelectorAll('[data-hide]').forEach((b) => b.onclick = () => {
    const f = work.find((x) => x.id === b.dataset.hide);
    f.hidden = !f.hidden; CFG._schema.fields = work; tabSurvey();
  });
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog('이 문항을 완전히 삭제할까요? (숨김을 권장 — 과거 응답은 보존됨)'))) return;
    CFG._schema.fields = work.filter((x) => x.id !== b.dataset.del);
    CFG._schema.fields.forEach((f, k) => { f.order = k + 1; });
    tabSurvey();
  });
  $('#sv-add').onclick = () => {
    const name = $('#sv-newname').value.trim();
    if (!name) return toast('문항 이름을 입력해 주세요.', true);
    const id = 'q_' + Date.now().toString(36);
    work.push({ id, label: { ko: name }, type: 'short', required: false, hidden: false, order: work.length + 1, piiLevel: 'normal' });
    CFG._schema.fields = work; tabSurvey();
  };

  $('#sv-save').onclick = async (ev) => {
    ev.target.disabled = true;
    // collect edits from inputs
    const rows = [...main.querySelectorAll('#sv-list .row[data-fid]')];
    const out = rows.map((row, k) => {
      const base = work.find((x) => x.id === row.dataset.fid) || { id: row.dataset.fid };
      return {
        ...base,
        label: { ...(base.label || {}), ko: row.querySelector('.f-label').value.trim() || base.id },
        type: row.querySelector('.f-type').value,
        group: row.querySelector('.f-group').value.trim() || undefined,
        required: row.querySelector('.f-req').checked,
        piiLevel: row.querySelector('.f-pii').checked ? 'sensitive' : 'normal',
        hidden: base.hidden || false,
        order: k + 1,
      };
    });
    const languages = $('#sv-langs').value.split(',').map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from('survey_schema')
      .update({ fields: out, languages: languages.length ? languages : ['ko'], version: (schema.version || 1) + 1 })
      .eq('school_id', CFG.school.id);
    ev.target.disabled = false;
    if (error) return toast(error.message, true);
    reloadSurvey();
    toast('저장되었습니다.');
  };
}

// ============================================================ 생활기록 항목
const POLARITY = [['positive', '긍정(칭찬)'], ['negative', '부정(지도)'], ['neutral', '중립'], ['attendance', '근태']];

async function reloadRecords() {
  const [preRes, rtRes] = await Promise.all([
    supabase.from('preset_categories').select('*').order('type').order('display_order'),
    supabase.from('record_types').select('*').order('sort_order'),
  ]);
  CFG._presets = preRes.data || [];
  CFG._recTypes = rtRes.data || [];
  CFG._recLoaded = true;
  tabRecords();
}

function tabRecords() {
  if (!CFG._recLoaded) { $('#ac-main').innerHTML = '<div class="ac-loading">불러오는 중…</div>'; reloadRecords(); return; }
  const good = CFG._presets.filter((p) => p.type === 'good');
  const bad = CFG._presets.filter((p) => p.type === 'bad');
  const roleKeys = CFG.roles.map((r) => r.key);

  const presetList = (title, type, arr) => `
    <div class="card">
      <h2>${title} <span class="tag gray">${arr.length}개</span></h2>
      ${arr.map((p) => `<div class="row" data-pid="${p.id}">
        <span class="grow">${esc(p.item_name)}</span>
        <button class="btn danger sm" data-delp="${p.id}">삭제</button></div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:10px">
        <input class="p-new" data-type="${type}" placeholder="새 항목" style="flex:1;border:1px solid #dfe4ec;border-radius:8px;padding:9px">
        <button class="btn ghost p-add" data-type="${type}">+ 추가</button>
      </div>
    </div>`;

  $('#ac-main').innerHTML = `
    <h1>생활기록 항목</h1>
    <p class="sub">기록 시 고르는 선택지(프리셋)와, 유형별 열람 권한(record_types)을 설정합니다.</p>
    ${presetList('잘한 일 프리셋', 'good', good)}
    ${presetList('못한 일 프리셋', 'bad', bad)}

    <div class="card">
      <h2>기록 유형 · 열람 권한</h2>
      <p class="sub" style="margin-top:-4px">"열람 허용"에 없는 역할은 이 유형의 기록을 조회할 수 없습니다. (예: 상담 = 관리자·상담교사만)</p>
      ${CFG._recTypes.map((rt) => `
        <div class="card" style="background:#fafbfe" data-rt="${rt.id}">
          <div class="row" style="border:0;padding:0 0 8px">
            <input class="rt-label" value="${esc(rt.label)}" style="font-weight:800;width:100px;border:1px solid #eef1f5;border-radius:6px;padding:5px 7px">
            <span class="tag gray">key: ${esc(rt.key)}</span>
            <select class="rt-pol">${POLARITY.map(([v, l]) => `<option value="${v}" ${rt.polarity === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <span class="grow"></span>
            <label style="font-weight:400;font-size:12px"><input type="checkbox" class="rt-active" ${rt.active ? 'checked' : ''}> 사용</label>
            <button class="btn danger sm rt-del">삭제</button>
          </div>
          <div class="checks">
            <label><input type="checkbox" class="rt-vis" value="all" ${(rt.visible_to || []).includes('all') ? 'checked' : ''}> 전체</label>
            ${roleKeys.map((k) => `<label><input type="checkbox" class="rt-vis" value="${k}" ${(rt.visible_to || []).includes(k) ? 'checked' : ''}> ${esc(CFG.roles.find((r) => r.key === k).label)}</label>`).join('')}
          </div>
        </div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="rt-newkey" placeholder="key (영문)" style="width:130px;border:1px solid #dfe4ec;border-radius:8px;padding:9px">
        <input id="rt-newlabel" placeholder="이름" style="flex:1;border:1px solid #dfe4ec;border-radius:8px;padding:9px">
        <button class="btn ghost" id="rt-add">+ 유형 추가</button>
      </div>
    </div>

    <div class="dirty-bar">
      <span class="note">유형 라벨/권한 변경은 저장을 눌러야 반영. 프리셋 추가·삭제는 즉시.</span>
      <button class="btn primary" id="rec-save">기록 유형 저장</button>
    </div>`;

  const main = $('#ac-main');
  main.querySelectorAll('.p-add').forEach((b) => b.onclick = async () => {
    const inp = main.querySelector(`.p-new[data-type="${b.dataset.type}"]`);
    const v = inp.value.trim();
    if (!v) return;
    const arr = CFG._presets.filter((p) => p.type === b.dataset.type);
    const { error } = await supabase.from('preset_categories').insert({
      type: b.dataset.type, item_name: v, display_order: (arr.at(-1)?.display_order || 0) + 1,
    });
    if (error) return toast(error.message.includes('duplicate') ? '이미 있는 항목' : error.message, true);
    reloadRecords();
  });
  main.querySelectorAll('[data-delp]').forEach((b) => b.onclick = async () => {
    const { error } = await supabase.from('preset_categories').delete().eq('id', b.dataset.delp);
    if (error) return toast(error.message, true);
    reloadRecords();
  });
  main.querySelectorAll('.rt-del').forEach((b) => b.onclick = async () => {
    const card = b.closest('[data-rt]');
    if (!(await confirmDialog('이 기록 유형을 삭제할까요? 이미 이 유형으로 저장된 기록은 남습니다.'))) return;
    const { error } = await supabase.from('record_types').delete().eq('id', card.dataset.rt);
    if (error) return toast(error.message, true);
    reloadRecords();
  });
  $('#rt-add').onclick = async () => {
    const key = $('#rt-newkey').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const label = $('#rt-newlabel').value.trim();
    if (!key || !label) return toast('key와 이름을 입력해 주세요.', true);
    const { error } = await supabase.from('record_types').insert({
      key, label, polarity: 'neutral', visible_to: ['all'],
      sort_order: (CFG._recTypes.at(-1)?.sort_order || 100) + 10,
    });
    if (error) return toast(error.message.includes('duplicate') ? '이미 있는 key' : error.message, true);
    reloadRecords();
  };
  $('#rec-save').onclick = async (ev) => {
    ev.target.disabled = true;
    const ops = main.querySelectorAll('[data-rt]');
    const res = await Promise.all([...ops].map((card) => {
      const rt = CFG._recTypes.find((x) => x.id === card.dataset.rt);
      const vis = [...card.querySelectorAll('.rt-vis:checked')].map((c) => c.value);
      return supabase.from('record_types').update({
        label: card.querySelector('.rt-label').value.trim() || rt.label,
        polarity: card.querySelector('.rt-pol').value,
        active: card.querySelector('.rt-active').checked,
        visible_to: vis.length ? vis : ['all'],
      }).eq('id', rt.id);
    }));
    ev.target.disabled = false;
    const err = res.find((r) => r.error);
    if (err) return toast(err.error.message, true);
    reloadRecords();
    toast('저장되었습니다.');
  };
}

// ============================================================ 학생 명단 (xlsx 업로드)
const STU_STATUS = [['active', '재학'], ['graduated', '졸업'], ['transferred', '전출'], ['withdrawn', '자퇴']];
let _parsed = null;   // { headers, rows, sheetClass }

async function reloadStudents() {
  const { data, error } = await supabase.from('students')
    .select('pid,student_id,name,class_info,gender,status,academic_year')
    .eq('academic_year', CFG.school.academic_year)
    .order('class_info').order('student_id');
  if (error) return toast(`학생 목록 로드 실패: ${error.message}`, true);
  CFG._students = data || [];
  CFG._stuLoaded = true;
  tabStudents();
}

function tabStudents() {
  if (!CFG._stuLoaded) { $('#ac-main').innerHTML = '<div class="ac-loading">불러오는 중…</div>'; reloadStudents(); return; }

  const byClass = {};
  CFG._students.forEach((s) => { byClass[s.class_info] = (byClass[s.class_info] || 0) + 1; });
  const classes = groupLevels(CFG.units).flatMap((lv) => lv.units.map((u) => ({ key: `${u.level_order}-${u.class_order}`, label: `${lv.label} ${u.class_label}` })));
  const selClass = CFG._stuClass || classes[0]?.key || '';
  const list = CFG._students.filter((s) => s.class_info === selClass);

  $('#ac-main').innerHTML = `
    <h1>학생 명단 <span class="tag gray">${CFG._students.length}명 · ${CFG.school.academic_year}학년도</span></h1>
    <p class="sub">엑셀(xlsx) 명렬을 업로드하거나, 반별로 학생을 확인·수정합니다.</p>

    <div class="card">
      <h2>명렬 업로드 (xlsx / csv)</h2>
      <p class="sub" style="margin-top:-4px">시트 이름이 <b>1-1</b> 형식이면 자동으로 반이 지정됩니다. 헤더에 <b>학번, 이름</b>(또는 성별·연락처·생년월일) 열.</p>
      <input type="file" id="stu-file" accept=".xlsx,.xls,.csv">
      <div id="stu-preview"></div>
    </div>

    <div class="card">
      <h2>반별 학생</h2>
      <div class="field" style="max-width:280px"><label>반 선택</label>
        <select id="stu-class">${classes.map((c) => `<option value="${c.key}" ${c.key === selClass ? 'selected' : ''}>${c.label} (${byClass[c.key] || 0}명)</option>`).join('')}</select>
      </div>
      ${list.length ? list.map((s) => `
        <div class="row" data-spid="${s.pid}">
          <span class="grow"><b>${esc(s.student_id)}</b> ${esc(s.name)} <small style="color:#718096">${esc(s.gender || '')}</small></span>
          <select class="s-status">${STU_STATUS.map(([v, l]) => `<option value="${v}" ${s.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn danger sm s-del">삭제</button>
        </div>`).join('') : '<p class="sub">이 반에 학생이 없습니다.</p>'}
    </div>`;

  const main = $('#ac-main');
  $('#stu-class').onchange = (e) => { CFG._stuClass = e.target.value; tabStudents(); };

  $('#stu-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sn = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
      const headers = (rows[0] || []).map((h) => String(h || '').trim());
      const body = rows.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== ''));
      const sheetClass = /^\d+-\w+$/.test(sn.trim()) ? sn.trim() : '';
      _parsed = { headers, rows: body, sheetClass };
      renderPreview(classes, selClass);
    } catch (err) {
      toast('파일을 읽지 못했습니다: ' + err.message, true);
    }
  };

  main.querySelectorAll('.row[data-spid]').forEach((row) => {
    const pid = row.dataset.spid;
    row.querySelector('.s-status').onchange = async (e) => {
      const { error } = await supabase.from('students').update({ status: e.target.value }).eq('pid', pid);
      if (error) return toast(error.message, true);
      toast('상태 변경됨');
    };
    row.querySelector('.s-del').onclick = async () => {
      if (!(await confirmDialog('이 학생을 삭제할까요? 연결된 기록·설문도 함께 삭제됩니다.'))) return;
      const { error } = await supabase.from('students').delete().eq('pid', pid);
      if (error) return toast(error.message, true);
      reloadStudents();
    };
  });

  if (_parsed) renderPreview(classes, selClass);
}

function renderPreview(classes, selClass) {
  const box = $('#stu-preview');
  if (!box || !_parsed) return;
  const { headers, rows, sheetClass } = _parsed;
  const guess = (names) => headers.findIndex((h) => names.some((n) => h.replace(/\s/g, '').includes(n)));
  const map = {
    student_id: guess(['학번', 'studentid', 'id', '번호']),
    name: guess(['이름', '성명', 'name']),
    gender: guess(['성별', 'gender']),
    contact: guess(['연락처', '전화', 'phone', '휴대']),
    birth_date: guess(['생년월일', '생일', 'birth']),
    class_info: guess(['반', 'class']),
  };
  const opt = (sel) => `<option value="-1">— 없음 —</option>` + headers.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `열${i + 1}`)}</option>`).join('');

  box.innerHTML = `
    <div style="margin-top:14px;border-top:1px solid #edf0f5;padding-top:14px">
      <div class="grid3">
        <div class="field"><label>학번 열</label><select id="m-sid">${opt(map.student_id)}</select></div>
        <div class="field"><label>이름 열</label><select id="m-name">${opt(map.name)}</select></div>
        <div class="field"><label>성별 열</label><select id="m-gender">${opt(map.gender)}</select></div>
        <div class="field"><label>연락처 열</label><select id="m-contact">${opt(map.contact)}</select></div>
        <div class="field"><label>생년월일 열</label><select id="m-birth">${opt(map.birth_date)}</select></div>
        <div class="field"><label>반 (class_info)</label>
          <select id="m-class">
            ${sheetClass ? `<option value="__sheet">시트명: ${esc(sheetClass)}</option>` : ''}
            ${map.class_info >= 0 ? `<option value="__col">엑셀 열: ${esc(headers[map.class_info])}</option>` : ''}
            ${classes.map((c) => `<option value="${c.key}" ${(!sheetClass && map.class_info < 0 && c.key === selClass) ? 'selected' : ''}>${c.label} 로 고정</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="sub">${rows.length}행 감지. 미리보기(상위 5):</p>
      <div style="overflow:auto"><table class="table" style="font-size:12px"><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
        ${rows.slice(0, 5).map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}
      </table></div>
      <button class="btn primary" id="stu-import" style="margin-top:10px">${rows.length}명 가져오기</button>
      <button class="btn ghost" id="stu-cancel">취소</button>
    </div>`;

  $('#stu-cancel').onclick = () => { _parsed = null; $('#stu-preview').innerHTML = ''; $('#stu-file').value = ''; };
  $('#stu-import').onclick = async (ev) => {
    ev.target.disabled = true;
    const col = (id) => Number($(id).value);
    const cSid = col('#m-sid'), cName = col('#m-name'), cGen = col('#m-gender'), cCon = col('#m-contact'), cBir = col('#m-birth');
    const classMode = $('#m-class').value;
    if (cSid < 0 || cName < 0) { ev.target.disabled = false; return toast('학번·이름 열을 지정해 주세요.', true); }

    const payload = [];
    for (const r of rows) {
      const sid = String(r[cSid] ?? '').trim();
      const name = String(r[cName] ?? '').trim();
      if (!sid || !name) continue;
      let cls = classMode === '__sheet' ? sheetClass
        : classMode === '__col' ? String(r[map.class_info] ?? '').trim()
        : classMode;
      if (!/^\d+-\w+$/.test(cls)) { ev.target.disabled = false; return toast(`반 형식 오류: "${cls}" (예: 1-1)`, true); }
      const row = { student_id: sid, name, class_info: cls, academic_year: CFG.school.academic_year, status: 'active' };
      if (cGen >= 0 && r[cGen] != null) row.gender = String(r[cGen]).trim();
      if (cCon >= 0 && r[cCon] != null) row.contact = String(r[cCon]).trim();
      if (cBir >= 0 && r[cBir] != null && String(r[cBir]).trim()) row.birth_date = String(r[cBir]).trim().slice(0, 10);
      payload.push(row);
    }
    if (!payload.length) { ev.target.disabled = false; return toast('가져올 행이 없습니다.', true); }

    // 재업로드 시 학번 중복은 병합
    const { error } = await supabase.from('students')
      .upsert(payload, { onConflict: 'school_id,academic_year,student_id', ignoreDuplicates: false });
    ev.target.disabled = false;
    if (error) return toast(`가져오기 실패: ${error.message}`, true);
    _parsed = null;
    toast(`${payload.length}명 반영되었습니다.`);
    reloadStudents();
  };
}

// ============================================================ 개인정보
function tabPrivacy() {
  const s = CFG.school;
  const p = s.privacy || {};
  const main = $('#ac-main');
  main.innerHTML = `
    <h1>개인정보</h1>
    <p class="sub">보존기간·동의·접속기록·데이터 파기를 관리합니다. 자세한 근거는 저장소의 <code>docs/COMPLIANCE.md</code>.</p>

    <div class="card">
      <h2>정책 설정</h2>
      <div class="grid2">
        <div class="field"><label>학생 개인정보 보존기간 (학년도 종료 후 N년)</label>
          <input id="p-ret" type="number" min="0" max="10" value="${esc(p.retention_years ?? 1)}"></div>
        <div class="field"><label>접속기록 보존연수 (기본 1년, 민감/대규모 2년)</label>
          <input id="p-log" type="number" min="1" max="5" value="${esc(p.access_log_years ?? 1)}"></div>
        <div class="field"><label>개인정보처리자 (학교/부서)</label>
          <input id="p-ctrl" value="${esc(p.controller_name || s.name)}"></div>
        <div class="field"><label>개인정보 보호책임자</label>
          <input id="p-dpo" value="${esc(p.dpo_name || '')}"></div>
        <div class="field"><label>보호책임자 연락처</label>
          <input id="p-dpoc" value="${esc(p.dpo_contact || '')}"></div>
      </div>
      <div class="checks" style="margin-top:8px">
        <label><input type="checkbox" id="p-consent" ${p.consent_required !== false ? 'checked' : ''}> 설문 제출 전 개인정보 동의 필수</label>
        <label><input type="checkbox" id="p-reads" ${p.log_reads !== false ? 'checked' : ''}> 민감정보 열람도 접속기록에 남김</label>
        <label><input type="checkbox" id="p-purge" ${p.purge_enabled ? 'checked' : ''}> 보존기간 만료분 자동 파기 허용</label>
      </div>
      <div class="field" style="margin-top:10px"><label>동의 안내 문구 (비우면 기본 문구)</label>
        <textarea id="p-text" rows="4" placeholder="비워두면 학교명·수집항목·보유기간을 자동으로 안내">${esc(p.consent_text || '')}</textarea></div>
      <div class="dirty-bar">
        <span class="note">동의 문구를 바꾸면 안내 버전이 올라가 재동의를 유도합니다.</span>
        <button class="btn primary" id="p-save">정책 저장</button>
      </div>
    </div>

    <div class="card">
      <h2>데이터 파기</h2>
      <p class="sub">먼저 "건수 확인"으로 대상을 점검한 뒤 실행하세요. 실행은 되돌릴 수 없습니다.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="pg-data-dry">만료 학생데이터 건수 확인</button>
        <button class="btn danger" id="pg-data-run">만료 학생데이터 파기 실행</button>
        <button class="btn" id="pg-log-dry">만료 접속기록 건수 확인</button>
        <button class="btn danger" id="pg-log-run">만료 접속기록 파기 실행</button>
      </div>
      <pre id="pg-out" style="background:#f5f7fb;border:1px solid #e5e9f0;border-radius:8px;padding:10px;margin-top:10px;font-size:12px;white-space:pre-wrap;min-height:20px"></pre>
    </div>

    <div class="card">
      <h2>접속기록 (개인정보처리시스템)</h2>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn" id="lg-access">민감정보 열람 기록</button>
        <button class="btn" id="lg-user">관리·쓰기 작업 기록</button>
      </div>
      <div id="lg-out" style="max-height:340px;overflow:auto;border:1px solid #e5e9f0;border-radius:8px"></div>
    </div>`;

  $('#p-save').onclick = async (ev) => {
    ev.target.disabled = true;
    const newText = $('#p-text').value.trim();
    const bumpVer = newText !== (p.consent_text || '');
    const privacy = {
      ...p,
      retention_years: Number($('#p-ret').value) || 0,
      access_log_years: Number($('#p-log').value) || 1,
      controller_name: $('#p-ctrl').value.trim(),
      dpo_name: $('#p-dpo').value.trim(),
      dpo_contact: $('#p-dpoc').value.trim(),
      consent_required: $('#p-consent').checked,
      log_reads: $('#p-reads').checked,
      purge_enabled: $('#p-purge').checked,
      consent_text: newText,
      consent_version: (p.consent_version || 1) + (bumpVer ? 1 : 0),
    };
    const { error } = await supabase.from('schools').update({ privacy }).eq('id', s.id);
    ev.target.disabled = false;
    if (error) return toast(`저장 실패: ${error.message}`, true);
    CFG.school.privacy = privacy;
    toast('저장되었습니다.');
    tabPrivacy();
  };

  const runPurge = async (kind, dry) => {
    const out = $('#pg-out');
    if (!dry && !(await confirmDialog('되돌릴 수 없습니다. 정말 파기할까요?'))) return;
    out.textContent = '처리 중…';
    const r = await apiPost('/purge', { kind, dry_run: dry });
    out.textContent = JSON.stringify(r, null, 2);
    if (!dry) toast('파기 완료');
  };
  $('#pg-data-dry').onclick = () => runPurge('data', true);
  $('#pg-data-run').onclick = () => runPurge('data', false);
  $('#pg-log-dry').onclick = () => runPurge('logs', true);
  $('#pg-log-run').onclick = () => runPurge('logs', false);

  const showLogs = async (kind) => {
    const box = $('#lg-out');
    box.innerHTML = '<div class="ac-loading">불러오는 중…</div>';
    const rows = await apiGet(`/logs?kind=${kind}&limit=200`);
    if (!Array.isArray(rows) || !rows.length) { box.innerHTML = '<p class="sub" style="padding:12px">기록 없음</p>'; return; }
    const timeKey = kind === 'access' ? 'accessed_at' : 'created_at';
    box.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="background:#f5f7fb"><th style="text-align:left;padding:6px">일시</th><th style="text-align:left;padding:6px">계정</th><th style="text-align:left;padding:6px">업무</th><th style="text-align:left;padding:6px">대상/상세</th><th style="text-align:left;padding:6px">IP(해시)</th></tr></thead>
      <tbody>${rows.map((x) => `<tr style="border-top:1px solid #eef1f5">
        <td style="padding:6px;white-space:nowrap">${esc((x[timeKey] || '').replace('T', ' ').slice(0, 19))}</td>
        <td style="padding:6px">${esc(x.teacher_email || '')}</td>
        <td style="padding:6px">${esc(x.action_type || x.action || '')}</td>
        <td style="padding:6px">${esc(x.detail || x.target_id || x.target_type || '')}</td>
        <td style="padding:6px;color:#8a94a6">${esc((x.ip_hash || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
  };
  $('#lg-access').onclick = () => showLogs('access');
  $('#lg-user').onclick = () => showLogs('user');
  showLogs('access');
}

boot();
