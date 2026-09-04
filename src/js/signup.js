/**
 * 셀프 학교 개설 폼 — 로그인 없음.
 * URL: /signup.html  (프로덕션: signup.creat1324.com 또는 아무 도메인/start)
 * 게이트웨이 무인증 라우트: POST /api/signup
 */
const API = `${location.origin}/api`;
const ROOT = 'creat1324.com'; // 테넌트 하위도메인 루트 (게이트웨이 tenantFromHost 와 일치)

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ERRORS = {
  bad_domain: '학교 주소 형식을 확인해 주세요. (영문 소문자 시작, 3~31자)',
  domain_reserved: '사용할 수 없는 주소입니다. 다른 주소를 입력해 주세요.',
  domain_taken: '이미 사용 중인 주소입니다. 다른 주소를 입력해 주세요.',
  bad_name: '학교 이름을 확인해 주세요.',
  bad_education_type: '학교급을 선택해 주세요.',
  bad_email: '관리자 이메일 형식을 확인해 주세요.',
  bad_admin_name: '관리자 이름을 확인해 주세요.',
  bad_code: '가입 코드가 올바르지 않습니다.',
  rate_limited: '잠시 후 다시 시도해 주세요. (요청이 많습니다)',
  create_failed: '학교 생성에 실패했습니다. 입력값을 확인하거나 잠시 후 다시 시도해 주세요.',
};

// 도메인 입력 정규화
$('domain').addEventListener('input', (e) => {
  e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
});

$('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('err');
  err.textContent = '';

  const payload = {
    domain: $('domain').value.trim(),
    name: $('name').value.trim(),
    short_name: $('short_name').value.trim(),
    education_type: $('education_type').value,
    admin_name: $('admin_name').value.trim(),
    admin_email: $('admin_email').value.trim().toLowerCase(),
    levels: parseInt($('levels').value, 10) || 3,
    classes: parseInt($('classes').value, 10) || 6,
    code: $('code').value.trim(),
    hp: $('hp').value,
  };

  if (!/^[a-z][a-z0-9-]{2,30}$/.test(payload.domain)) return (err.textContent = ERRORS.bad_domain);
  if (!payload.name) return (err.textContent = ERRORS.bad_name);
  if (!payload.education_type) return (err.textContent = ERRORS.bad_education_type);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.admin_email)) return (err.textContent = ERRORS.bad_email);
  if (!payload.admin_name) return (err.textContent = ERRORS.bad_admin_name);

  $('go').disabled = true;
  $('go').textContent = '만드는 중…';
  try {
    const r = await fetch(`${API}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.ok) {
      if (b.error === 'bad_code' && $('codeField').hidden) $('codeField').hidden = false;
      err.textContent = ERRORS[b.error] || '학교 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.';
      $('go').disabled = false;
      $('go').textContent = '학교 만들기';
      return;
    }
    showSuccess(b);
  } catch (e) {
    err.textContent = `네트워크 오류: ${esc(e.message)}`;
    $('go').disabled = false;
    $('go').textContent = '학교 만들기';
  }
});

function showSuccess(b) {
  const consoleUrl = `https://${b.domain}.${ROOT}/admin-console.html`;
  const surveyUrl = b.survey_token ? `https://q.${ROOT}/f/${b.survey_token}` : null;

  const p = b.provision || {};
  let domainMsg;
  if (p.attempted && p.ok) {
    domainMsg = '도메인이 자동으로 연결되었습니다. <b>SSL 발급까지 보통 2~5분</b> 걸리니, 접속이 안 되면 잠시 후 새로고침해 주세요.';
  } else if (p.attempted) {
    domainMsg = '도메인 자동 연결에 실패한 항목이 있습니다. <b>운영자에게 문의</b>하시거나, 콘솔 로그인 후 다시 시도하세요.'
      + (p.detail ? `<br><span style="font-size:11px;color:#a0a0a0">(${esc(p.detail)})</span>` : '');
  } else {
    domainMsg = '위 콘솔 주소는 <b>운영자가 도메인을 연결</b>한 뒤 접속할 수 있습니다. 운영자에게 학교 주소를 알려주세요.';
  }

  $('card').innerHTML = `
    <div class="ok">
      <div class="big">🎉</div>
      <h2>${esc(b.domain)} 학교가 만들어졌어요</h2>
      <p style="color:#718096;font-size:13px;margin:0">관리자 이메일 <b>${esc(b.admin_email)}</b> 로 로그인하세요.</p>

      <div class="linkbox">
        <b>관리자 콘솔</b>
        <a href="${esc(consoleUrl)}">${esc(consoleUrl)}</a>
      </div>
      ${surveyUrl ? `<div class="linkbox"><b>학생 기초조사 링크 (기본)</b><a href="${esc(surveyUrl)}">${esc(surveyUrl)}</a></div>` : ''}

      <ol class="steps">
        <li>콘솔에 관리자 이메일로 로그인</li>
        <li><b>학년·반 구조</b> 확인·수정</li>
        <li><b>교사</b> 탭에서 선생님 등록 (이메일·역할)</li>
        <li><b>학생 명단</b> 탭에서 명렬 엑셀(xlsx) 업로드</li>
        <li><b>설문 문항</b> 탭에서 문항 편집 후 QR·링크 배포</li>
      </ol>

      <p class="note" style="margin-top:16px">${domainMsg}</p>
      <a href="${esc(consoleUrl)}" class="submit" style="display:block;text-align:center;text-decoration:none;margin-top:8px">콘솔로 이동</a>
    </div>`;
}
