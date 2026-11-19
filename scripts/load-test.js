/* eslint-disable no-console */
const autocannon = require('autocannon');

async function runOne(url, headers = {}) {
  const result = await autocannon({
    url,
    connections: 40,
    duration: 8,
    pipelining: 1,
    headers,
  });
  return {
    url,
    rpsAvg: result.requests.average,
    latencyP50: result.latency.p50,
    latencyP95: result.latency.p95,
    errors: result.errors,
    non2xx: result.non2xx,
  };
}

async function run() {
  const baseUrl = process.env.LOAD_BASE_URL || 'http://127.0.0.1:3001';
  const token = process.env.LOAD_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  console.log(`Running load tests against ${baseUrl}`);

  const health = await runOne(`${baseUrl}/api/health`);
  console.log('health', health);

  const results = [health];

  if (token) {
    const dashboard = await runOne(`${baseUrl}/api/reports/dashboard`, headers);
    const leads = await runOne(`${baseUrl}/api/leads?page=1&pageSize=20`, headers);
    results.push(dashboard, leads);
    console.log('dashboard', dashboard);
    console.log('leads', leads);
  } else {
    console.log('Set LOAD_TOKEN to include authenticated dashboard/leads endpoints');
  }

  const best = Math.max(...results.map((r) => r.rpsAvg || 0));
  console.log(JSON.stringify({ results, bestRpsAvg: best, targetRps: 1000 }, null, 2));
  console.log(`Best measured RPS (avg): ${best}. Target reference: 1000 (requires sized infra).`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
