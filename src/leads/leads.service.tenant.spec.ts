import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { SettingsService } from '../settings/settings.service';

describe('tenant scoping', () => {
  it('rejects allocate when leads are outside the company', async () => {
    const prisma = {
      campaign: { findFirst: jest.fn() },
      lead: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: 'l1', priority: 'MEDIUM' }]),
      },
      user: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({ id: 'u1', dailyTarget: 100 }),
        findMany: jest.fn(),
      },
      callRecord: { count: jest.fn().mockResolvedValue(0) },
      breakLog: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    } as any;

    const service = new LeadsService(prisma, {} as any, { emitToCompany: jest.fn() } as any, {
      notify: jest.fn(),
    } as any);

    await expect(
      service.allocate(
        {
          leadIds: ['l1', 'l2'],
          userIds: ['u1'],
          method: 'EQUAL' as any,
        },
        'company-a',
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects allocate when no telecallers provided', async () => {
    const prisma = {
      campaign: { findFirst: jest.fn() },
      lead: { findMany: jest.fn() },
      user: { findMany: jest.fn(), count: jest.fn() },
    } as any;

    const service = new LeadsService(prisma, {} as any, { emitToCompany: jest.fn() } as any, {
      notify: jest.fn(),
    } as any);

    await expect(
      service.allocate({ method: 'EQUAL' as any, userIds: [] }, 'company-a', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects role permission updates outside the company', async () => {
    const prisma = {
      role: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn(),
      },
    } as any;

    const service = new SettingsService(prisma);
    await expect(
      service.updateRolePermissions('role-other-company', ['*'], 'company-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects transfer when destination is not on the campaign', async () => {
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(2) },
      campaign: { findFirst: jest.fn().mockResolvedValue({ id: 'camp-1' }) },
      campaignAssignment: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'from-1' }]),
      },
      lead: { count: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    } as any;

    const service = new LeadsService(prisma, {} as any, { emitToCompany: jest.fn() } as any, {
      notify: jest.fn(),
    } as any);

    await expect(
      service.transfer(
        {
          campaignId: 'camp-1',
          fromUserId: 'from-1',
          toUserId: 'outsider-1',
          count: 5,
        },
        'company-a',
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('transfers count of leads from A to B and updates campaign counters', async () => {
    const notify = jest.fn();
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(2) },
      campaign: { findFirst: jest.fn().mockResolvedValue({ id: 'camp-1' }) },
      campaignAssignment: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: 'from-1' }, { userId: 'to-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]),
        count: jest.fn().mockResolvedValue(2),
        update: jest.fn(),
      },
      leadStatusHistory: { create: jest.fn() },
      leadAssignmentHistory: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'l1', assignedToId: 'from-1', status: 'ASSIGNED', campaignId: 'camp-1' },
        ])
        .mockResolvedValueOnce([
          { id: 'l2', assignedToId: 'from-1', status: 'ASSIGNED', campaignId: 'camp-1' },
        ]),
      $transaction: jest.fn(async (fn) => fn(prisma)),
    } as any;

    const service = new LeadsService(prisma, {} as any, { emitToCompany: jest.fn() } as any, {
      notify,
    } as any);

    const result = await service.transfer(
      {
        campaignId: 'camp-1',
        fromUserId: 'from-1',
        toUserId: 'to-1',
        count: 2,
      },
      'company-a',
      'admin-1',
    );

    expect(result.transferred).toBe(2);
    expect(result.leadIds).toEqual(['l1', 'l2']);
    expect(prisma.campaignAssignment.updateMany).toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });
});
