# Security migration — API gateway (branch `security-proxy-refactor`)

## What changed & why

**Before:** the browser bundle shipped the Supabase **`service_role`** key
(`VITE_SUPABASE_ANON_KEY` in `.env` was actually the service_role JWT). Anyone
could read `assets/supabase-*.js`, extract the key, and read/write/delete every
row in the database (650 students' PII, surveys, records). RLS was bypassed.

**After:** the browser holds **no Supabase key**. All Supabase access goes through
`netlify/functions/api.mjs`:

```
browser ──(HMAC session token)──▶ /api/*  (Netlify Function)
                                    ├─ verifies the signed session token
                                    ├─ per-table authorization matrix
                                    └─ talks to Supabase with service_role (server-side only)
```

- **Login** is still email-only (no password — unchanged product decision), but the
  session token is now an **unforgeable HMAC** signed with a server-only secret,
  instead of `AES(email, hardcoded-key)`.
- Existing logged-in users are **auto-migrated** on first API call (the old
  `teacher_auth_token` is exchanged for a gateway session transparently).
- Public student-photo URLs still load **straight from Supabase** (public bucket,
  no key, cacheable) — only the project ref is exposed, which is not a secret.

## Files

| File | Change |
|---|---|
| `netlify/functions/api.mjs` | **new** — the gateway (login / session / PostgREST proxy / storage) |
| `netlify.toml` | functions dir + `/api/*` → function redirect |
| `src/js/supabase.js` | client routes through `/api/*`; `loginTeacher()`, `verifySession()`, `ensureSession()`, `logout()`; `getPublicUrl` rewritten to Supabase origin |
| `src/js/index.js` | login form + session re-verify use the gateway (also fixes an undefined-var crash from earlier WIP) |
| `src/js/keeper.js`, `src/js/settings.js` | clear `oc_session` on logout |
| `.env` / `.env.example` | `VITE_*` no longer carries any key |

## Deploy steps (do in order)

### 1. Set Netlify environment variables

Site → **Site configuration → Environment variables** (apply to *all* contexts, incl. Deploy previews):

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://pwyflwjtafarkwbejoen.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | current service_role JWT (rotate later — step 4) |
| `AUTH_SIGNING_SECRET` | a fresh 48-byte random string (see `.env`) |
| `VITE_PUBLIC_SUPABASE_URL` | `https://pwyflwjtafarkwbejoen.supabase.co` |

Remove the old `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from Netlify.

### 2. Push the branch and test on the Deploy Preview

```
git push -u origin security-proxy-refactor
```

Netlify builds a **Deploy Preview** URL. On it, verify:

- [ ] Fresh login (incognito) with a real teacher email works; a non-teacher email is rejected
- [ ] Existing session (normal window) still works without re-login (auto-migration)
- [ ] Class list, student detail popup, photos load
- [ ] `analysis.html` — student analysis loads & AI insight save works
- [ ] `record.html` / `bulk-record.html` — create / edit / delete a record works
- [ ] `check-survey.html`, `class-survey.html` — survey data loads
- [ ] `calendar.html` — schedules load / add
- [ ] `settings.html` — settings save
- [ ] `total-records.html`, `print-report.html`, `quiz.html`, `keeper.html`
- [ ] evidence-photo upload in a record
- [ ] DevTools → Network: no request carries a Supabase JWT; `assets/supabase-*.js` has none
- [ ] DevTools → Application → Local Storage: `oc_session` present

### 3. Merge to `main`

```
git checkout main && git merge --no-ff security-proxy-refactor && git push
```

Auto-deploys to production.

### 4. Rotate the leaked `service_role` key  (**critical — the old key is public in git history & old bundles**)

Supabase dashboard → **Settings → API → JWT Settings → Generate new JWT secret**
(this invalidates the old anon + service_role tokens).

- Copy the new `service_role` → update Netlify `SUPABASE_SERVICE_ROLE_KEY` → redeploy.
- Update local `.env` and `_backup_private/run-backup.mjs` usage.
- The old key is now dead even though it still sits in git history.

### 5. Post-merge cleanup

- **Delete** Netlify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — no code
  references them any more; `VITE_SUPABASE_ANON_KEY` still holds the legacy
  service_role value and is a footgun.
- Hardcoded service_role key was removed from 14 maintenance scripts (they now
  read `process.env`). `git filter-repo` to purge from history is optional — the
  JWT-secret rotation (step 4) makes the historical value dead.
- `survay1class/` mini-app: its `supabase.js` also shipped the service_role key —
  now a placeholder. That mini-app is broken until given a real anon key or
  pointed at `/api`. Decide whether it's still needed.

### 6. Follow-ups (separate work, not blocking this merge)

- ~~**Gemini API keys leak**~~ ✅ FIXED 2026-09-01 (branch `perf/gemini-proxy`):
  in-app analysis now calls `POST /api/gemini` (edge + lambda gateway, key rotation
  on 429); semester-start batch runs on the office PC via `run_batch.mjs` +
  `run-analysis.bat`. Keys live only in Netlify env `GEMINI_API_KEYS` and the
  office PC `.env` — 0 keys in the bundle. Keys are free-tier so not rotated.
  Note: student PII (name, survey answers, records) is still sent to Google's
  Gemini API; free tier means Google may use it to improve products.
- Phase 2: tighten the authorization matrix to per-row ownership / role rules
  (currently any authenticated teacher can read all app tables & write records —
  same as the old effective behavior, but now gated by a real session).
- Phase 2: restore realtime notifications via `VITE_REALTIME_ANON_KEY` (a real
  anon key) + Realtime-visible RLS policies.
- Mark `AUTH_SIGNING_SECRET` as a Netlify secret (Options → edit).

---

## Status (2026-08-31)

- Branch `security-proxy-refactor` rebased onto `origin/main` (v5.06 — local was
  50 commits behind; that would have reverted production).
- Netlify env set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret),
  `AUTH_SIGNING_SECRET`, `VITE_PUBLIC_SUPABASE_URL`.
- Branch deploy enabled; **Deploy Preview live:**
  https://security-proxy-refactor--1cl.netlify.app/
- **Verified:** build passes secret scan · gateway function deployed ·
  `/api/login` rejects unknown emails (401 `not_registered`) · `/api/rest/*`
  and `/api/session` reject missing/invalid tokens (401) · **0 Supabase JWTs in
  any deployed bundle** (was: service_role key in `supabase-*.js`).
- **Remaining before merge:** run the functional checklist above on the Deploy
  Preview with a real teacher login.

---

## DONE (2026-08-31)

| Step | Status |
|---|---|
| GitHub repo `gapbbong/oneclass` → **private** | ✅ (was public for months — root cause of key discovery) |
| Gateway merged to `main` (v5.08), deployed to `1cl.netlify.app` | ✅ — **0 Supabase JWTs in production bundle** |
| Functional test (teacher login → class list → records → surveys) on preview | ✅ user-confirmed |
| Supabase: switched gateway to new `sb_secret_...` key (Netlify env) | ✅ — gateway verified working with it in production |
| Supabase: **legacy anon + service_role JWT keys DISABLED** | ✅ — old leaked key now returns `401 "Legacy API keys are disabled"` |
| records pagination + record-page back-nav (v5.07) | ✅ merged & deployed |

### Still open (tracked as separate tasks)

1. **Gemini API keys** still inlined in `assets/analysis-*.js` (Netlify `VITE_GEMINI_API_KEY`).
   Proxy server-side + rotate the 3 keys.
2. **Daily DB backup** dead since 2026-04-12. Revive (GitHub Actions cron likely
   auto-disabled) + add a local mirror. Also: move `backups/` (student PII) out of
   the repo, and update the GitHub Actions secrets to the new `sb_secret` key.
3. Local `.env` → paste the new `sb_secret_...` into `SUPABASE_SERVICE_ROLE_KEY`
   before running `_backup_private/run-backup.mjs` or any `backup_db*.js`.
4. Delete merged branches `security-proxy-refactor`, `fix/records-page`, and the
   `security-proxy-refactor` branch-deploy entry in Netlify.
5. Optional: `git filter-repo` to purge the old service_role key from git history
   (low priority — the key is disabled, and the repo is now private).
6. Phase 2: tighten the gateway authorization matrix (per-row / role rules);
   restore realtime via `VITE_REALTIME_ANON_KEY` + a publishable key.
