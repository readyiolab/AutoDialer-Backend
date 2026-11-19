import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TelecallerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || user.roleName !== 'TELECALLER') {
      throw new ForbiddenException('This endpoint is restricted to telecallers');
    }
    return true;
  }
}
