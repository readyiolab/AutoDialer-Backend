import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLE } from '../common/constants/roles';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const guard = new RolesGuard(reflector);

  const makeContext = (user: any) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  it('allows matching seeded role names', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      ROLE.SUPER_ADMIN,
      ROLE.COMPANY_ADMIN,
    ]);

    expect(
      guard.canActivate(
        makeContext({ roleName: ROLE.COMPANY_ADMIN, companyId: 'c1' }),
      ),
    ).toBe(true);
  });

  it('rejects mismatched display-style role names', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      ROLE.SUPER_ADMIN,
    ]);

    expect(() =>
      guard.canActivate(makeContext({ roleName: 'SuperAdmin', companyId: 'c1' })),
    ).toThrow(ForbiddenException);
  });
});
