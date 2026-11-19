import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

const ALLOWED_SUFFIXES = [
  '/auth/login',
  '/auth/change-password',
  '/auth/me',
  '/auth/logout',
  '/auth/invitations/accept',
  '/auth/verify-otp',
  '/auth/refresh-token',
];

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.mustChangePassword) {
      return true;
    }

    const url = String(req.originalUrl || req.url || '').split('?')[0];
    if (ALLOWED_SUFFIXES.some((suffix) => url.endsWith(suffix) || url.includes(suffix))) {
      return true;
    }

    throw new ForbiddenException({
      code: 'MUST_CHANGE_PASSWORD',
      message: 'Password change required before continuing',
    });
  }
}
