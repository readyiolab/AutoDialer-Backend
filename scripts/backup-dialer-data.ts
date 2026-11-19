/**
 * Exports dialer-related tables for a company before destructive reset.
 * Usage: npx ts-node scripts/backup-dialer-data.ts
 * Env: DATABASE_URL, RESET_COMPANY_CODE (default ADEMO)
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const code = process.env.RESET_COMPANY_CODE || 'ADEMO';
  const company = await prisma.company.findUnique({ where: { code } });
  if (!company) {
    throw new Error(`Company ${code} not found — aborting backup`);
  }

  const companyId = company.id;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', 'backups', `dialer-${code}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const dump = async (name: string, data: unknown) => {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
    console.log(`Wrote ${name}.json`);
  };

  await dump('company', company);
  await dump(
    'campaigns',
    await prisma.campaign.findMany({ where: { companyId } }),
  );
  await dump(
    'campaign_assignments',
    await prisma.campaignAssignment.findMany({
      where: { campaign: { companyId } },
    }),
  );
  await dump('leads', await prisma.lead.findMany({ where: { companyId } }));
  await dump(
    'lead_assignment_history',
    await prisma.leadAssignmentHistory.findMany({ where: { companyId } }),
  );
  await dump(
    'allocation_batches',
    await prisma.allocationBatch.findMany({ where: { companyId } }),
  );
  await dump(
    'dial_sessions',
    await prisma.dialSession.findMany({ where: { companyId } }),
  );
  await dump(
    'dial_session_events',
    await prisma.dialSessionEvent.findMany({
      where: { session: { companyId } },
    }),
  );
  await dump(
    'call_records',
    await prisma.callRecord.findMany({ where: { companyId } }),
  );
  await dump(
    'follow_ups',
    await prisma.followUp.findMany({ where: { companyId } }),
  );
  await dump(
    'import_histories',
    await prisma.importHistory.findMany({ where: { companyId } }),
  );
  await dump(
    'communication_logs',
    await prisma.communicationLog.findMany({ where: { companyId } }),
  );
  await dump(
    'lead_status_history',
    await prisma.leadStatusHistory.findMany({
      where: { lead: { companyId } },
    }),
  );

  console.log(`Backup complete: ${dir}`);
  console.log(dir);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
