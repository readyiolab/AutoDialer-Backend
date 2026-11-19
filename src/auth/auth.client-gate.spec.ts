import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService client role gate', () => {
  const service = Object.create(AuthService.prototype) as AuthService;

  it('allows telecaller on android', () => {
    expect(() =>
      service.enforceClientRoleGate({ role: { name: 'TELECALLER' } }, 'android'),
    ).not.toThrow();
  });

  it('rejects non-telecaller on android', () => {
    expect(() =>
      service.enforceClientRoleGate({ role: { name: 'COMPANY_ADMIN' } }, 'android'),
    ).toThrow(UnauthorizedException);
  });

  it('rejects telecaller on web', () => {
    expect(() =>
      service.enforceClientRoleGate({ role: { name: 'TELECALLER' } }, 'web'),
    ).toThrow(UnauthorizedException);
  });

  it('allows admin on web', () => {
    expect(() =>
      service.enforceClientRoleGate({ role: { name: 'SUPER_ADMIN' } }, 'web'),
    ).not.toThrow();
  });
});
