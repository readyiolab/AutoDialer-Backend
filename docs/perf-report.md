# Backend performance overhaul — report

Captured: 2026-11-19

## 1. Issues identified

| Area | Issue |
|------|--------|
| JWT | 2–4 Prisma queries on every authenticated request |
| Android | `userDevice.update(lastActiveAt)` on every request |
| MustChangePasswordGuard | Global before JWT → never enforced, wasted work |
| Dashboard | Many parallel `lead.count` / call counts |
| Daily calling MIS | `findMany(distinct leadId)` loaded all IDs into memory |
| Branch MIS | 3 counts × N branches |
| Employee productivity | Scanned all-history call/lead aggregates |
| Devices / teams | Unbounded `findMany` |
| Indexes | Missing composites for assigned queues / MIS / sessions |
| Redis | No connect timeout; enqueue could hang HTTP |

## 2. Root causes (slow APIs)

- **Mobile today / authenticated routes:** JWT validation DB round-trips dominate before handler runs.
- **Reports dashboard / daily-calling / branch:** query storms and N+1 patterns, not network alone.
- **Lists devices/teams:** no pagination → grows with tenant size.

## 3. Indexing fixes

Migration `20261119223000_perf_indexes` (+ earlier mobile indexes):

- Lead: `(companyId, assignedToId, updatedAt|lastContactedAt|nextFollowUpAt)`
- CallRecord: `(companyId, campaignId, createdAt)`, `(companyId, disposition, createdAt)`
- SessionLog: `(isActive, loginAt)`
- User: `(companyId, roleId, status)`

## 4. Queries / APIs optimized

- JWT: 60s in-memory auth cache; Android lastActiveAt throttled 5 min; device re-check skipped when unchanged
- Must-change-password enforced **after** JWT inside `JwtAuthGuard`
- Dashboard: lead status `groupBy` + 30s company cache
- Daily calling: `groupBy(leadId)` instead of distinct findMany rows
- Branch MIS: one `groupBy` path by userId → roll up to branch
- Employee productivity: default last **7 days**
- Devices / teams: page + pageSize
- Redis: `connectTimeout` 3s, `lazyConnect`, notification enqueue 2s timeout

## 5. Pagination

- Devices + teams now return `{ data, meta }`
- Frontend updated to unwrap both shapes

## 6. Retry / Redis

- Notification enqueue: exponential backoff kept; hard timeout so Redis cannot block HTTP
- Prisma connect retry unchanged; no blind POST retries

## 7. Probe timings (live API still on pre-overhaul build until EC2 pull)

| Probe | Endpoint | p50 | p95 | Notes |
|-------|----------|-----|-----|-------|
| baseline (`perf-baseline.md`) | GET /api/health | ~840 ms | ~1756 ms | before local overhaul ship |
| re-probe (`perf-after.md`) | GET /api/health | ~2540 ms | ~2676 ms | same live build; variance/network |

Authenticated mobile/MIS deltas need deploy + credentials:

```bash
PERF_PHONE=... PERF_PASSWORD=... PERF_COMPANY=ADEMO npm run perf:probe
PERF_OUT=docs/perf-after.md npm run perf:probe
```

## 8. Remaining

- Redis-backed JWT session cache for multi-instance
- Split BullMQ workers to separate PM2 process
- FULLTEXT lead search
- Further collapse mobile `todayHome` counts into raw SQL
- Cursor pagination for very large lead exports

## 9. Deploy (`/var/www/AutoDialer`)

```bash
cd /var/www/AutoDialer
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 restart autodialer-api
```
