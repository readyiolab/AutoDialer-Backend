import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

const ALLOWED_WHEN_MUST_CHANGE = [
  '/auth/login',
  '/auth/change-password',
  '/auth/me',
  '/auth/logout',
  '/auth/invitations/accept',
  '/auth/verify-otp',
  '/auth/refresh',
  '/auth/refresh-token',
];

/**
 * JWT auth + must-change-password gate (runs AFTER Passport sets req.user).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const result = super.handleRequest(err, user, info, context);
    const req = context.switchToHttp().getRequest();
    if (result?.mustChangePassword) {
      const url = String(req.originalUrl || req.url || '').split('?')[0];
      const allowed = ALLOWED_WHEN_MUST_CHANGE.some(
        (suffix) => url.endsWith(suffix) || url.includes(suffix),
      );
      if (!allowed) {
        throw new ForbiddenException({
          code: 'MUST_CHANGE_PASSWORD',
          message: 'Password change required before continuing',
        });
      }
    }
    return result;
  }
}
