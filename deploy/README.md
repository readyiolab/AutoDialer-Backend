# Safe side-by-side go-live on EC2

Fresh Autodialer stack beside existing Lendigo/fintech. Empty MySQL database `autodialer`. No data copy from laptop. No shared tables with the loan app.

**Repos**

- Backend: https://github.com/readyiolab/AutoDialer-Backend  
- Frontend: https://github.com/readyiolab/AutoDialer-Frontend  

Domains:

- Frontend: `https://autodialer.lendigomicrocare.com`
- API: `https://autodialerapi.lendigomicrocare.com`

| Role | Path / name |
|------|-------------|
| Code (live Backend) | `/var/www/AutoDialer` |
| Static site | `/var/www/autodialer` |
| Uploads | `/var/lib/autodialer/uploads` (or under AutoDialer) |
| PM2 | `autodialer-api` |
| Nginx sites | `autodialer`, `autodialerapi` |
| RDS database | `autodialer` only |

## Hard do-not-touch list

Never:

- Edit `/var/www/LendigoMicroCare`, `/var/www/Lmendigo`, `/var/www/app`, `/var/www/html`
- Change Nginx `lendigomicrocare`, `lmendigo`, `lmendigo-root`
- Run `pm2 restart all` / delete existing apps / stop Redis
- Point `DATABASE_URL` at any database except `autodialer`

## Port and Redis

```bash
ss -ltnp | grep 3010 || echo "port 3010 free"
```

- API on `3010` (or `3011` if taken — update Nginx upstream only).
- Prefer **Upstash** via `REDIS_HOST` / `REDIS_PASSWORD` / `REDIS_TLS=true` (see `deploy/env.production.sample`).
- Or `REDIS_URL=rediss://default:PASSWORD@HOST:6379`.
- Do not restart the box Redis service for Lendigo.

## 1. RDS

Ensure empty database exists (admin can create it):

```sql
CREATE DATABASE IF NOT EXISTS autodialer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Security group: `3306` from this EC2 only.

## 2. DNS

Add only (do not edit other records):

- `autodialer` A → EC2 public IP (e.g. `65.0.35.9`)
- `autodialerapi` A → same IP  

## 3. Clone Backend

```bash
sudo mkdir -p /opt/autodialer /var/www/autodialer /var/lib/autodialer/uploads
sudo chown -R ubuntu:ubuntu /opt/autodialer /var/lib/autodialer
cd /opt
git clone https://github.com/readyiolab/AutoDialer-Backend.git autodialer
cd /opt/autodialer
cp deploy/env.production.sample .env
nano .env   # set YOUR_RDS_PASSWORD, SMTP_PASS, JWT_SECRET
```

## 4. Migrate + build + PM2

```bash
cd /opt/autodialer
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run db:bootstrap-arun

pm2 start deploy/ecosystem.config.cjs   # autodialer-api only
pm2 save
pm2 list
curl -sS http://127.0.0.1:3010/api/health
```

## 5. Nginx + Certbot + Frontend

```bash
cd /opt/autodialer
sudo cp deploy/nginx/autodialer.lendigomicrocare.com.conf /etc/nginx/sites-available/autodialer
sudo cp deploy/nginx/autodialerapi.lendigomicrocare.com.conf /etc/nginx/sites-available/autodialerapi
sudo ln -sf /etc/nginx/sites-available/autodialer /etc/nginx/sites-enabled/autodialer
sudo ln -sf /etc/nginx/sites-available/autodialerapi /etc/nginx/sites-enabled/autodialerapi
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d autodialer.lendigomicrocare.com -d autodialerapi.lendigomicrocare.com

cd /tmp
git clone https://github.com/readyiolab/AutoDialer-Frontend.git autodialer-frontend
cd autodialer-frontend
npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/autodialer/
```

## Update: backend performance overhaul

Live API path on this EC2 is **`/var/www/AutoDialer`** (not `/opt/autodialer`).

```bash
cd /var/www/AutoDialer
# Prefer git pull if .git exists; otherwise re-clone Backend over a backup
git pull || true
npm ci
npx prisma migrate deploy
npm run build
pm2 restart autodialer-api
curl -sS https://autodialerapi.lendigomicrocare.com/api/health
```

Ensure `DATABASE_URL` includes `connection_limit=10` (or similar). Redis uses short connect timeouts; jobs fall back inline if Redis is slow.

## Update: faster mobile today/lists

```bash
cd /var/www/AutoDialer
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 restart autodialer-api
```

Then share Android `AutoDialPro-2.2.3.apk` (uninstall old app first if needed).

## Update: roles + telecaller PAN/Aadhaar

After pulling code that adds `ensureSystemRoles` and User `panNumber`/`aadhaarNumber`:

```bash
# API
cd /opt/autodialer   # or /var/www/AutoDialer if that is where you cloned
git pull
npm ci
npx prisma migrate deploy
npm run build
npm run db:bootstrap-arun   # ensures TELECALLER etc. on ADEMO
pm2 restart autodialer-api

# Frontend (rebuild static)
cd /tmp
rm -rf autodialer-frontend
git clone https://github.com/readyiolab/AutoDialer-Frontend.git autodialer-frontend
cd autodialer-frontend
npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/autodialer/
```

Then open Add Employee — roles should list Telecaller (not only Super Admin), and selecting Telecaller shows required PAN/Aadhaar.

## Update: calling hours use India time (API)

EC2 is UTC; dialer windows are India business hours. After Backend pull:

```bash
cd /var/www/AutoDialer
git pull
npm ci
npm run build
pm2 restart autodialer-api
```

Optional `.env`: `CALLING_TIMEZONE=Asia/Kolkata` (default if unset).

## Update: Android device self-authorize (API + APK 2.2.5)

```bash
cd /var/www/AutoDialer
git pull
npm ci
npm run build
pm2 restart autodialer-api
```

Share `AutoDialPro-2.2.5.apk`. On “already registered on another device”, telecaller taps **Authorize this device** (or admin uses Employee Devices → Replace).

## Update: Lead Allocation how-many + bulk distribute

Needs **API + frontend** (new allocate `limit` field).

```bash
# API
cd /var/www/AutoDialer
git pull
npm ci
npm run build
pm2 restart autodialer-api

# Frontend static
cd /tmp
rm -rf autodialer-frontend
git clone https://github.com/readyiolab/AutoDialer-Frontend.git autodialer-frontend
cd autodialer-frontend
npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/autodialer/
```

On Lead Allocation: use **How many leads** (All / 50 / 100 / …) — no need to tick rows one-by-one. Optional “Pick specific leads” for fine control.

## Update: Lead Allocation roster + unassigned total (frontend only)

No API restart required for roster-only. Rebuild static site after Frontend push:

```bash
cd /tmp
rm -rf autodialer-frontend
git clone https://github.com/readyiolab/AutoDialer-Frontend.git autodialer-frontend
cd autodialer-frontend
npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/autodialer/
```

### Verify InstantRupiya Loan

1. Open Lead Allocation → select **InstantRupiya Loan**.
2. Empty campaign team should list company telecallers (e.g. Pooja / Surya / Alok). Check them to assign + select.
3. Header should show **Unassigned leads (showing X of Y)** with Y ≈ 327 (not capped at 100).
4. Preview / Allocate Equal with no lead checkboxes → planned total ≈ full unassigned count.
5. After allocate: dashboard Unassigned drops; Campaign Detail telecallers count &gt; 0.
6. Campaign Detail add/remove telecallers still works.

## 6. Smoke test

1. `curl -sS https://autodialerapi.lendigomicrocare.com/api/health`
2. Login at `https://autodialer.lendigomicrocare.com`
3. `pm2 list` — Lendigo/fintech still online
4. Open an existing Lendigo URL once

## Rollback (Autodialer only)

```bash
pm2 stop autodialer-api
sudo rm -f /etc/nginx/sites-enabled/autodialer /etc/nginx/sites-enabled/autodialerapi
sudo nginx -t && sudo systemctl reload nginx
```
