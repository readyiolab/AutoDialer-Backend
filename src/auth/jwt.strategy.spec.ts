import { JwtStrategy } from './jwt.strategy';
import { UnauthorizedException } from '@nestjs/common';

describe('JwtStrategy payload shape', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-jwt-secret-value-123456';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  const mockReq = {
    headers: { authorization: 'Bearer test.jwt.token', 'x-client-type': 'web' },
  } as any;

  it('returns both id and userId with permissions', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          status: 'ACTIVE',
          isPlatformAdmin: false,
          mustChangePassword: false,
          companyId: 'c1',
          roleId: 'r1',
          branchId: null,
          teamId: null,
          deviceId: null,
          role: { name: 'TELECALLER', permissions: ['call_assigned_leads'] },
          company: { id: 'c1', status: 'ACTIVE', isActive: true },
        }),
      },
      sessionLog: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1', isActive: true }),
      },
      userDevice: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    const strategy = new JwtStrategy(prisma);
    const result = await strategy.validate(mockReq, {
      userId: 'u1',
      companyId: 'c1',
      roleId: 'r1',
      roleName: 'TELECALLER',
      branchId: null,
      clientType: 'web',
    });

    expect(result.id).toBe('u1');
    expect(result.userId).toBe('u1');
    expect(result.companyId).toBe('c1');
    expect(result.permissions).toEqual(['call_assigned_leads']);
  });

  it('rejects blocked users', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          status: 'BLOCKED',
          isPlatformAdmin: false,
          mustChangePassword: false,
          companyId: 'c1',
          roleId: 'r1',
          branchId: null,
          teamId: null,
          deviceId: null,
          role: { name: 'TELECALLER', permissions: [] },
          company: { id: 'c1', status: 'ACTIVE', isActive: true },
        }),
      },
      sessionLog: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1', isActive: true }),
      },
    } as any;

    const strategy = new JwtStrategy(prisma);
    await expect(
      strategy.validate(mockReq, {
        userId: 'u1',
        companyId: 'c1',
        roleId: 'r1',
        roleName: 'TELECALLER',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
