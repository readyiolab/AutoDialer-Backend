import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';

describe('PermissionsGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector);

  const ctx = (user: any) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('allows when no permissions required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(guard.canActivate(ctx({}))).toBe(true);
  });

  it('allows platform admin', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['manage_leads']);
    expect(guard.canActivate(ctx({ isPlatformAdmin: true }))).toBe(true);
  });

  it('allows matching permission', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['manage_leads']);
    expect(guard.canActivate(ctx({ permissions: ['manage_leads'] }))).toBe(true);
  });

  it('denies missing permission', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['manage_leads']);
    expect(() => guard.canActivate(ctx({ permissions: ['view_mis'] }))).toThrow(ForbiddenException);
  });
});
