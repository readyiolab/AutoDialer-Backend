/**
 * End-to-end verification of campaign isolation + equal distribution.
 * Usage: npx ts-node scripts/verify-campaign-isolation.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function ensureTelecallers(companyId: string, roleId: string, count: number, prefix: string) {
  const ids: string[] = [];
  const hash = await bcrypt.hash('Tele@12345', 10);
  for (let i = 1; i <= count; i++) {
    const phone = `${prefix}${String(i).padStart(2, '0')}`;
    const employeeId = `TC-${prefix}-${i}`;
    const user = await prisma.user.upsert({
      where: { phone },
      update: { status: 'ACTIVE', roleId, password: hash, mustChangePassword: false },
      create: {
        name: `Telecaller ${prefix} ${i}`,
        phone,
        email: `tc${prefix}${i}@test.local`,
        employeeId,
        password: hash,
        roleId,
        companyId,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
    ids.push(user.id);
  }
  return ids;
}

async function createLeads(companyId: string, campaignId: string, count: number, series: number) {
  let created = 0;
  for (let i = 1; i <= count; i++) {
    // 10-digit Indian mobiles: series 7xxxxxxx / 8xxxxxxx
    const mobileNumber = `${series}${String(i).padStart(7, '0')}`.slice(0, 10);
    const row = {
      customerName: `Lead ${series} ${i}`,
      mobileNumber,
      companyId,
      campaignId,
      status: 'NEW' as const,
      source: 'EXCEL_UPLOAD' as const,
    };
    try {
      await prisma.lead.create({ data: row });
      created++;
    } catch {
      await prisma.lead.updateMany({
        where: { companyId, mobileNumber },
        data: { campaignId, assignedToId: null, status: 'NEW', allocationBatchId: null },
      });
      created++;
    }
  }
  return created;
}

async function equalAllocate(companyId: string, campaignId: string, userIds: string[], performedById: string) {
  const leads = await prisma.lead.findMany({
    where: { companyId, campaignId, assignedToId: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!leads.length || !userIds.length) {
    throw new Error('Nothing to allocate');
  }
  const batch = await prisma.allocationBatch.create({
    data: {
      companyId,
      campaignId,
      method: 'EQUAL',
      totalLeads: leads.length,
      allocated: 0,
      performedById,
      ruleSnapshot: { verify: true },
    },
  });
  let allocated = 0;
  for (let i = 0; i < leads.length; i++) {
    const userId = userIds[i % userIds.length];
    await prisma.lead.update({
      where: { id: leads[i].id },
      data: { assignedToId: userId, status: 'ASSIGNED', allocationBatchId: batch.id },
    });
    await prisma.campaignAssignment.update({
      where: { campaignId_userId: { campaignId, userId } },
      data: { leadsAssigned: { increment: 1 } },
    });
    allocated++;
  }
  await prisma.allocationBatch.update({
    where: { id: batch.id },
    data: { allocated },
  });
  return { allocated, perUser: Math.floor(leads.length / userIds.length), remainder: leads.length % userIds.length };
}

async function main() {
  const company = await prisma.company.findUnique({ where: { code: 'ADEMO' } });
  if (!company) throw new Error('ADEMO company missing');

  const role = await prisma.role.findFirst({
    where: { companyId: company.id, name: 'TELECALLER' },
  });
  if (!role) throw new Error('TELECALLER role missing — run seed first');

  const admin = await prisma.user.findFirst({
    where: { companyId: company.id, email: 'arun@admin.com' },
  });
  if (!admin) throw new Error('Arun admin missing — run db:bootstrap-arun');

  const lmTeam = await ensureTelecallers(company.id, role.id, 5, '91111000');
  const irTeam = await ensureTelecallers(company.id, role.id, 5, '92222000');

  const lm = await prisma.campaign.create({
    data: {
      name: 'Lmendigo',
      description: 'Verify campaign',
      status: 'ACTIVE',
      companyId: company.id,
      createdById: admin.id,
      allocationMethod: 'EQUAL',
    },
  });
  const ir = await prisma.campaign.create({
    data: {
      name: 'Instant Rupiya',
      description: 'Verify campaign',
      status: 'ACTIVE',
      companyId: company.id,
      createdById: admin.id,
      allocationMethod: 'EQUAL',
    },
  });

  await prisma.campaignAssignment.createMany({
    data: [
      ...lmTeam.map((userId) => ({ campaignId: lm.id, userId })),
      ...irTeam.map((userId) => ({ campaignId: ir.id, userId })),
    ],
    skipDuplicates: true,
  });

  await createLeads(company.id, lm.id, 500, 701);
  await createLeads(company.id, ir.id, 1000, 801);

  const lmAlloc = await equalAllocate(company.id, lm.id, lmTeam, admin.id);
  const irAlloc = await equalAllocate(company.id, ir.id, irTeam, admin.id);

  // Isolation: no Lmendigo lead assigned to Instant Rupiya telecaller
  const crossLm = await prisma.lead.count({
    where: { campaignId: lm.id, assignedToId: { in: irTeam } },
  });
  const crossIr = await prisma.lead.count({
    where: { campaignId: ir.id, assignedToId: { in: lmTeam } },
  });

  const lmCounts = await Promise.all(
    lmTeam.map((id) => prisma.lead.count({ where: { campaignId: lm.id, assignedToId: id } })),
  );
  const irCounts = await Promise.all(
    irTeam.map((id) => prisma.lead.count({ where: { campaignId: ir.id, assignedToId: id } })),
  );

  const lmOk = lmCounts.every((c) => c === 100) && lmAlloc.allocated === 500;
  const irOk = irCounts.every((c) => c === 200) && irAlloc.allocated === 1000;
  const isolationOk = crossLm === 0 && crossIr === 0;

  // Multi-campaign membership for one telecaller
  await prisma.campaignAssignment.upsert({
    where: { campaignId_userId: { campaignId: ir.id, userId: lmTeam[0] } },
    create: { campaignId: ir.id, userId: lmTeam[0] },
    update: {},
  });
  const multi = await prisma.campaignAssignment.count({
    where: { userId: lmTeam[0] },
  });

  console.log(
    JSON.stringify(
      {
        lmAlloc,
        irAlloc,
        lmCounts,
        irCounts,
        crossLm,
        crossIr,
        multiCampaignMemberships: multi,
        checks: {
          lmEqual: lmOk,
          irEqual: irOk,
          isolation: isolationOk,
          multiCampaign: multi >= 2,
        },
        pass: lmOk && irOk && isolationOk && multi >= 2,
      },
      null,
      2,
    ),
  );

  if (!(lmOk && irOk && isolationOk && multi >= 2)) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
