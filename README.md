# Codemania Backend

Backend-only API for **Codemania**, a gamified programming-learning platform built with Node.js, TypeScript, Express, PostgreSQL (Prisma), Zod, JWT (access + refresh rotation), BullMQ, Stripe, and a HuggingFace TTS adapter.

## Architecture

Layered backend structure under `src/backend/`:

- `config/` — Zod-validated environment configuration (`env.ts`), Prisma client singleton (`prisma.ts`), and Redis connection helper (`redis.ts`).
- `routes/` — Express routers with Zod validation (`validateBody`, `validateQuery`), auth/admin middleware, and rate limiting.
- `controllers/` — HTTP request/response handlers.
- `services/` — Business logic (Auth, Tracks/Placement, Checkpoints, Game rules, Commitments, Stripe billing, Admin moderation, Voice/TTS).
- `repositories/` — Prisma database persistence and idempotent transaction helpers.
- `jobs/` — BullMQ queues and background workers (`voice-generation`, `commitment-daily-eval`, `penalty-retry`, `commitment-close`).
- `prisma/` — `schema.prisma`, initial PostgreSQL migration (`prisma/migrations/20261119000000_init/migration.sql`), and `seed.ts`.
- `tests/` — Vitest unit test suites.

## Prerequisites

- Node.js 20+ (tested on v22)
- PostgreSQL 15+
- Redis 7+ (required for BullMQ background workers; API runs without Redis with workers disabled when `REDIS_URL` is empty)

## Setup & Run Steps

1. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Fill in `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and (optionally) `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `HF_ENDPOINT_URL`, `HF_TOKEN`.

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Generate Prisma client & apply PostgreSQL migrations**:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

4. **Seed tracks, units, levels, sample questions, and admin user**:
   ```bash
   npm run prisma:seed
   ```
   Seed creates:
   - `Python` track: 50 levels (5 units × 10 levels, checkpoints at `5, 10, ..., 50`, `maxPoints = 5`).
   - `JavaScript [PLACEHOLDER]` track: 50 placeholder levels (`isPlaceholder: true`, requires 5 Python points).
   - `C++ [PLACEHOLDER]` track: 50 placeholder levels (`isPlaceholder: true`, requires all 5 JavaScript points).

5. **Run unit tests & typecheck**:
   ```bash
   npm test
   npm run lint
   ```

6. **Start the server**:
   ```bash
   npm run dev
   ```
   Server listens on `http://0.0.0.0:${PORT}` (default `3000`). Health check: `GET /health`.

## API Endpoints

### Auth
- `POST /auth/register` — `{ email, password, name?, timezone?, isAdult }`
- `POST /auth/login` — `{ email, password }`
- `POST /auth/refresh` — `{ refreshToken }`
- `POST /auth/logout` — `{ refreshToken }`

### Tracks, Levels, Placement & Gameplay
- `GET /tracks` — Returns `{ unlocked, lockedReason, userPoints, maxPoints }` per track
- `GET /tracks/:slug/levels` — Track units and levels with per-level unlock/passed status
- `POST /tracks/:slug/placement-test` — `{ targetUnitOrder }` (starts unit-level placement test)
- `POST /tracks/:slug/placement-test/:testId/submit` — `{ answers }` (marks earlier levels passed with 0 XP / 0 points)
- `POST /levels/:id/attempts` — Starts a lesson or checkpoint attempt (questions stripped of `answer` and `explanation`)
- `POST /attempts/:id/answers` — `{ questionId, answer }` (hearts, XP, review queue update, returns explanation)
- `POST /attempts/:id/finish` — Evaluates pass mark (66% lesson / 70% checkpoint), completion XP (+20 / +50), daily streak, and `PointEvent` (`level % 10 === 0`)

### User (`/me`)
- `GET /me/stats` — XP, effective streak, longest streak, total points, passed levels count
- `GET /me/points` — Points summary per track + immutable `PointEvent` history
- `GET /me/review-queue` — Active spaced-repetition items with `nextReviewAt`
- `PATCH /me/profile` — `{ displayName, country? }` (moderated against profanity for leaderboard eligibility)

### Daily Quiz: "Aristotle" (`/daily` & `/leaderboard`)
- `GET /daily/today` — Current server-time `quizDate` in `DAILY_TZ`, state (`NOT_STARTED | IN_PROGRESS | DONE`), `timeRemainingSeconds`, score if completed, and Aristotle intro
- `POST /daily/start` — Creates single daily attempt (`409` on retry) and returns question 1 without answer or explanation
- `GET /daily/question` — Returns current question without answer or explanation and server-computed `timeRemainingSeconds`
- `POST /daily/answer` — `{ questionId, givenValue, quizDate? }` (ignores client timestamps; enforces `DAILY_QUESTION_SECONDS`, scores ESTIMATE/MULTIPLE_CHOICE, reveals answer + explanation + Aristotle feedback for submitted question)
- `GET /daily/result` — Reveals all 7 answers, explanations, and Aristotle summary only after attempt completion (`403` if unfinished)
- `GET /leaderboard?period=daily|weekly|all-time&limit=&cursor=` — Keyset cursor-paginated leaderboard (score DESC, timeMs ASC) filtered to moderated `displayName`s
- `GET /leaderboard/me?period=daily|weekly|all-time` — Caller's rank and `±2` neighbors

### Commitment Contracts
- `POST /commitments` — Requires `isAdult = true`; computes `requiredLevelsPerDay`; rejects above `MAX_LEVELS_PER_DAY` unless `acknowledgePace: true`; creates Stripe setup Checkout Session when `mode != SIMULATED`
- `GET /commitments` / `GET /commitments/:id` — Lists/retrieves commitments, penalty ledger, and suggested deposit refund
- `POST /commitments/:id/final-exam/start` — Starts timed randomized final exam (max 2 attempts)
- `POST /commitments/:id/final-submission` — Submits `EXAM` answers or `PROJECT` URL/notes
- `POST /commitments/:id/appeal` — Files appeal, setting `hasActiveAppeal = true` (freezes Stripe charging until admin resolves)

### Voice-Over
- `GET /questions/:id/audio` — Returns `QUESTION_PROMPT` audio asset metadata/URL (never embeds answer or reads `codeSnippet` verbatim)
- `GET /questions/:id/explanation-audio` — Returns `403` until the authenticated user has submitted an answer to question `:id`

### Admin (`role = ADMIN`)
- `GET /admin/questions` / `POST /admin/questions` / `PATCH /admin/questions/:id`
- `POST /admin/questions/:id/review` — `{ decision: "APPROVED" | "REJECTED", reason }`
- `GET /admin/audit-logs`
- `GET /admin/final-submissions` / `POST /admin/final-submissions/:id/review`
- `POST /admin/commitments/:id/penalties/:penaltyId/void`
- `POST /admin/commitments/:id/refund-deposit`
- `GET /admin/daily/questions` / `POST /admin/daily/questions` / `POST /admin/daily/questions/:id/review`
- `GET /admin/daily/buffer` / `GET /admin/daily/reserve` / `POST /admin/daily/quizzes/:quizDate/publish` / `POST /admin/daily/scheduler/run`
- `GET /admin/daily/templates` / `PUT /admin/daily/templates/:key`
- `GET /admin/daily/alerts` / `POST /admin/daily/alerts/:id/resolve`

### Webhooks
- `POST /webhooks/stripe` — Raw-body Stripe signature verification (`stripe-signature`)

---

## Ambiguities & Assumptions Made

1. **HuggingFace TTS API Contract (`src/backend/services/tts/huggingface.adapter.ts`)**: The exact endpoint request/response contract was left to be supplied later. All request/response mapping is isolated in `HuggingFaceTtsProvider`, assuming JSON `{ inputs, parameters: { language, voice_id } }` returning either `{ audio_url }` / `{ url }` or binary audio bytes mapped to `AUDIO_PUBLIC_BASE_URL/${assetId}.wav`.
2. **Checkpoint Question Pool & WEB Addition**: It was ambiguous whether the up to 5 approved `WEB` questions are *part of* or *in addition to* the max 20 authored questions. Implemented as max 20 authored + up to 5 approved WEB questions (max 25 total), shuffled.
3. **JavaScript & C++ Track Placeholder Level Counts**: Marked explicitly with `isPlaceholder: true` and `[PLACEHOLDER]` titles at 50 levels each (`maxPoints = 5`) so Python (5 points) -> JavaScript (5 points) -> C++ works end-to-end.
4. **Placement Test Pass Mark & Skipped Range**: Placement tests assume a 70% pass threshold, sample up to 3 approved authored questions per earlier unit, and passing for `targetUnitOrder` marks all levels in units `< targetUnitOrder` as passed (`viaPlacement: true`, 0 XP, 0 points).
5. **Replaying Passed Levels & Streak/XP**: Passing an already-passed level awards attempt/completion XP and updates the daily streak, while `PointEvent` remains strictly once per `(userId, trackId, levelNumber)`. Placement tests do not advance the daily streak.
6. **Review Queue in Lesson Attempts**: Assumed up to 3 due (`nextReviewAt <= now`) review-queue questions from the same track are appended to regular lesson attempts so wrong answers return at `+1d`, `+3d`, `+7d` until 2 consecutive correct answers.
7. **`LATE_DAYS` vs `excusedDaysAllowed` & Grace Period**: Applied `excusedDaysAllowed` strictly to `INACTIVE_DAYS` (as specified), started `LATE_DAYS` counting after `deadline + 24h grace`, and applied at most one `FINAL_FAIL` penalty after `deadline + 24h grace`.
8. **`INACTIVE_DAYS` Track Scoping**: Counted only non-placement passed levels belonging to the commitment's `trackId` when determining active days.
9. **`DEPOSIT_REFUND` Settlement**: Penalty ledger entries are computed identically across all modes, automatic off-session close-out charging runs only for `PENALTY` mode, and `DEPOSIT_REFUND` exposes `suggestedDepositRefundCents = depositCents - totalActivePenaltyCents` for the manual admin refund endpoint (`POST /admin/commitments/:id/refund-deposit`).
10. **Editing Approved Questions**: Creating a new version (`version + 1`) on an admin edit of an `APPROVED` question supersedes the previous version (`isLatest = false`), sets the new version `APPROVED`, logs an `AuditLog` entry, and immediately re-queues voice generation.
11. **Web Question Verbatim Check**: Without fetching external third-party URLs at submission time, the backend enforces `sourceUrl` + `license` presence, forces `origin = WEB` questions into `DRAFT`, and requires admin review with reason before approval.
12. **Admin Seeding & Assignment**: Users registering with an email listed in `ADMIN_EMAILS` receive `ADMIN` role automatically; `prisma/seed.ts` also seeds a default admin account for local testing.
13. **Aristotle Daily Quiz — `WEEKLY` / `ALL_TIME` Leaderboard Aggregation & Multiple Choice Key**: `DAILY` leaderboard stores that `quizDate`'s attempt score/time; `WEEKLY` (ISO week `YYYY-Www` in `DAILY_TZ`) and `ALL_TIME` accumulate completed daily attempt scores and times. `MULTIPLE_CHOICE` `DailyQuestion.correctAnswer` stores the `"0"`..`"3"` option index string, and `ESTIMATE` sanity range bounds `|numericAnswer| <= 1000 * scale`. Code-output sandbox execution uses an isolated `node:vm` JS context (`console.log` capture) with zero host globals.
