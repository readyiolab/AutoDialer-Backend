/**
 * Timed API probe for Autodialer backend.
 *
 * Usage:
 *   PERF_BASE_URL=https://autodialerapi.lendigomicrocare.com \
 *   PERF_PHONE=9000000001 PERF_PASSWORD='...' PERF_COMPANY=ADEMO \
 *   npx ts-node scripts/perf-probe.ts
 *
 * Optional: PERF_ROUNDS=5  PERF_OUT=docs/perf-baseline.md
 */
import * as fs from 'fs';
import * as path from 'path';

const BASE = (process.env.PERF_BASE_URL || 'https://autodialerapi.lendigomicrocare.com').replace(/\/$/, '');
const API = `${BASE}/api`;
const ROUNDS = Math.max(1, Number(process.env.PERF_ROUNDS || 3));
const OUT = process.env.PERF_OUT || 'docs/perf-baseline.md';

type Sample = { name: string; ms: number; status: number; ok: boolean };

async function timed(
  name: string,
  fn: () => Promise<{ status: number; ok: boolean }>,
): Promise<Sample> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ms: Date.now() - t0, status: r.status, ok: r.ok };
  } catch (e: any) {
    return { name, ms: Date.now() - t0, status: 0, ok: false };
  }
}

async function jsonFetch(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; ok: boolean; body: any }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

async function main() {
  const samples: Sample[] = [];

  for (let i = 0; i < ROUNDS; i++) {
    samples.push(
      await timed('GET /api/health', async () => {
        const r = await jsonFetch(`${API}/health`);
        return { status: r.status, ok: r.ok };
      }),
    );
  }

  const phone = process.env.PERF_PHONE;
  const password = process.env.PERF_PASSWORD;
  const company = process.env.PERF_COMPANY || 'ADEMO';

  let token = process.env.PERF_TOKEN || '';
  let mobileToken = process.env.PERF_MOBILE_TOKEN || '';

  if (phone && password) {
    const login = await timed('POST /api/auth/login (web)', async () => {
      const r = await jsonFetch(`${API}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ phone, password, companyCode: company }),
      });
      token = r.body?.data?.accessToken || r.body?.accessToken || token;
      return { status: r.status, ok: r.ok && !!token };
    });
    samples.push(login);

    const mLogin = await timed('POST /api/mobile/auth/login', async () => {
      const r = await jsonFetch(`${API}/mobile/auth/login`, {
        method: 'POST',
        body: JSON.stringify({
          phone,
          password,
          companyCode: company,
          deviceId: process.env.PERF_DEVICE_ID || 'perf-probe-device',
          clientType: 'android',
        }),
        headers: { 'X-Client-Type': 'android', 'X-Device-Id': process.env.PERF_DEVICE_ID || 'perf-probe-device' },
      });
      mobileToken = r.body?.data?.accessToken || r.body?.accessToken || mobileToken;
      return { status: r.status, ok: r.ok && !!mobileToken };
    });
    samples.push(mLogin);
  }

  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const mAuth = mobileToken
    ? {
        Authorization: `Bearer ${mobileToken}`,
        'X-Client-Type': 'android',
        'X-Device-Id': process.env.PERF_DEVICE_ID || 'perf-probe-device',
      }
    : {};

  const mobilePaths = [
    ['GET /mobile/today', '/mobile/today'],
    ['GET /mobile/lists', '/mobile/lists'],
    ['GET /mobile/inbox', '/mobile/inbox?page=1&pageSize=20'],
  ] as const;

  if (mobileToken) {
    for (const [name, p] of mobilePaths) {
      for (let i = 0; i < ROUNDS; i++) {
        samples.push(
          await timed(name, async () => {
            const r = await jsonFetch(`${API}${p}`, { headers: mAuth });
            return { status: r.status, ok: r.ok };
          }),
        );
      }
    }
  }

  const adminPaths = [
    ['GET /reports/dashboard', '/reports/dashboard'],
    ['GET /reports/daily-calling', '/reports/daily-calling'],
    ['GET /reports/branch', '/reports/branch'],
  ] as const;

  if (token) {
    for (const [name, p] of adminPaths) {
      for (let i = 0; i < ROUNDS; i++) {
        samples.push(
          await timed(name, async () => {
            const r = await jsonFetch(`${API}${p}`, { headers: auth });
            return { status: r.status, ok: r.ok };
          }),
        );
      }
    }
  }

  const byName = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = byName.get(s.name) || [];
    list.push(s);
    byName.set(s.name, list);
  }

  const lines: string[] = [
    `# Perf probe`,
    ``,
    `- Base URL: \`${BASE}\``,
    `- Rounds: ${ROUNDS}`,
    `- Captured: ${new Date().toISOString()}`,
    ``,
    `| Endpoint | n | p50 ms | p95 ms | max ms | ok rate |`,
    `|---|---:|---:|---:|---:|---:|`,
  ];

  for (const [name, list] of byName) {
    const ms = list.map((x) => x.ms).sort((a, b) => a - b);
    const ok = list.filter((x) => x.ok).length;
    lines.push(
      `| ${name} | ${list.length} | ${pct(ms, 50)} | ${pct(ms, 95)} | ${ms[ms.length - 1]} | ${ok}/${list.length} |`,
    );
  }

  lines.push(``);
  if (!phone || !password) {
    lines.push(`_Auth endpoints skipped — set PERF_PHONE / PERF_PASSWORD for full probe._`);
    lines.push(``);
  }

  const outPath = path.isAbsolute(OUT) ? OUT : path.join(process.cwd(), OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
