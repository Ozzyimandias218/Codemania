-- CreateEnum
CREATE TYPE "StripeWebhookEventStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- AlterTable
ALTER TABLE "StripeWebhookEvent"
ADD COLUMN "status" "StripeWebhookEventStatus" NOT NULL DEFAULT 'PROCESSED',
ADD COLUMN "commitmentId" TEXT,
ADD COLUMN "summary" TEXT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "duplicateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastDuplicateAt" TIMESTAMP(3),
ALTER COLUMN "processedAt" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_status_receivedAt_idx" ON "StripeWebhookEvent"("status", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_receivedAt_idx" ON "StripeWebhookEvent"("receivedAt" DESC);
