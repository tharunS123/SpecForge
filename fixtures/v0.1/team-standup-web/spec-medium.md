# Async Standup — Implementation Specification

## 1. Overview
A web app where members of small teams post a daily standup (yesterday, today, blockers) and the team lead reviews all answers for a day on one page. Blockers trigger a Slack message to the lead.

## 2. Scope
In scope: sign-in with Google or email magic link, daily standup form, team day view, Slack blocker alerts, team-only visibility, 90-day retention.
Out of scope: mobile apps, analytics, multiple teams per user.

## 3. Requirements
- R1: Users sign in with Google.
- R2: Users sign in with an email magic link.
- R3: Each weekday, a member answers yesterday / today / blockers.
- R4: The team lead sees all members' answers for a selected day on one page.
- R5: The lead receives a Slack message when a member posts a blocker.
- R6: Users only see standups from their own team.
- R7: Standups older than 90 days are deleted.

## 4. Architecture
Next.js App Router application. Server components read from PostgreSQL via Prisma. Auth.js handles sign-in. A server action saves standups and, if the blocker field is non-empty, calls the Slack incoming webhook. A daily Vercel Cron job deletes old standups.

## 5. Tech stack
Next.js 15, TypeScript, Tailwind CSS, Auth.js v5 (Google + Email providers), Prisma 6, PostgreSQL (Supabase), Resend for magic-link email, Vercel hosting.

## 6. Data model
- User: id, email, name, teamId, role (member | lead).
- Team: id, name, slackWebhookUrl.
- Standup: id, userId, teamId, date, yesterday, today, blockers, createdAt.
A team has many users; a user has many standups.

## 7. Screens & UX states
- **Sign-in page** — Google button and email field for a magic link.
- **Today page** — the standup form with three text areas and Submit. After submitting, show "Posted" and the answers.
- **Team day page (lead only)** — date picker and one card per member with their answers; members who haven't posted show "No update yet".

## 8. Implementation plan
1. Scaffold Next.js with Tailwind, Prisma, and Auth.js.
2. Create the Prisma schema and run the first migration.
3. Build sign-in with Google and email.
4. Build the Today page and the save action.
5. Build the Team day page.
6. Add the Slack webhook call.
7. Add the retention cron job.

## 9. Errors & edge cases
Show an error toast if saving fails. If Slack is down, log the error. Members can edit today's standup until midnight.

## 10. Security & privacy
All routes require a session. Queries filter by the user's teamId. The Slack webhook URL is stored in the database.

## 11. Testing & acceptance criteria
Some unit tests for the save action and the retention job.
- AC-1: Given a signed-in member, when they submit the form, then their standup appears on the lead's Team day page for today. (R3, R4)
- AC-2: Given a standup with a blocker, when it is submitted, then the lead's Slack channel receives a message. (R5)

## 12. Assumptions & open questions
- How are teams created and members invited? Not decided yet.
- Which time zone defines "today"? Not decided yet.
