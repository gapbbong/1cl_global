/**
 * Survey engine — unauthenticated student-facing logic, shared by the edge and
 * lambda gateways. `sbRest(pathWithQuery, opts)` hits Supabase PostgREST with the
 * service_role key (provided by the caller).
 */

const enc = encodeURIComponent;

async function resolveToken(sbRest, token) {
  if (!token || !/^[a-f0-9]{8,64}$/i.test(token)) return { error: 'bad_token' };
  const r = await sbRest(`form_tokens?select=*&token=eq.${enc(token)}&limit=1`);
  const rows = await r.json().catch(() => null);
  const t = Array.isArray(rows) ? rows[0] : null;
  if (!t) return { error: 'token_not_found' };
  if (!t.active) return { error: 'closed' };
  const now = Date.now();
  if (t.open_at && Date.parse(t.open_at) > now) return { error: 'not_open_yet' };
  if (t.close_at && Date.parse(t.close_at) < now) return { error: 'closed' };
  return { tok: t };
}

/** GET /api/survey/form?token= — form definition for the student page (no PII). */
export async function surveyForm(sbRest, token) {
  const { tok, error } = await resolveToken(sbRest, token);
  if (error) return { status: error === 'bad_token' ? 400 : 410, body: { error } };

  const [scR, schemaR] = await Promise.all([
    sbRest(`schools?select=name,short_name,locale,theme,privacy&id=eq.${tok.school_id}&limit=1`),
    sbRest(`survey_schema?select=*&school_id=eq.${tok.school_id}&limit=1`),
  ]);
  const school = (await scR.json().catch(() => []))[0] || null;
  const schema = (await schemaR.json().catch(() => []))[0] || null;
  if (!school || !schema) return { status: 404, body: { error: 'not_configured' } };
  const priv = school.privacy || {};

  const fields = (schema.fields || [])
    .filter((f) => !f.hidden)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    // strip server-only hints
    .map(({ mapTo, piiLevel, ...pub }) => pub);

  const DEFAULT_CONSENT =
    `${school.name}은(는) 학급 운영·상담을 위해 이 설문의 응답을 수집·이용합니다.\n`
    + `수집 항목은 아래 문항과 같으며, 보유·이용 기간은 해당 학년도 종료 후 `
    + `${priv.retention_years ?? 1}년입니다. 동의를 거부할 수 있으나, 이 경우 설문 제출이 제한됩니다.`;

  return {
    status: 200,
    body: {
      school: { name: school.name, short_name: school.short_name, locale: school.locale, theme: school.theme || {} },
      languages: schema.languages || ['ko'],
      consent: schema.consent || {},
      privacyConsent: {
        required: priv.consent_required !== false,
        version: priv.consent_version || 1,
        text: (priv.consent_text && priv.consent_text.trim()) || DEFAULT_CONSENT,
      },
      classFilter: tok.class_filter || null,
      fields,
    },
  };
}

/** POST /api/survey/submit — { token, student_id, class_info?, name?, answers, lang, consent } */
export async function surveySubmit(sbRest, payload, meta = {}) {
  const { token, student_id, class_info, answers, consent } = payload || {};
  const { tok, error } = await resolveToken(sbRest, token);
  if (error) return { status: error === 'bad_token' ? 400 : 410, body: { error } };

  const sid = String(student_id || '').trim();
  if (!sid || !/^[A-Za-z0-9-]{1,20}$/.test(sid)) return { status: 400, body: { error: 'bad_student_id' } };
  if (!answers || typeof answers !== 'object') return { status: 400, body: { error: 'no_answers' } };

  const cls = tok.class_filter || String(class_info || '').trim();
  if (!/^\d+-\w+$/.test(cls)) return { status: 400, body: { error: 'bad_class' } };

  // school academic year + survey schema (for mapTo) + privacy(동의 필수 여부)
  const [scR, schemaR] = await Promise.all([
    sbRest(`schools?select=academic_year,privacy&id=eq.${tok.school_id}&limit=1`),
    sbRest(`survey_schema?select=fields&school_id=eq.${tok.school_id}&limit=1`),
  ]);
  const sch = (await scR.json().catch(() => []))[0] || {};
  const year = sch.academic_year || new Date().getFullYear();
  const priv = sch.privacy || {};
  const fields = ((await schemaR.json().catch(() => []))[0] || {}).fields || [];

  if (priv.consent_required !== false && !(consent && consent.agreed)) {
    return { status: 400, body: { error: 'consent_required' } };
  }

  // find or create the student
  let stuR = await sbRest(
    `students?select=pid&school_id=eq.${tok.school_id}&academic_year=eq.${year}&student_id=eq.${enc(sid)}&limit=1`,
  );
  let stu = (await stuR.json().catch(() => []))[0];
  if (!stu) {
    const name = String(answers.name || payload.name || '미입력').slice(0, 40);
    const ins = await sbRest('students', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        school_id: tok.school_id, student_id: sid, name,
        academic_year: year, class_info: cls, status: 'active',
      }),
    });
    stu = (await ins.json().catch(() => []))[0];
    if (!stu) return { status: 500, body: { error: 'student_create_failed' } };
  }

  // store the raw survey
  await sbRest('surveys', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ school_id: tok.school_id, student_pid: stu.pid, data: answers }),
  });

  // 동의 이력 기록 (개인정보 수집·이용 동의)
  if (consent && consent.agreed) {
    await sbRest('consents', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        school_id: tok.school_id, student_pid: stu.pid, student_ref: sid,
        scope: 'survey', version: Number(consent.version) || (priv.consent_version || 1),
        agreed: true,
        agent_name: String(consent.agent_name || '').slice(0, 40) || null,
        agent_role: consent.agent_role === 'student' ? 'student' : 'guardian',
        ip_hash: meta.ipHash || null, user_agent: (meta.userAgent || '').slice(0, 200) || null,
      }),
    }).catch(() => {});
  }

  // sync mapTo fields onto the student row (whitelist columns)
  const ALLOWED = new Set(['name', 'gender', 'contact', 'birth_date', 'address', 'instagram_id', 'middle_school', 'parent_contact', 'photo_url']);
  const patch = {};
  for (const f of fields) {
    if (f.mapTo && ALLOWED.has(f.mapTo) && answers[f.id] != null && answers[f.id] !== '') {
      patch[f.mapTo] = String(answers[f.id]).slice(0, 500);
    }
  }
  if (Object.keys(patch).length) {
    await sbRest(`students?pid=eq.${stu.pid}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
  }

  return { status: 200, body: { ok: true } };
}

/** POST /api/survey/photo?token= (raw image bytes) — upload to student-photos, return public url. */
export async function surveyPhoto(sbRest, supabaseUrl, serviceKey, token, sid, contentType, bytes) {
  const { tok, error } = await resolveToken(sbRest, token);
  if (error) return { status: error === 'bad_token' ? 400 : 410, body: { error } };
  if (!bytes || bytes.byteLength > 6 * 1024 * 1024) return { status: 413, body: { error: 'too_large' } };
  const ext = (contentType || '').includes('png') ? 'png' : 'jpg';
  const safeSid = String(sid || 'x').replace(/[^A-Za-z0-9-]/g, '');
  const path = `${tok.school_id}/${safeSid}_${Date.now()}.${ext}`;
  const up = await fetch(`${supabaseUrl}/storage/v1/object/student-photos/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': contentType || 'image/jpeg', 'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!up.ok) return { status: 502, body: { error: 'upload_failed', detail: await up.text().catch(() => '') } };
  return { status: 200, body: { url: `${supabaseUrl}/storage/v1/object/public/student-photos/${path}`, path } };
}
