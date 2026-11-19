import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.lead.count();
  console.log(`Leads before: ${before}`);

  await prisma.$transaction(async (tx) => {
    await tx.followUp.deleteMany({});
    await tx.callRecord.deleteMany({});
    await tx.communicationLog.deleteMany({});
    await tx.leadStatusHistory.deleteMany({});
    await tx.leadAssignmentHistory.deleteMany({});

    await tx.dialSession.updateMany({
      data: { currentLeadId: null, lastCompletedLeadId: null },
    });
    await tx.dialSessionEvent.deleteMany({});
    await tx.dialSession.deleteMany({});

    const deleted = await tx.lead.deleteMany({});
    console.log(`Leads deleted: ${deleted.count}`);

    await tx.allocationBatch.deleteMany({});
    await tx.importHistory.deleteMany({});
    await tx.campaignAssignment.updateMany({
      data: { leadsAssigned: 0, leadsCompleted: 0 },
    });
  });

  console.log(`Leads after: ${await prisma.lead.count()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
