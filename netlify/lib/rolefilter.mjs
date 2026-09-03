/**
 * Role-based field filtering for gateway GET responses.
 *
 * The gateway proxies PostgREST with service_role (no RLS), so it must itself
 * strip fields a teacher's role is not allowed to see. Row-level `own_class`
 * scoping is applied to `students` via a query filter; `surveys`/`life_records`
 * own_class is best-effort (see notes).
 *
 * permissions shape (roles.permissions):
 *   { scope, students:{read:["basic","contact","sensitive"]},
 *     survey:{read:"all|own_class|none", fields:["allergy",...]},
 *     records:{read:"all|own_class|none", types:["근태",...]},
 *     admin:{...} }
 */

export function isPrivileged(perms, roleKey) {
  if (roleKey === 'admin') return true;
  return !!(perms && perms.admin && Object.values(perms.admin).some(Boolean));
}

const pick = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
};
const nullFields = (row, keys) => { for (const k of keys) if (k in row) row[k] = null; };

/** Fetch this role's permission blob + the school's record_types (for visibility). */
export async function loadRoleContext(sbRest, schoolId, roleKey) {
  const [rRes, rtRes] = await Promise.all([
    sbRest(`roles?select=permissions&school_id=eq.${schoolId}&key=eq.${encodeURIComponent(roleKey)}&limit=1`).then((r) => r.json()).catch(() => []),
    sbRest(`record_types?select=key,label,visible_to&school_id=eq.${schoolId}`).then((r) => r.json()).catch(() => []),
  ]);
  const perms = (Array.isArray(rRes) && rRes[0] && rRes[0].permissions) || {};
  const recordTypes = Array.isArray(rtRes) ? rtRes : [];
  return { perms, recordTypes };
}

/**
 * Rewrite a scoped GET query for `students` when the role is own_class.
 * Returns the (possibly modified) search string.
 */
export function scopeStudentsQuery(search, perms, roleKey, myClass) {
  if (isPrivileged(perms, roleKey)) return search;
  if ((perms.scope || '') !== 'own_class' || !myClass) return search;
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  qs.set('class_info', `eq.${myClass}`);
  return `?${qs.toString()}`;
}

/**
 * Filter a PostgREST JSON response body by role.
 * @returns filtered JSON string (or original text if not applicable)
 */
export function filterBody(table, text, ctx) {
  const { perms, recordTypes, roleKey } = ctx;
  if (isPrivileged(perms, roleKey)) return text;

  let data;
  try { data = JSON.parse(text); } catch { return text; }
  const rows = Array.isArray(data) ? data : [data];

  if (table === 'students') {
    const r = (perms.students && perms.students.read) || ['basic'];
    for (const row of rows) {
      if (row && typeof row === 'object') {
        if (!r.includes('contact')) nullFields(row, ['contact', 'parent_contact', 'address', 'instagram_id']);
        if (!r.includes('sensitive')) nullFields(row, ['birth_date', 'parent_relation', 'answers']);
      }
    }
  } else if (table === 'surveys') {
    const sr = perms.survey && perms.survey.read;
    if (!sr || sr === 'none') return '[]';
    const allowed = perms.survey && Array.isArray(perms.survey.fields) ? perms.survey.fields : null;
    if (allowed) {
      for (const row of rows) {
        if (row && row.data && typeof row.data === 'object') row.data = pick(row.data, allowed);
      }
    }
  } else if (table === 'life_records') {
    const rr = perms.records && perms.records.read;
    if (!rr || rr === 'none') return '[]';
    const types = perms.records && Array.isArray(perms.records.types) ? perms.records.types : null;
    // record_types not visible to this role
    const hidden = new Set(
      recordTypes
        .filter((rt) => {
          const v = Array.isArray(rt.visible_to) ? rt.visible_to : ['all'];
          return !(v.includes('all') || v.includes(roleKey));
        })
        .map((rt) => rt.label),
    );
    const kept = rows.filter((row) => {
      if (!row || row.category == null) return true;
      if (hidden.has(row.category)) return false;
      if (types && !types.includes(row.category)) return false;
      return true;
    });
    return JSON.stringify(Array.isArray(data) ? kept : (kept[0] || null));
  }

  return JSON.stringify(Array.isArray(data) ? rows : rows[0]);
}
