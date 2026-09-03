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
    sbRest(`schools?select=name,short_name,locale,theme&id=eq.${tok.school_id}&limit=1`),
    sbRest(`survey_schema?select=*&school_id=eq.${tok.school_id}&limit=1`),
  ]);
  const school = (await scR.json().catch(() => []))[0] || null;
  const schema = (await schemaR.json().catch(() => []))[0] || null;
  if (!school || !schema) return { status: 404, body: { error: 'not_configured' } };

  const fields = (schema.fields || [])
    .filter((f) => !f.hidden)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    // strip server-only hints
    .map(({ mapTo, piiLevel, ...pub }) => pub);

  return {
    status: 200,
    body: {
      school: { name: school.name, short_name: school.short_name, locale: school.locale, theme: school.theme || {} },
      languages: schema.languages || ['ko'],
      consent: schema.consent || {},
      classFilter: tok.class_filter || null,
      fields,
    },
  };
}

/** POST /api/survey/submit — { token, student_id, class_info?, name?, answers, lang } */
export async function surveySubmit(sbRest, payload) {
  const { token, student_id, class_info, answers } = payload || {};
  const { tok, error } = await resolveToken(sbRest, token);
  if (error) return { status: error === 'bad_token' ? 400 : 410, body: { error } };

  const sid = String(student_id || '').trim();
  if (!sid || !/^[A-Za-z0-9-]{1,20}$/.test(sid)) return { status: 400, body: { error: 'bad_student_id' } };
  if (!answers || typeof answers !== 'object') return { status: 400, body: { error: 'no_answers' } };

  const cls = tok.class_filter || String(class_info || '').trim();
  if (!/^\d+-\w+$/.test(cls)) return { status: 400, body: { error: 'bad_class' } };

  // school academic year + survey schema (for mapTo)
  const [scR, schemaR] = await Promise.all([
    sbRest(`schools?select=academic_year&id=eq.${tok.school_id}&limit=1`),
    sbRest(`survey_schema?select=fields&school_id=eq.${tok.school_id}&limit=1`),
  ]);
  const year = ((await scR.json().catch(() => []))[0] || {}).academic_year || new Date().getFullYear();
  const fields = ((await schemaR.json().catch(() => []))[0] || {}).fields || [];

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
