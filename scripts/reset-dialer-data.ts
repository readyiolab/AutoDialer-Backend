/**
 * Scoped wipe of dialer operational data for one company.
 * ALWAYS run backup-dialer-data.ts first (this script refuses without BACKUP_OK=1).
 *
 * Usage:
 *   BACKUP_OK=1 npx ts-node scripts/reset-dialer-data.ts
 * Env: RESET_COMPANY_CODE (default ADEMO)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.BACKUP_OK !== '1') {
    throw new Error(
      'Refusing to wipe without BACKUP_OK=1. Run db:backup-dialer first, then set BACKUP_OK=1.',
    );
  }

  const code = process.env.RESET_COMPANY_CODE || 'ADEMO';
  const company = await prisma.company.findUnique({ where: { code } });
  if (!company) {
    throw new Error(`Company ${code} not found`);
  }
  const companyId = company.id;
  console.log(`Wiping dialer data for company ${code} (${companyId})…`);

  await prisma.$transaction(async (tx) => {
    const sessions = await tx.dialSession.findMany({
      where: { companyId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      await tx.dialSessionEvent.deleteMany({ where: { sessionId: { in: sessionIds } } });
    }

    await tx.followUp.deleteMany({ where: { companyId } });
    await tx.callRecord.deleteMany({ where: { companyId } });
    await tx.communicationLog.deleteMany({ where: { companyId } });

    const leads = await tx.lead.findMany({ where: { companyId }, select: { id: true } });
    const leadIds = leads.map((l) => l.id);
    if (leadIds.length) {
      await tx.leadStatusHistory.deleteMany({ where: { leadId: { in: leadIds } } });
      await tx.leadAssignmentHistory.deleteMany({ where: { leadId: { in: leadIds } } });
    }
    await tx.leadAssignmentHistory.deleteMany({ where: { companyId } });

    await tx.dialSession.updateMany({
      where: { companyId },
      data: { currentLeadId: null },
    });
    await tx.dialSession.deleteMany({ where: { companyId } });

    await tx.lead.deleteMany({ where: { companyId } });
    await tx.allocationBatch.deleteMany({ where: { companyId } });
    await tx.importHistory.deleteMany({ where: { companyId } });

    await tx.campaignAssignment.deleteMany({
      where: { campaign: { companyId } },
    });
    await tx.campaign.deleteMany({ where: { companyId } });
  });

  console.log('Dialer operational data cleared. Schema and non-dialer config retained.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
