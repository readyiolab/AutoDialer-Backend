-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_companyId_status_idx" ON "users"("companyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_companyId_createdAt_idx" ON "leads"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "campaigns_companyId_status_idx" ON "campaigns"("companyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "follow_ups_companyId_status_scheduledDate_idx" ON "follow_ups"("companyId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "communication_logs_companyId_createdAt_idx" ON "communication_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_histories_companyId_createdAt_idx" ON "import_histories"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attendance_logs_companyId_date_idx" ON "attendance_logs"("companyId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "session_logs_userId_isActive_idx" ON "session_logs"("userId", "isActive");
