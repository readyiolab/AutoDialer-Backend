/**
 * Upsert Super Admin Arun for company (default ADEMO).
 * Password from ARUN_ADMIN_PASSWORD env (default only for local bootstrap).
 * Never log the plaintext password.
 *
 * Usage: npx ts-node scripts/bootstrap-arun-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const code = process.env.RESET_COMPANY_CODE || 'ADEMO';
  const email = (process.env.ARUN_ADMIN_EMAIL || 'arun@admin.com').toLowerCase();
  const name = process.env.ARUN_ADMIN_NAME || 'Arun';
  const phone = process.env.ARUN_ADMIN_PHONE || '9000000001';
  const password = process.env.ARUN_ADMIN_PASSWORD || 'Arun@#123';

  let company = await prisma.company.findUnique({ where: { code } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: 'AutoDial Financial Services Ltd.',
        code,
        contactName: name,
        email,
        phone,
        status: 'ACTIVE',
        isActive: true,
      },
    });
  } else if (!company.isActive || company.status !== 'ACTIVE') {
    const prev = `${company.status}/isActive=${company.isActive}`;
    company = await prisma.company.update({
      where: { id: company.id },
      data: { status: 'ACTIVE', isActive: true },
    });
    console.log(`Reactivated company ${code} (was ${prev})`);
  }

  let role = await prisma.role.findFirst({
    where: { name: 'SUPER_ADMIN', companyId: company.id },
  });
  if (!role) {
    role = await prisma.role.create({
      data: {
        name: 'SUPER_ADMIN',
        displayName: 'Super Admin',
        permissions: ['*'],
        isSystem: true,
        companyId: company.id,
      },
    });
  } else {
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: ['*'] },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const existingByEmail = await prisma.user.findFirst({
    where: { email, companyId: company.id },
  });
  const existingByPhone = await prisma.user.findFirst({
    where: { phone, companyId: company.id },
  });

  const user = existingByEmail || existingByPhone;
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        email,
        phone,
        password: passwordHash,
        roleId: role.id,
        status: 'ACTIVE',
        isPlatformAdmin: true,
        mustChangePassword: false,
        employeeId: user.employeeId || 'ADM-ARUN',
      },
    });
    console.log(`Updated Super Admin ${name} (${email})`);
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: passwordHash,
        employeeId: 'ADM-ARUN',
        roleId: role.id,
        companyId: company.id,
        status: 'ACTIVE',
        isPlatformAdmin: true,
        mustChangePassword: false,
        dailyTarget: 0,
      },
    });
    console.log(`Created Super Admin ${name} (${email})`);
  }

  console.log(`Login: ${email}  |  company ${code}  |  password set (ARUN_ADMIN_PASSWORD or default)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
