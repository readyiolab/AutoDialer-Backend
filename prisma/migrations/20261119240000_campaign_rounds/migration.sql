-- Multi-round campaign support (additive)

ALTER TABLE `leads` ADD COLUMN `currentRoundId` VARCHAR(191) NULL;

ALTER TABLE `lead_assignment_history` ADD COLUMN `roundId` VARCHAR(191) NULL;
ALTER TABLE `lead_status_history` ADD COLUMN `roundId` VARCHAR(191) NULL;
ALTER TABLE `allocation_batches` ADD COLUMN `roundId` VARCHAR(191) NULL;
ALTER TABLE `call_records` ADD COLUMN `roundId` VARCHAR(191) NULL;
ALTER TABLE `follow_ups` ADD COLUMN `roundId` VARCHAR(191) NULL;

CREATE TABLE `campaign_rounds` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `roundNumber` INTEGER NOT NULL,
    `status` ENUM('PLANNED', 'ACTIVE', 'COMPLETED') NOT NULL DEFAULT 'PLANNED',
    `selectionRules` JSON NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `campaign_round_leads` (
    `id` VARCHAR(191) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,
    `statusAtEntry` ENUM('NEW', 'ASSIGNED', 'PENDING', 'NOT_CONTACTED', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP_REQUIRED', 'CALL_BACK', 'BUSY', 'NO_ANSWER', 'SWITCHED_OFF', 'NOT_REACHABLE', 'INVALID_NUMBER', 'CONVERTED', 'LOST', 'CLOSED', 'DND', 'EXCLUDED', 'DOCUMENTS_REQUIRED', 'APPLICATION_SUBMITTED', 'PAYMENT_PROMISED', 'LOAN_REQUIRED') NOT NULL,
    `roundAttemptCount` INTEGER NOT NULL DEFAULT 0,
    `enteredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Extend LeadStatus enum (MySQL)
ALTER TABLE `leads` MODIFY `status` ENUM('NEW', 'ASSIGNED', 'PENDING', 'NOT_CONTACTED', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP_REQUIRED', 'CALL_BACK', 'BUSY', 'NO_ANSWER', 'SWITCHED_OFF', 'NOT_REACHABLE', 'INVALID_NUMBER', 'CONVERTED', 'LOST', 'CLOSED', 'DND', 'EXCLUDED', 'DOCUMENTS_REQUIRED', 'APPLICATION_SUBMITTED', 'PAYMENT_PROMISED', 'LOAN_REQUIRED') NOT NULL DEFAULT 'NEW';

ALTER TABLE `lead_status_definitions` MODIFY `code` ENUM('NEW', 'ASSIGNED', 'PENDING', 'NOT_CONTACTED', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP_REQUIRED', 'CALL_BACK', 'BUSY', 'NO_ANSWER', 'SWITCHED_OFF', 'NOT_REACHABLE', 'INVALID_NUMBER', 'CONVERTED', 'LOST', 'CLOSED', 'DND', 'EXCLUDED', 'DOCUMENTS_REQUIRED', 'APPLICATION_SUBMITTED', 'PAYMENT_PROMISED', 'LOAN_REQUIRED') NOT NULL;

ALTER TABLE `call_records` MODIFY `disposition` ENUM('INTERESTED', 'NOT_INTERESTED', 'CALL_BACK', 'FOLLOW_UP', 'WRONG_NUMBER', 'NUMBER_BELONGS_TO_SOMEONE_ELSE', 'LANGUAGE_BARRIER', 'ALREADY_TAKEN_LOAN', 'LOAN_REQUIRED', 'DOCUMENTS_REQUIRED', 'APPLICATION_SUBMITTED', 'PAYMENT_PROMISED', 'NOT_PICKED', 'BUSY', 'SWITCHED_OFF', 'NOT_REACHABLE', 'CALL_DECLINED', 'NETWORK_ERROR', 'FAILED', 'DND', 'DUPLICATE_LEAD', 'EXCLUDED', 'CONVERTED') NULL;

CREATE UNIQUE INDEX `campaign_rounds_campaignId_roundNumber_key` ON `campaign_rounds`(`campaignId`, `roundNumber`);
CREATE INDEX `campaign_rounds_companyId_campaignId_status_idx` ON `campaign_rounds`(`companyId`, `campaignId`, `status`);

CREATE UNIQUE INDEX `campaign_round_leads_roundId_leadId_key` ON `campaign_round_leads`(`roundId`, `leadId`);
CREATE INDEX `campaign_round_leads_roundId_assignedToId_idx` ON `campaign_round_leads`(`roundId`, `assignedToId`);
CREATE INDEX `campaign_round_leads_leadId_roundId_idx` ON `campaign_round_leads`(`leadId`, `roundId`);

CREATE INDEX `leads_currentRoundId_idx` ON `leads`(`currentRoundId`);
CREATE INDEX `lead_assignment_history_roundId_createdAt_idx` ON `lead_assignment_history`(`roundId`, `createdAt`);
CREATE INDEX `lead_status_history_roundId_createdAt_idx` ON `lead_status_history`(`roundId`, `createdAt`);
CREATE INDEX `allocation_batches_roundId_idx` ON `allocation_batches`(`roundId`);
CREATE INDEX `call_records_campaignId_roundId_createdAt_idx` ON `call_records`(`campaignId`, `roundId`, `createdAt`);
CREATE INDEX `call_records_roundId_createdAt_idx` ON `call_records`(`roundId`, `createdAt`);
CREATE INDEX `follow_ups_roundId_status_scheduledDate_idx` ON `follow_ups`(`roundId`, `status`, `scheduledDate`);

ALTER TABLE `campaign_rounds` ADD CONSTRAINT `campaign_rounds_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `campaign_rounds` ADD CONSTRAINT `campaign_rounds_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `campaign_rounds` ADD CONSTRAINT `campaign_rounds_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `campaign_round_leads` ADD CONSTRAINT `campaign_round_leads_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `campaign_round_leads` ADD CONSTRAINT `campaign_round_leads_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `campaign_round_leads` ADD CONSTRAINT `campaign_round_leads_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `leads` ADD CONSTRAINT `leads_currentRoundId_fkey` FOREIGN KEY (`currentRoundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `lead_assignment_history` ADD CONSTRAINT `lead_assignment_history_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `lead_status_history` ADD CONSTRAINT `lead_status_history_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `allocation_batches` ADD CONSTRAINT `allocation_batches_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `call_records` ADD CONSTRAINT `call_records_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill Round 1 for every campaign that has leads
INSERT INTO `campaign_rounds` (`id`, `campaignId`, `companyId`, `roundNumber`, `status`, `selectionRules`, `startedAt`, `createdAt`, `updatedAt`)
SELECT UUID(), c.`id`, c.`companyId`, 1, 'ACTIVE', JSON_OBJECT('backfill', true), c.`createdAt`, NOW(3), NOW(3)
FROM `campaigns` c
WHERE EXISTS (SELECT 1 FROM `leads` l WHERE l.`campaignId` = c.`id`)
  AND NOT EXISTS (SELECT 1 FROM `campaign_rounds` r WHERE r.`campaignId` = c.`id` AND r.`roundNumber` = 1);

INSERT INTO `campaign_round_leads` (`id`, `roundId`, `leadId`, `assignedToId`, `statusAtEntry`, `roundAttemptCount`, `enteredAt`, `updatedAt`)
SELECT UUID(), r.`id`, l.`id`, l.`assignedToId`, l.`status`, COALESCE(l.`totalAttempts`, 0), l.`createdAt`, NOW(3)
FROM `leads` l
INNER JOIN `campaign_rounds` r ON r.`campaignId` = l.`campaignId` AND r.`roundNumber` = 1
WHERE l.`campaignId` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `campaign_round_leads` m WHERE m.`roundId` = r.`id` AND m.`leadId` = l.`id`
  );

UPDATE `leads` l
INNER JOIN `campaign_rounds` r ON r.`campaignId` = l.`campaignId` AND r.`roundNumber` = 1
SET l.`currentRoundId` = r.`id`
WHERE l.`campaignId` IS NOT NULL AND l.`currentRoundId` IS NULL;
