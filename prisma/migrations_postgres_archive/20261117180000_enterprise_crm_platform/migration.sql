-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');
CREATE TYPE "DialMode" AS ENUM ('MANUAL', 'PREVIEW', 'PROGRESSIVE', 'POWER', 'PREDICTIVE');
CREATE TYPE "DialSessionStatus" AS ENUM ('RUNNING', 'PAUSED', 'ENDED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- AlterEnum LeadStatus
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'NOT_CONTACTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_REQUIRED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'BUSY';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'NO_ANSWER';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SWITCHED_OFF';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'INVALID_NUMBER';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'LOST';

-- AlterEnum AllocationMethod
ALTER TYPE "AllocationMethod" ADD VALUE IF NOT EXISTS 'ROUND_ROBIN';
ALTER TYPE "AllocationMethod" ADD VALUE IF NOT EXISTS 'PERFORMANCE';
ALTER TYPE "AllocationMethod" ADD VALUE IF NOT EXISTS 'AVAILABILITY';
ALTER TYPE "AllocationMethod" ADD VALUE IF NOT EXISTS 'WORKLOAD';
ALTER TYPE "AllocationMethod" ADD VALUE IF NOT EXISTS 'TEAM';
ALTER TYPE "AllocationMethod" ADD VALUE IF NOT EXISTS 'HYBRID';

-- AlterEnum ImportStatus
ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterTable companies
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "subscription" JSONB DEFAULT '{}';
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "accountManagerId" TEXT;

-- AlterTable users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable campaigns
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "dialMode" "DialMode" NOT NULL DEFAULT 'PROGRESSIVE';
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "allocationMethod" "AllocationMethod" NOT NULL DEFAULT 'EQUAL';
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "allocationRules" JSONB DEFAULT '{}';

-- AlterTable import_histories
ALTER TABLE "import_histories" ADD COLUMN IF NOT EXISTS "fileHash" TEXT;
ALTER TABLE "import_histories" ADD COLUMN IF NOT EXISTS "filePath" TEXT;
ALTER TABLE "import_histories" ADD COLUMN IF NOT EXISTS "columnMapping" JSONB;
ALTER TABLE "import_histories" ADD COLUMN IF NOT EXISTS "stagedRows" JSONB;
ALTER TABLE "import_histories" ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0;

-- AlterTable lead_status_history
ALTER TABLE "lead_status_history" ADD COLUMN IF NOT EXISTS "callId" TEXT;
CREATE INDEX IF NOT EXISTS "lead_status_history_leadId_createdAt_idx" ON "lead_status_history"("leadId", "createdAt");

-- AlterTable leads
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "allocationBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "leads_companyId_mobileNumber_idx" ON "leads"("companyId", "mobileNumber");

-- AlterTable call_records
ALTER TABLE "call_records" ADD COLUMN IF NOT EXISTS "dialSessionId" TEXT;

-- CreateTable permissions
CREATE TABLE IF NOT EXISTS "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_key_companyId_key" ON "permissions"("key", "companyId");

-- CreateTable teams
CREATE TABLE IF NOT EXISTS "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "managerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "teams_name_companyId_key" ON "teams"("name", "companyId");

-- CreateTable invitations
CREATE TABLE IF NOT EXISTS "invitations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "emailSentAt" TIMESTAMP(3),
    "emailFailed" BOOLEAN NOT NULL DEFAULT false,
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "invitations_tokenHash_idx" ON "invitations"("tokenHash");
CREATE INDEX IF NOT EXISTS "invitations_userId_status_idx" ON "invitations"("userId", "status");

-- CreateTable lead_status_definitions
CREATE TABLE IF NOT EXISTS "lead_status_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" "LeadStatus" NOT NULL,
    "label" TEXT NOT NULL,
    "isDialable" BOOLEAN NOT NULL DEFAULT true,
    "allowedNextCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_status_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_status_definitions_companyId_code_key" ON "lead_status_definitions"("companyId", "code");

-- CreateTable allocation_batches
CREATE TABLE IF NOT EXISTS "allocation_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "method" "AllocationMethod" NOT NULL,
    "ruleSnapshot" JSONB DEFAULT '{}',
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "allocation_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "allocation_batches_companyId_createdAt_idx" ON "allocation_batches"("companyId", "createdAt");

-- CreateTable dial_sessions
CREATE TABLE IF NOT EXISTS "dial_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "mode" "DialMode" NOT NULL DEFAULT 'PROGRESSIVE',
    "status" "DialSessionStatus" NOT NULL DEFAULT 'RUNNING',
    "currentLeadId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dial_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dial_sessions_userId_status_idx" ON "dial_sessions"("userId", "status");
CREATE INDEX IF NOT EXISTS "dial_sessions_companyId_status_idx" ON "dial_sessions"("companyId", "status");

-- CreateTable notifications
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_companyId_createdAt_idx" ON "notifications"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "import_histories_companyId_fileHash_idx" ON "import_histories"("companyId", "fileHash");
