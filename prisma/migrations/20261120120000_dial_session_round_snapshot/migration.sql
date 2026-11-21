ALTER TABLE `dial_sessions`
  ADD COLUMN `roundId` VARCHAR(191) NULL,
  ADD COLUMN `resumedAt` DATETIME(3) NULL,
  ADD INDEX `dial_sessions_roundId_idx` (`roundId`),
  ADD CONSTRAINT `dial_sessions_roundId_fkey`
    FOREIGN KEY (`roundId`) REFERENCES `campaign_rounds`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `dial_sessions` AS ds
SET `roundId` = (
  SELECT cr.`id`
  FROM `campaign_rounds` AS cr
  WHERE cr.`campaignId` = ds.`campaignId`
    AND cr.`companyId` = ds.`companyId`
    AND cr.`status` = 'ACTIVE'
  ORDER BY cr.`roundNumber` DESC
  LIMIT 1
)
WHERE ds.`campaignId` IS NOT NULL
  AND ds.`status` IN ('RUNNING', 'PAUSED');
