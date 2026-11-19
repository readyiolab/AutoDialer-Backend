-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

-- Backfill follow-up campaign from lead
UPDATE "follow_ups" AS fu
SET "campaignId" = l."campaignId"
FROM "leads" l
WHERE fu."leadId" = l.id AND fu."campaignId" IS NULL AND l."campaignId" IS NOT NULL;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey ImportHistory -> Campaign
DO $$ BEGIN
  ALTER TABLE "import_histories" ADD CONSTRAINT "import_histories_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "follow_ups_campaignId_status_scheduledDate_idx"
  ON "follow_ups"("campaignId", "status", "scheduledDate");

CREATE INDEX IF NOT EXISTS "import_histories_campaignId_idx"
  ON "import_histories"("campaignId");

CREATE INDEX IF NOT EXISTS "dial_sessions_userId_campaignId_status_idx"
  ON "dial_sessions"("userId", "campaignId", "status");
