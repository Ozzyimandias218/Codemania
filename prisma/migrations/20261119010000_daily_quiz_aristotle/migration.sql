-- AlterEnum
ALTER TYPE "public"."VoiceContentType" ADD VALUE IF NOT EXISTS 'ARISTOTLE_TEMPLATE';

-- CreateEnum
CREATE TYPE "public"."DisplayNameStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."DailyQuizStatus" AS ENUM ('BUFFERED', 'LIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."DailyQuestionType" AS ENUM ('ESTIMATE', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "public"."DailyQuestionOrigin" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "public"."DailyQuestionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."LeaderboardPeriod" AS ENUM ('DAILY', 'WEEKLY', 'ALL_TIME');

-- CreateEnum
CREATE TYPE "public"."AristotleTemplateKey" AS ENUM ('INTRO', 'FEEDBACK_CORRECT', 'FEEDBACK_INCORRECT', 'FEEDBACK_TIMEOUT', 'RESULT_SUMMARY');

-- AlterTable
ALTER TABLE "public"."User"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "displayNameStatus" "public"."DisplayNameStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "country" TEXT;

-- CreateTable
CREATE TABLE "public"."DailyQuiz" (
    "id" TEXT NOT NULL,
    "quizDate" TEXT NOT NULL,
    "status" "public"."DailyQuizStatus" NOT NULL DEFAULT 'BUFFERED',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "usedReserveFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyQuestion" (
    "id" TEXT NOT NULL,
    "dailyQuizId" TEXT,
    "position" INTEGER,
    "type" "public"."DailyQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "codeSnippet" TEXT,
    "spokenText" TEXT,
    "options" JSONB,
    "correctAnswer" TEXT NOT NULL,
    "numericAnswer" DOUBLE PRECISION,
    "scale" DOUBLE PRECISION,
    "explanation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "license" TEXT,
    "status" "public"."DailyQuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "generatedBy" "public"."DailyQuestionOrigin" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "lastUsedDate" TEXT,
    "isReserve" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyQuizId" TEXT NOT NULL,
    "quizDate" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPosition" INTEGER NOT NULL DEFAULT 1,
    "currentQuestionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "totalTimeMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "givenValue" TEXT,
    "score" INTEGER NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" "public"."LeaderboardPeriod" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "country" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AristotleTemplate" (
    "id" TEXT NOT NULL,
    "key" "public"."AristotleTemplateKey" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "voiceId" TEXT NOT NULL DEFAULT 'aristotle',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AristotleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "quizDate" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyQuiz_quizDate_key" ON "public"."DailyQuiz"("quizDate");

-- CreateIndex
CREATE INDEX "DailyQuiz_status_quizDate_idx" ON "public"."DailyQuiz"("status", "quizDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyQuestion_dailyQuizId_position_key" ON "public"."DailyQuestion"("dailyQuizId", "position");

-- CreateIndex
CREATE INDEX "DailyQuestion_fingerprint_createdAt_idx" ON "public"."DailyQuestion"("fingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "DailyQuestion_status_isReserve_lastUsedDate_idx" ON "public"."DailyQuestion"("status", "isReserve", "lastUsedDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAttempt_userId_quizDate_key" ON "public"."DailyAttempt"("userId", "quizDate");

-- CreateIndex
CREATE INDEX "DailyAttempt_quizDate_totalScore_totalTimeMs_idx" ON "public"."DailyAttempt"("quizDate", "totalScore" DESC, "totalTimeMs" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnswer_attemptId_questionId_key" ON "public"."DailyAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "DailyAnswer_attemptId_position_idx" ON "public"."DailyAnswer"("attemptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_userId_period_periodKey_key" ON "public"."LeaderboardEntry"("userId", "period", "periodKey");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_period_periodKey_score_timeMs_userId_idx" ON "public"."LeaderboardEntry"("period", "periodKey", "score" DESC, "timeMs" ASC, "userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AristotleTemplate_key_key" ON "public"."AristotleTemplate"("key");

-- CreateIndex
CREATE INDEX "AdminAlert_resolvedAt_createdAt_idx" ON "public"."AdminAlert"("resolvedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."DailyQuestion" ADD CONSTRAINT "DailyQuestion_dailyQuizId_fkey" FOREIGN KEY ("dailyQuizId") REFERENCES "public"."DailyQuiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyAttempt" ADD CONSTRAINT "DailyAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyAttempt" ADD CONSTRAINT "DailyAttempt_dailyQuizId_fkey" FOREIGN KEY ("dailyQuizId") REFERENCES "public"."DailyQuiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyAnswer" ADD CONSTRAINT "DailyAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."DailyAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyAnswer" ADD CONSTRAINT "DailyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."DailyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
