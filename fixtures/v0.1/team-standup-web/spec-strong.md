# Async Standup — Implementation Specification

## 1. Overview
Async Standup is a web app for small teams (2–25 people) to post a daily written standup instead of meeting. Each weekday a member answers three questions (yesterday, today, blockers). The team lead reviews every member's answers for a day on one page and gets a Slack message whenever a blocker is posted. Teams are private to their members, and entries older than 90 days are deleted automatically. Goal: a member posts in under a minute; a lead reviews the whole team in one screen.

## 2. Scope
**In scope**
- Sign-in with Google or an email magic link.
- One team per user; a lead creates the team and invites members by email.
- Weekday standup form (yesterday, today, blockers) with edit until the end of that day.
- Lead's team day page for any day in the last 90 days.
- Slack message to the lead's configured channel when a blocker is posted.
- Team-only visibility, 90-day retention with automatic deletion.

**Out of scope**
- Other sign-in providers (GitHub, Microsoft), passwords.
- Multiple teams per user, cross-team views, analytics, AI summaries, mood tracking.
- Native mobile apps (the web UI is responsive).
- Reminders and notifications other than the blocker Slack message.

## 3. Requirements
- **R1** — A user can sign in with Google.
- **R2** — A user can sign in with a one-time email magic link.
- **R3** — On each weekday (Mon–Fri in the team's time zone), a member can submit one standup with three answers: yesterday, today, blockers.
- **R4** — The team lead can view all members' standups for a selected day on one page.
- **R5** — When a standup is saved with a non-empty blocker, the lead receives a Slack message in the team's configured channel.
- **R6** — A user can only read standups belonging to their own team.
- **R7** — Standups dated more than 90 days ago are permanently deleted.

## 4. Architecture
Next.js App Router monolith deployed on Vercel, PostgreSQL on Supabase accessed only from the server through Prisma.

| Component | Responsibility | Talks to |
|---|---|---|
| `app/(auth)` routes + Auth.js | Sign-in, sign-out, sessions (database sessions) | PostgreSQL, Google OAuth, Resend |
| `app/(app)` server components | Render Today, Team day, Team settings pages | `lib/standups`, `lib/teams` |
| Server actions (`app/(app)/**/actions.ts`) | Validate input (Zod), authorize, write data | `lib/*`, `lib/slack` |
| `lib/authz.ts` | Every data access goes through `requireMember()` / `requireLead()`; scopes queries by `teamId` | Auth.js session |
| `lib/standups.ts`, `lib/teams.ts` | Data access with Prisma, always filtered by `teamId` | PostgreSQL |
| `lib/slack.ts` | Sends blocker messages to the team webhook with timeout and retry | Slack incoming webhook |
| `lib/crypto.ts` | AES-256-GCM encrypt/decrypt of the Slack webhook URL | env `WEBHOOK_ENC_KEY` |
| `app/api/cron/retention/route.ts` | Daily deletion of standups older than 90 days | PostgreSQL |
| `app/api/cron/slack-retry/route.ts` | Retries failed Slack deliveries | `lib/slack`, PostgreSQL |

**Data flow**
- *Post standup:* member submits form → `saveStandup` action → Zod validation → `requireMember()` → upsert `Standup` for (userId, date) → if `blockers` changed from empty to non-empty, insert `SlackDelivery(pending)` and call `lib/slack` → mark `sent` or `failed` → `revalidatePath` → page shows the saved standup.
- *Team day view:* lead opens `/team/[date]` → `requireLead()` → query members and their standups for `teamId` and date → render cards.
- *Retention:* Vercel Cron 03:00 UTC → route verifies `CRON_SECRET` → `DELETE FROM Standup WHERE date < today_utc - 90 days` (and related `SlackDelivery` rows) → logs count.

## 5. Tech stack
- Next.js 15 (App Router, server actions), React 19, TypeScript 5.6 (strict).
- Tailwind CSS 4 for styling.
- Auth.js v5 (`next-auth@5`) with Google provider and Email provider; `@auth/prisma-adapter`; database sessions.
- Prisma 6 with PostgreSQL 16 (Supabase, connection pooling via Supavisor).
- Resend for magic-link emails.
- Zod 3 for input validation; `date-fns-tz` for time-zone math.
- Vitest for unit/integration tests; Playwright for end-to-end tests.
- Vercel hosting and Vercel Cron.

## 6. Data model
Prisma schema (`prisma/schema.prisma`). Auth.js tables (`Account`, `Session`, `VerificationToken`) follow the adapter's standard schema.

**User**
| Field | Type | Required | Rule |
|---|---|---|---|
| id | String (cuid) | yes | PK |
| email | String | yes | unique, lowercased |
| name | String | no | from Google or entered at first sign-in |
| teamId | String | no | FK → Team; null until the user creates or joins a team |
| role | enum `MEMBER` \| `LEAD` | yes | default `MEMBER` |
| createdAt | DateTime | yes | now() |

**Team**
| Field | Type | Required | Rule |
|---|---|---|---|
| id | String (cuid) | yes | PK |
| name | String | yes | 1–60 chars |
| timeZone | String | yes | IANA name, default `America/New_York`, set by the lead |
| slackWebhookEnc | String | no | AES-256-GCM ciphertext of the webhook URL |
| createdAt | DateTime | yes | now() |

**Invite**
| Field | Type | Required | Rule |
|---|---|---|---|
| id | String (cuid) | yes | PK |
| teamId | String | yes | FK → Team, cascade delete |
| email | String | yes | lowercased; unique per (teamId, email) |
| expiresAt | DateTime | yes | createdAt + 7 days |
| acceptedAt | DateTime | no | set on join |

**Standup**
| Field | Type | Required | Rule |
|---|---|---|---|
| id | String (cuid) | yes | PK |
| userId | String | yes | FK → User, cascade delete |
| teamId | String | yes | FK → Team, cascade delete |
| date | Date | yes | the day in the team's time zone |
| yesterday | String | yes | 1–2,000 chars |
| today | String | yes | 1–2,000 chars |
| blockers | String | no | 0–2,000 chars; empty = no blocker |
| createdAt / updatedAt | DateTime | yes | automatic |
Unique index on (userId, date); index on (teamId, date).

**SlackDelivery**
| Field | Type | Required | Rule |
|---|---|---|---|
| id | String (cuid) | yes | PK |
| standupId | String | yes | FK → Standup, cascade delete |
| status | enum `PENDING` \| `SENT` \| `FAILED` | yes | default `PENDING` |
| attempts | Int | yes | default 0, max 5 |
| lastError | String | no | truncated to 500 chars |

Relationships: Team 1–n User, Team 1–n Invite, Team 1–n Standup, User 1–n Standup, Standup 1–n SlackDelivery. Deleting a Team cascades to invites and standups; users are detached (`teamId` set null). A lead cannot leave a team that still has members (must transfer the lead role first).

**Migrations:** Prisma Migrate. Every schema change is a new migration in `prisma/migrations/`, reviewed in PR, applied in CI with `prisma migrate deploy` before the Vercel build. No manual edits to the production schema.

## 7. Screens & UX states
Navigation: unauthenticated users land on `/signin`. After sign-in: users without a team go to `/onboarding`; members go to `/today`; leads go to `/team/today`. A top bar links **Today**, **Team** (lead only), **Settings** (lead only), and **Sign out**.

| Screen | Content & actions | Loading | Empty | Error |
|---|---|---|---|---|
| `/signin` | "Continue with Google" button; email field + "Email me a link" | Button spinner while redirecting/sending | — | Inline message for sign-in errors (see §10) |
| `/signin/check-email` | "Check your inbox at {email}", resend link after 60 s | — | — | "Couldn't send the email. Try again." |
| `/onboarding` | Create a team (name, time zone) or "Waiting for an invite" | Button spinner | — | Inline validation errors |
| `/today` (member & lead) | Form: Yesterday, Today, Blockers (optional), Submit/Update; shows "Posted at 9:14" after save; on weekends shows "No standup needed today" | Skeleton form while loading existing answer | Blank form | Toast "Couldn't save. Your text is still here — try again." |
| `/team/[date]` (lead) | Date picker limited to the last 90 days; one card per member with answers; blockers highlighted red; a "Missing" section listing members without a post | Skeleton cards | "No one has posted yet for {date}." | "Couldn't load the team's standups." + Retry button |
| `/settings` (lead) | Team name, time zone, Slack webhook URL (write-only; shows "Connected ✓" + "Send test message"), invite by email, member list with Remove and "Make lead" | Skeletons | "No members yet — invite your team." | Inline field errors; "Slack test failed: {reason}" |

## 8. Implementation plan
**File tree**
```
app/
  (auth)/signin/page.tsx            # sign-in page
  (auth)/signin/check-email/page.tsx
  (app)/layout.tsx                  # top bar, session guard
  (app)/onboarding/page.tsx + actions.ts
  (app)/today/page.tsx + actions.ts # saveStandup
  (app)/team/[date]/page.tsx        # lead day view
  (app)/settings/page.tsx + actions.ts
  api/auth/[...nextauth]/route.ts
  api/cron/retention/route.ts
  api/cron/slack-retry/route.ts
  invite/[id]/page.tsx              # accept invite
auth.ts                             # Auth.js config (Google, Email/Resend)
lib/authz.ts  lib/standups.ts  lib/teams.ts  lib/slack.ts  lib/crypto.ts  lib/dates.ts  lib/validation.ts
prisma/schema.prisma  prisma/migrations/
tests/unit/*.test.ts  tests/integration/*.test.ts  e2e/*.spec.ts
vercel.json                         # cron schedules
```

**Build steps**
1. Scaffold Next.js + TypeScript + Tailwind; add Prisma and a Supabase dev database. *Check:* `npm run build` passes; `prisma migrate dev` creates the schema.
2. Configure Auth.js with Google and Email (Resend) providers and database sessions. *Check:* AC-1 and AC-2 pass locally.
3. Implement `lib/authz.ts`, onboarding (create team), invites, and `/invite/[id]`. *Check:* integration tests for `requireMember`/`requireLead` and invite acceptance pass.
4. Implement `lib/dates.ts` (team-local "today", weekday check) and the `/today` form with `saveStandup`. *Check:* AC-3 passes; `dates.test.ts` passes.
5. Implement `/team/[date]`. *Check:* AC-4 and AC-6 pass.
6. Implement `lib/crypto.ts`, Slack settings, `lib/slack.ts`, `SlackDelivery`, and the retry cron. *Check:* AC-5 and AC-8 pass with a mocked webhook.
7. Implement the retention cron and `vercel.json` schedules. *Check:* AC-7 passes.
8. Add Playwright E2E suite and CI (GitHub Actions: lint, typecheck, Vitest, Playwright against a preview deployment). *Check:* all green.

## 9. Errors & edge cases
| Situation | Behavior |
|---|---|
| Save fails (DB error) | Toast "Couldn't save. Your text is still here — try again."; form keeps its content; nothing partially written (single upsert). |
| Two tabs submit at once | Upsert on (userId, date); last write wins; page shows the saved version after revalidation. |
| Standup edited after the day ends | Rejected: "This day is closed. You can post for today instead." |
| Weekend | `/today` shows "No standup needed today"; the action rejects weekend dates. |
| Slack webhook times out (5 s) or returns non-2xx | Standup is still saved; `SlackDelivery` marked `FAILED`; retry cron (every 15 min) retries up to 5 attempts with backoff; lead's Settings shows "Last Slack delivery failed". |
| Slack webhook revoked (404/410) | Mark `FAILED` without retry; Settings shows "Slack disconnected — add a new webhook". |
| Blocker added, then edited again | Only the first empty→non-empty transition sends a message; later edits do not resend. |
| Member removed from team | Their existing standups remain for the team until retention deletes them; they can no longer read team data. |
| Network loss in the browser | Form submit shows the save-failed toast; text is kept in the form; no offline queue. |
| Retention job fails | Vercel Cron logs error; next daily run deletes everything older than 90 days, so a missed day self-heals. |

**Input validation (Zod, server-side; mirrored client-side)**
| Field | Rule | Error shown |
|---|---|---|
| Yesterday / Today | required, trimmed, 1–2,000 chars | "Please fill this in." / "Keep it under 2,000 characters." |
| Blockers | optional, ≤ 2,000 chars | "Keep it under 2,000 characters." |
| Email (sign-in, invite) | valid email, ≤ 254 chars | "Enter a valid email address." |
| Team name | 1–60 chars | "Team name must be 1–60 characters." |
| Time zone | must be a valid IANA zone from the picker | "Choose a time zone from the list." |
| Slack webhook URL | must start with `https://hooks.slack.com/services/` | "That doesn't look like a Slack incoming webhook URL." |

## 10. Security & privacy
**Authentication states**
- Sign-up = first successful sign-in (Google or magic link) creates the `User`.
- Magic links expire after 10 minutes and are single-use; an expired/used link shows "This link has expired. Request a new one."
- Google sign-in cancelled or failed → back to `/signin` with "Google sign-in didn't complete. Try again."
- Sessions: database sessions, 30-day max age, rolling; cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Expired session → any page redirects to `/signin?expired=1` with "Your session expired. Sign in again."; unsaved form text is kept in `sessionStorage` and restored after sign-in.
- Sign-out deletes the session row and redirects to `/signin`.

**Authorization**
- Every server action and page calls `requireMember()` or `requireLead()`; all queries include `where: { teamId: session.user.teamId }`. There is no endpoint that accepts a `teamId` from the client.
- Supabase anon/public keys are not used; the database is reachable only with the server connection string, and Row Level Security is enabled with no policies for the anon role (deny all) as a second barrier.

**Secrets**
- `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `RESEND_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, `WEBHOOK_ENC_KEY` live only in Vercel environment variables; never exposed with `NEXT_PUBLIC_`.
- Slack webhook URLs are encrypted at rest (AES-256-GCM with `WEBHOOK_ENC_KEY`) and never returned to the browser after saving.
- Logs never include standup text, webhook URLs, or tokens.

**Privacy**
- Collected: email, name, team membership, standup text. Standups are visible only to the author's team.
- Retention: standups deleted after 90 days (R7); a user deleting their account deletes their standups immediately.
- Slack messages contain the member's name and the blocker text only.

## 11. Testing & acceptance criteria
**Strategy**
- Unit (Vitest): `lib/dates` (time zones, weekend, DST), `lib/validation`, `lib/crypto`, `lib/slack` (timeout, retry, 404 handling with mocked `fetch`).
- Integration (Vitest + test PostgreSQL via Docker): `lib/authz` cross-team denial, `saveStandup` upsert and blocker transition, retention deletion boundaries, invite accept/expiry.
- E2E (Playwright): sign-in via a test-only email provider that captures the link, post standup, lead day view, weekend state, session expiry redirect.
- Failure cases: DB error on save, Slack 500/timeout/410, expired magic link, cross-team URL access.

**Acceptance criteria**
- **AC-1** (R1) — Given a Google account, when the user clicks "Continue with Google" and completes consent, then they land on `/onboarding` (no team) or `/today` (has team).
- **AC-2** (R2) — Given the sign-in page, when the user requests a magic link and opens it within 10 minutes, then they are signed in; when they open the same link again, they see "This link has expired. Request a new one."
- **AC-3** (R3) — Given a member on a Tuesday in the team's time zone, when they submit yesterday "API tests", today "Deploy", blockers empty, then `/today` shows "Posted at HH:MM" with those answers, and submitting again updates rather than duplicates.
- **AC-4** (R4) — Given a team with 3 members of whom 2 posted today, when the lead opens `/team/today`, then 2 cards show their answers and the "Missing" section lists the third member.
- **AC-5** (R5) — Given a team with a Slack webhook, when a member saves a standup with blocker "Waiting on DB access", then exactly one POST is sent to the webhook containing the member's name and the blocker text, and editing the blocker afterwards sends no second message.
- **AC-6** (R6) — Given users A (team 1) and B (team 2), when A requests `/team/[date]` or calls any action while B's team has standups, then A sees only team 1 data, and a direct request for a team 2 standup id returns 404.
- **AC-7** (R7) — Given standups dated 91 and 89 days ago, when the retention cron runs, then the 91-day-old standup and its Slack deliveries are deleted and the 89-day-old one remains.
- **AC-8** (R5) — Given the Slack webhook returns HTTP 500, when a blocker is saved, then the standup is saved, the delivery is `FAILED`, and the retry job sends it on a later run once the webhook returns 200.
- **AC-9** (R3) — Given a Saturday in the team's time zone, when a member opens `/today`, then they see "No standup needed today" and no form.

## 12. Assumptions & open questions
- Assumption: each user belongs to at most one team; the creator of a team is its lead; a team can have several leads.
- Assumption: "weekday" and "today" use the team's configured IANA time zone.
- Assumption: invites are sent by email with Resend and expire after 7 days.
- Assumption: the Slack message goes to the channel bound to the team's incoming webhook, which the lead chooses when creating the webhook in Slack.
- Open questions: none blocking.
