import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const beforeCampaigns = await prisma.campaign.count();
  const beforeTelecallers = await prisma.user.count({
    where: { role: { name: 'TELECALLER' } },
  });
  console.log(`Campaigns before: ${beforeCampaigns}`);
  console.log(`Telecallers before: ${beforeTelecallers}`);

  await prisma.$transaction(async (tx) => {
    // Safety: clear lead-related leftovers first
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
    await tx.lead.deleteMany({});
    await tx.allocationBatch.deleteMany({});
    await tx.importHistory.deleteMany({});

    await tx.campaignAssignment.deleteMany({});
    const campaigns = await tx.campaign.deleteMany({});
    console.log(`Campaigns deleted: ${campaigns.count}`);

    // Remove telecaller sessions / attendance only for telecallers
    const telecallers = await tx.user.findMany({
      where: { role: { name: 'TELECALLER' } },
      select: { id: true, name: true, phone: true },
    });
    const ids = telecallers.map((u) => u.id);
    if (ids.length) {
      await tx.sessionLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.attendanceLog.deleteMany({ where: { userId: { in: ids } } });
      await tx.invitation.deleteMany({ where: { userId: { in: ids } } });
      await tx.notification.deleteMany({ where: { userId: { in: ids } } });
      const deletedUsers = await tx.user.deleteMany({
        where: { id: { in: ids } },
      });
      console.log(`Telecallers deleted: ${deletedUsers.count}`);
      for (const u of telecallers) {
        console.log(` - ${u.name} (${u.phone})`);
      }
    } else {
      console.log('Telecallers deleted: 0');
    }
  });

  console.log(`Campaigns after: ${await prisma.campaign.count()}`);
  console.log(
    `Telecallers after: ${await prisma.user.count({ where: { role: { name: 'TELECALLER' } } })}`,
  );
  console.log('Admin accounts kept (including Arun).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
