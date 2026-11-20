-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."LevelType" AS ENUM ('LESSON', 'CHECKPOINT');

-- CreateEnum
CREATE TYPE "public"."QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TYPE_OUTPUT');

-- CreateEnum
CREATE TYPE "public"."QuestionOrigin" AS ENUM ('AUTHORED', 'WEB');

-- CreateEnum
CREATE TYPE "public"."QuestionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."AttemptStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PlacementStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."CommitmentMode" AS ENUM ('SIMULATED', 'DEPOSIT_REFUND', 'PENALTY');

-- CreateEnum
CREATE TYPE "public"."MissedDayMode" AS ENUM ('INACTIVE_DAYS', 'LATE_DAYS');

-- CreateEnum
CREATE TYPE "public"."CommitmentStatus" AS ENUM ('PENDING_PAYMENT_METHOD', 'ACTIVE', 'COMPLETED', 'PENALTY_DUE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PenaltyType" AS ENUM ('DAILY_MISSED', 'LATE_DAY', 'FINAL_FAIL');

-- CreateEnum
CREATE TYPE "public"."FinalSubmissionType" AS ENUM ('EXAM', 'PROJECT');

-- CreateEnum
CREATE TYPE "public"."FinalSubmissionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."AppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."VoiceContentType" AS ENUM ('QUESTION_PROMPT', 'EXPLANATION', 'LESSON_TEXT');

-- CreateEnum
CREATE TYPE "public"."VoiceAssetStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isAdult" BOOLEAN NOT NULL DEFAULT false,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastStreakDate" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Track" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "levelCount" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrackPrerequisite" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "requiredTrackId" TEXT NOT NULL,
    "requiredPoints" INTEGER NOT NULL,

    CONSTRAINT "TrackPrerequisite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Unit" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Level" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "public"."LevelType" NOT NULL,
    "title" TEXT,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Question" (
    "id" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "questionGroupId" TEXT NOT NULL,
    "type" "public"."QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "codeSnippet" TEXT,
    "spokenText" TEXT,
    "options" JSONB,
    "answer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "origin" "public"."QuestionOrigin" NOT NULL DEFAULT 'AUTHORED',
    "sourceUrl" TEXT,
    "license" TEXT,
    "status" "public"."QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserLevelProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "passedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viaPlacement" BOOLEAN NOT NULL DEFAULT false,
    "bestScorePct" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "UserLevelProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Attempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "type" "public"."LevelType" NOT NULL,
    "status" "public"."AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "heartsRemaining" INTEGER NOT NULL DEFAULT 5,
    "xpEarned" INTEGER NOT NULL DEFAULT 0,
    "questionIds" JSONB NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AnswerSubmission" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "submittedAnswer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PointEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReviewQueueItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "wrongCount" INTEGER NOT NULL DEFAULT 1,
    "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
    "intervalStage" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlacementTest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "targetUnitId" TEXT NOT NULL,
    "targetUnitOrder" INTEGER NOT NULL,
    "questionIds" JSONB NOT NULL,
    "status" "public"."PlacementStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "scorePct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PlacementTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Commitment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "mode" "public"."CommitmentMode" NOT NULL,
    "missedDayMode" "public"."MissedDayMode" NOT NULL,
    "dailyPenaltyCents" INTEGER NOT NULL DEFAULT 100,
    "finalFailPenaltyCents" INTEGER NOT NULL,
    "depositCents" INTEGER,
    "maxTotalPenaltyCents" INTEGER NOT NULL,
    "excusedDaysAllowed" INTEGER NOT NULL DEFAULT 2,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "public"."CommitmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT_METHOD',
    "termsVersion" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "requiredLevelsPerDay" DOUBLE PRECISION NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeSetupIntentId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripeDepositPaymentIntentId" TEXT,
    "stripePenaltyPaymentIntentId" TEXT,
    "penaltyRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastPenaltyAttemptAt" TIMESTAMP(3),
    "needsAdminAttention" BOOLEAN NOT NULL DEFAULT false,
    "hasActiveAppeal" BOOLEAN NOT NULL DEFAULT false,
    "finalPassedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommitmentPenalty" (
    "id" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "type" "public"."PenaltyType" NOT NULL,
    "date" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitmentPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FinalSubmission" (
    "id" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."FinalSubmissionType" NOT NULL,
    "status" "public"."FinalSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "questionIds" JSONB,
    "answers" JSONB,
    "scorePct" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "projectUrl" TEXT,
    "projectNotes" TEXT,
    "reviewerId" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Appeal" (
    "id" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "finalSubmissionId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "public"."AppealStatus" NOT NULL DEFAULT 'PENDING',
    "adminDecisionNotes" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VoiceAsset" (
    "id" TEXT NOT NULL,
    "contentType" "public"."VoiceContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "audioUrl" TEXT,
    "transcript" TEXT NOT NULL,
    "status" "public"."VoiceAssetStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "public"."RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "public"."RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_slug_key" ON "public"."Track"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Track_order_key" ON "public"."Track"("order");

-- CreateIndex
CREATE UNIQUE INDEX "TrackPrerequisite_trackId_requiredTrackId_key" ON "public"."TrackPrerequisite"("trackId", "requiredTrackId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_trackId_order_key" ON "public"."Unit"("trackId", "order");

-- CreateIndex
CREATE INDEX "Level_unitId_idx" ON "public"."Level"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Level_trackId_number_key" ON "public"."Level"("trackId", "number");

-- CreateIndex
CREATE INDEX "Question_levelId_status_origin_isLatest_idx" ON "public"."Question"("levelId", "status", "origin", "isLatest");

-- CreateIndex
CREATE INDEX "Question_questionGroupId_idx" ON "public"."Question"("questionGroupId");

-- CreateIndex
CREATE INDEX "Question_status_idx" ON "public"."Question"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "public"."AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "public"."AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "UserLevelProgress_userId_trackId_idx" ON "public"."UserLevelProgress"("userId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "UserLevelProgress_userId_levelId_key" ON "public"."UserLevelProgress"("userId", "levelId");

-- CreateIndex
CREATE INDEX "Attempt_userId_levelId_idx" ON "public"."Attempt"("userId", "levelId");

-- CreateIndex
CREATE INDEX "AnswerSubmission_userId_questionId_idx" ON "public"."AnswerSubmission"("userId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerSubmission_attemptId_questionId_key" ON "public"."AnswerSubmission"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "PointEvent_userId_trackId_idx" ON "public"."PointEvent"("userId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "PointEvent_userId_trackId_levelNumber_key" ON "public"."PointEvent"("userId", "trackId", "levelNumber");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_userId_nextReviewAt_idx" ON "public"."ReviewQueueItem"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewQueueItem_userId_questionId_key" ON "public"."ReviewQueueItem"("userId", "questionId");

-- CreateIndex
CREATE INDEX "PlacementTest_userId_trackId_idx" ON "public"."PlacementTest"("userId", "trackId");

-- CreateIndex
CREATE INDEX "Commitment_userId_idx" ON "public"."Commitment"("userId");

-- CreateIndex
CREATE INDEX "Commitment_status_idx" ON "public"."Commitment"("status");

-- CreateIndex
CREATE INDEX "CommitmentPenalty_commitmentId_idx" ON "public"."CommitmentPenalty"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CommitmentPenalty_commitmentId_type_date_key" ON "public"."CommitmentPenalty"("commitmentId", "type", "date");

-- CreateIndex
CREATE INDEX "FinalSubmission_commitmentId_type_idx" ON "public"."FinalSubmission"("commitmentId", "type");

-- CreateIndex
CREATE INDEX "Appeal_commitmentId_status_idx" ON "public"."Appeal"("commitmentId", "status");

-- CreateIndex
CREATE INDEX "VoiceAsset_contentType_contentId_idx" ON "public"."VoiceAsset"("contentType", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceAsset_contentType_contentId_language_voiceId_textHash_key" ON "public"."VoiceAsset"("contentType", "contentId", "language", "voiceId", "textHash");

-- AddForeignKey
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrackPrerequisite" ADD CONSTRAINT "TrackPrerequisite_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrackPrerequisite" ADD CONSTRAINT "TrackPrerequisite_requiredTrackId_fkey" FOREIGN KEY ("requiredTrackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Unit" ADD CONSTRAINT "Unit_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Level" ADD CONSTRAINT "Level_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Level" ADD CONSTRAINT "Level_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Question" ADD CONSTRAINT "Question_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "public"."Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserLevelProgress" ADD CONSTRAINT "UserLevelProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserLevelProgress" ADD CONSTRAINT "UserLevelProgress_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "public"."Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserLevelProgress" ADD CONSTRAINT "UserLevelProgress_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "public"."Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnswerSubmission" ADD CONSTRAINT "AnswerSubmission_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnswerSubmission" ADD CONSTRAINT "AnswerSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnswerSubmission" ADD CONSTRAINT "AnswerSubmission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PointEvent" ADD CONSTRAINT "PointEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PointEvent" ADD CONSTRAINT "PointEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlacementTest" ADD CONSTRAINT "PlacementTest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlacementTest" ADD CONSTRAINT "PlacementTest_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlacementTest" ADD CONSTRAINT "PlacementTest_targetUnitId_fkey" FOREIGN KEY ("targetUnitId") REFERENCES "public"."Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commitment" ADD CONSTRAINT "Commitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commitment" ADD CONSTRAINT "Commitment_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "public"."Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommitmentPenalty" ADD CONSTRAINT "CommitmentPenalty_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "public"."Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FinalSubmission" ADD CONSTRAINT "FinalSubmission_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "public"."Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FinalSubmission" ADD CONSTRAINT "FinalSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appeal" ADD CONSTRAINT "Appeal_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "public"."Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appeal" ADD CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appeal" ADD CONSTRAINT "Appeal_finalSubmissionId_fkey" FOREIGN KEY ("finalSubmissionId") REFERENCES "public"."FinalSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

