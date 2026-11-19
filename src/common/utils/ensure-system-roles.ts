import { PrismaClient, Prisma } from '@prisma/client';
import { SYSTEM_ROLE_PERMISSIONS } from '../constants/permissions';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const SYSTEM_ROLE_DISPLAY_NAMES: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  CEO: 'CEO / Management',
  OPS_HEAD: 'Operations Head',
  STATE_HEAD: 'State Head',
  BRANCH_MANAGER: 'Branch Manager',
  TEAM_LEADER: 'Team Leader',
  TELECALLER: 'Telecaller',
  MIS_EXECUTIVE: 'MIS Executive',
  COMPLIANCE_OFFICER: 'Compliance Officer',
};

/** Upsert every system role for a company (safe for bootstrap + live self-heal). */
export async function ensureSystemRoles(prisma: PrismaLike, companyId: string) {
  for (const [name, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    const displayName = SYSTEM_ROLE_DISPLAY_NAMES[name] || name.replace(/_/g, ' ');
    await prisma.role.upsert({
      where: { name_companyId: { name, companyId } },
      update: { permissions, displayName, isSystem: true },
      create: {
        name,
        displayName,
        permissions,
        isSystem: true,
        companyId,
      },
    });
  }
}
