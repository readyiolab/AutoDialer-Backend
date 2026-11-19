# Backend Security and Reliability Audit

Date: 2026-11-17  
Scope: NestJS + Prisma + PostgreSQL backend under `backend/src`

## Architecture decision

The proposed MySQL `mysql2` `Database` helper was **not** adopted. This application already uses Prisma against PostgreSQL. Porting to raw MySQL would rewrite every service and introduce SQL-injection risk through concatenated `where` / `column` / `orderby` fragments. Safe ideas from that helper (retry with backoff, health check, query bounding, identifier allow-lists) were implemented on top of Prisma instead.

## Findings and remediations

| Severity | Finding | Change |
|----------|---------|--------|
| Critical | Controllers used `user.id` while JWT returned `userId` | JWT now returns both `id` and `userId`; controllers use `user.userId` |
| Critical | `@Roles('SuperAdmin', ...)` never matched seeded `SUPER_ADMIN` names | Roles updated to seeded names; shared constants in `common/constants/roles.ts` |
| Critical | Lead allocate/transfer/blacklist and role permission updates lacked tenant checks | All mutations scoped with `companyId`; foreign user IDs validated |
| High | Default JWT secret in code | Boot fails unless `JWT_SECRET` is a non-default value |
| High | CORS `origin: '*'` with credentials | Origins from `CORS_ORIGINS`; credentials only with an explicit list |
| High | No rate limiting on login/OTP | `@nestjs/throttler` global + tight limits on auth endpoints |
| High | Raw JWT stored in `session_logs` | SHA-256 hash stored; refresh validates active hashed session |
| High | Unbounded list/report queries | Pagination max 100; list caps; reports rewritten to aggregates |
| Medium | No helmet | `helmet()` enabled in `main.ts` |
| Medium | Error filter leaked Prisma messages | Unexpected errors map to generic `Internal server error` |
| Medium | Excel import unbounded | 5 MB multer limit, max 5,000 rows, mobile-scoped duplicate lookup |
| Medium | Multi-step writes without transactions | Calls, dispositions, lead updates, import confirm, break end wrapped in `$transaction` |
| Medium | OTP used `Math.random` | Switched to `crypto.randomInt` |
| Medium | Missing indexes for tenant filters | Added migration `20261117120000_add_performance_indexes` |
| Low | Admin bodies typed as `any` | DTOs for branches, calling rules, dispositions, import confirm, assign users |

## Module coverage

Reviewed and hardened: auth, users, leads, campaigns, calls, followups, communication, reports, settings, branches, attendance, audit, prisma, health.

## Remaining risks

1. **JWT after logout**: access tokens remain valid until expiry. Session invalidation is checked on refresh, not on every request (intentionally, for throughput).
2. **In-memory OTP and throttling**: single-process only. Multi-instance deployments need Redis-backed stores (`ioredis` is present but unused).
3. **Reports RBAC**: MIS endpoints remain available to any authenticated company user to preserve current UI access; they are tenant-scoped and aggregate-based.
4. **Swagger** remains public at `/api/docs` in development-style setups; protect or disable in production if required.
5. **1,000+ RPS**: code changes remove unbounded reads and missing limits that made that rate unsafe. Achieved RPS must be measured with the load script against a real deployment; a single Node process on a laptop often will not hit 1,000 RPS.

## Verification

- Unit tests: `npm test` (roles, JWT user shape, pagination clamp, retry behavior, tenant rejection)
- Health: `GET /api/health`
- Load script: `npm run load:health` (records p50/p95/RPS against `/api/health`)

## Load test results

Attempted on 2026-11-17 against `http://127.0.0.1:3001/api/health`.

```
Database: unreachable (Prisma P1001 on localhost:5432)
Autocannon against :3001/api/health (whatever was listening):
  avg RPS: 4.5
  p50: 1496ms
  non2xx: 9 (not a healthy API response)
Target 1000+ RPS claimed: no
```

Re-run after Postgres is available:

```bash
npx prisma migrate deploy
npm run start:dev
npm run load:health
```
