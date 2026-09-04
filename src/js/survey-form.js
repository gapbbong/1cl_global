/**
 * 학생용 기초조사 폼 — 로그인 없음.
 * URL: /survey-form.html?token=<form_token>   (프로덕션: q.creat1324.com/f/<token>)
 * 게이트웨이 무인증 라우트: GET /api/survey/form, POST /api/survey/submit, POST /api/survey/photo
 */
const API = `${location.origin}/api`;
const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
// q.creat1324.com/f/<token> 형태도 지원
const token = params.get('token') || (location.pathname.match(/\/f\/([a-f0-9]+)/i) || [])[1] || '';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CONF = null;
let lang = 'ko';
let photoUrl = null;

function labelOf(f) { return (f.label && (f.label[lang] || f.label.ko)) || f.id; }

async function boot() {
  if (!token) { app.innerHTML = '<div class="msg">잘못된 주소입니다. (토큰 없음)</div>'; return; }
  try {
    const r = await fetch(`${API}/survey/form?token=${encodeURIComponent(token)}`);
    const b = await r.json();
    if (!r.ok) {
      const m = { closed: '설문이 마감되었습니다.', not_open_yet: '아직 설문 기간이 아닙니다.',
        token_not_found: '유효하지 않은 링크입니다.', not_configured: '설문이 준비되지 않았습니다.' }[b.error] || '설문을 불러오지 못했습니다.';
      app.innerHTML = `<div class="msg">${esc(m)}</div>`;
      return;
    }
    CONF = b;
    lang = (b.languages && b.languages[0]) || 'ko';
    if (b.school?.theme?.primary) document.documentElement.style.setProperty('--p', b.school.theme.primary);
    render();
  } catch (e) {
    app.innerHTML = `<div class="msg">네트워크 오류: ${esc(e.message)}</div>`;
  }
}

function render() {
  const s = CONF.school || {};
  const groups = [];
  const seen = new Set();
  for (const f of CONF.fields) {
    const g = f.group || '';
    if (!seen.has(g)) { seen.add(g); groups.push(g); }
  }

  app.innerHTML = `
    <div class="head">
      <p>${esc(s.short_name || s.name || '')}</p>
      <h1>학생 기초조사</h1>
      <p>담임 선생님만 볼 수 있어요. 편하게 작성해 주세요.</p>
    </div>
    ${(CONF.languages || ['ko']).length > 1 ? `<div class="langbar">${CONF.languages.map((l) =>
      `<button data-lang="${l}" class="${l === lang ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div>` : ''}
    <form id="f">
      <div class="card">
        <div class="field"><label>학번 <span class="req">*</span></label>
          <input name="__sid" inputmode="numeric" required placeholder="예: 1101"></div>
        ${CONF.classFilter ? '' : `<div class="field"><label>학년-반 <span class="req">*</span></label>
          <input name="__class" required placeholder="예: 1-1"></div>`}
      </div>
      ${groups.map((g) => `
        ${g ? `<div class="grp">${esc(g)}</div>` : ''}
        <div class="card">
          ${CONF.fields.filter((f) => (f.group || '') === g).map(fieldHtml).join('')}
        </div>`).join('')}
      ${CONF.consent && CONF.consent[lang] ? `<div class="card" style="font-size:13px;color:#647086">${esc(CONF.consent[lang])}</div>` : ''}
      ${consentHtml()}
      <button type="submit" class="submit" id="sub">제출하기</button>
      <p class="err" id="ferr" style="text-align:center"></p>
    </form>`;

  app.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { lang = b.dataset.lang; render(); });
  const photoInput = app.querySelector('input[type=file]');
  if (photoInput) photoInput.onchange = onPhoto;
  document.getElementById('f').onsubmit = submit;
}

function consentHtml() {
  const pc = CONF.privacyConsent;
  if (!pc || !pc.required) return '';
  return `
    <div class="card" style="border-color:#c9d6f2;background:#f6f9ff">
      <div class="grp" style="margin-top:0">개인정보 수집·이용 동의 <span class="req">*</span></div>
      <p style="font-size:13px;color:#4a5568;white-space:pre-wrap;margin:6px 0 12px">${esc(pc.text)}</p>
      <div class="field" style="display:flex;gap:10px">
        <div style="flex:1"><label>동의자 이름 <span class="req">*</span></label>
          <input name="__consent_name" required placeholder="보호자 또는 학생 이름"></div>
        <div style="width:130px"><label>관계</label>
          <select name="__consent_role"><option value="guardian">보호자</option><option value="student">학생 본인</option></select></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-weight:700;margin-top:6px">
        <input type="checkbox" name="__consent_ok" style="width:auto" required>
        위 내용에 동의합니다
      </label>
    </div>`;
}

function fieldHtml(f) {
  const L = `<label>${esc(labelOf(f))} ${f.required ? '<span class="req">*</span>' : ''}</label>`;
  const name = `name="${esc(f.id)}"${f.required ? ' required' : ''}`;
  if (f.type === 'long') return `<div class="field">${L}<textarea ${name}></textarea></div>`;
  if (f.type === 'select') return `<div class="field">${L}<select ${name}><option value="">선택</option>${
    (f.options || []).map((o) => `<option value="${esc(o.value)}">${esc((o.label && (o.label[lang] || o.label.ko)) || o.value)}</option>`).join('')}</select></div>`;
  if (f.type === 'photo') return `<div class="field">${L}<input type="file" accept="image/*" capture="user">
    <img class="photo-prev" id="pprev" alt="" hidden></div>`;
  if (f.type === 'date') return `<div class="field">${L}<input type="date" ${name}></div>`;
  if (f.type === 'number') return `<div class="field">${L}<input type="number" ${name}></div>`;
  if (f.type === 'tel') return `<div class="field">${L}<input type="tel" inputmode="tel" ${name}></div>`;
  if (f.type === 'rating') return `<div class="field">${L}<select ${name}><option value="">선택</option>${
    [1, 2, 3, 4, 5].map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></div>`;
  return `<div class="field">${L}<input ${name}></div>`;
}

async function onPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const sid = (document.querySelector('input[name=__sid]').value || 'x').trim();
  const prev = document.getElementById('pprev');
  prev.hidden = false; prev.src = URL.createObjectURL(file);
  try {
    const r = await fetch(`${API}/survey/photo?token=${encodeURIComponent(token)}&sid=${encodeURIComponent(sid)}`, {
      method: 'POST', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file,
    });
    const b = await r.json();
    if (r.ok) { photoUrl = b.url; } else { document.getElementById('ferr').textContent = '사진 업로드 실패'; }
  } catch { document.getElementById('ferr').textContent = '사진 업로드 실패'; }
}

async function submit(e) {
  e.preventDefault();
  const err = document.getElementById('ferr');
  err.textContent = '';
  const fd = new FormData(e.target);
  const sid = String(fd.get('__sid') || '').trim();
  const cls = CONF.classFilter || String(fd.get('__class') || '').trim();
  if (!/^\d{2,10}$/.test(sid)) { err.textContent = '학번을 숫자로 입력해 주세요.'; return; }
  if (!/^\d+-\w+$/.test(cls)) { err.textContent = '학년-반을 예: 1-1 형식으로 입력해 주세요.'; return; }

  let consent = null;
  const pc = CONF.privacyConsent;
  if (pc && pc.required) {
    if (!fd.get('__consent_ok')) { err.textContent = '개인정보 수집·이용에 동의해야 제출할 수 있습니다.'; return; }
    const cname = String(fd.get('__consent_name') || '').trim();
    if (!cname) { err.textContent = '동의자 이름을 입력해 주세요.'; return; }
    consent = { agreed: true, version: pc.version, agent_name: cname, agent_role: fd.get('__consent_role') || 'guardian' };
  }

  const answers = {};
  for (const f of CONF.fields) {
    if (f.type === 'photo') { if (photoUrl) answers[f.id] = photoUrl; continue; }
    const v = fd.get(f.id);
    if (v != null && v !== '') answers[f.id] = v;
  }

  const btn = document.getElementById('sub');
  btn.disabled = true; btn.textContent = '제출 중…';
  try {
    const r = await fetch(`${API}/survey/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, student_id: sid, class_info: cls, name: answers.name, answers, lang, consent }),
    });
    const b = await r.json();
    if (!r.ok) { err.textContent = ({ bad_student_id: '학번 형식 오류', bad_class: '학년-반 형식 오류', closed: '설문이 마감되었습니다.', consent_required: '개인정보 수집·이용 동의가 필요합니다.' }[b.error]) || '제출에 실패했습니다.'; btn.disabled = false; btn.textContent = '제출하기'; return; }
    app.innerHTML = `<div class="ok"><div class="big">✅</div><h2>제출되었습니다</h2><p>감사합니다. 창을 닫으셔도 됩니다.</p></div>`;
  } catch (ex) {
    err.textContent = '네트워크 오류: ' + ex.message;
    btn.disabled = false; btn.textContent = '제출하기';
  }
}

boot();
