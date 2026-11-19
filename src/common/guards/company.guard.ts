import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class CompanyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.companyId) {
      throw new ForbiddenException('Company context not found');
    }

    const companyIdParam = request.params?.companyId || request.query?.companyId;
    if (companyIdParam && companyIdParam !== user.companyId) {
      throw new ForbiddenException('Access denied: Company mismatch');
    }

    return true;
  }
}
