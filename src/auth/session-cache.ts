import { TtlLru } from '../common/utils/ttl-lru';

export type CachedAuthUser = {
  id: string;
  userId: string;
  companyId: string;
  roleId: string;
  roleName: string;
  branchId: string | null;
  teamId: string | null;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  permissions: unknown;
  clientType: string;
  deviceId: string | null;
  sessionId: string | null;
};

/** Short-lived auth snapshot keyed by access-token hash. */
export const sessionAuthCache = new TtlLru<CachedAuthUser>(2_000, 60_000);

/** Throttle Android lastActiveAt writes: deviceId -> last touch ms */
export const deviceTouchThrottle = new TtlLru<true>(5_000, 5 * 60_000);

export function invalidateSessionAuthCache(tokenHash?: string) {
  if (tokenHash) sessionAuthCache.delete(tokenHash);
  else sessionAuthCache.clear();
}

export function invalidateAllSessionAuthCache() {
  sessionAuthCache.clear();
}
