/**
 * PM2 entry: load .env then boot Nest dist.
 * Loads dotenv if installed; otherwise parses .env manually so npm ci never bricks boot.
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    // Prefer dotenv when present (handles quotes/escapes better)
    // eslint-disable-next-line import/no-extraneous-dependencies
    require('dotenv').config({ path: filePath });
    return;
  } catch (_) {
    // fall through to manual parse
  }

  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(envPath);

const candidates = [
  path.join(__dirname, 'dist', 'src', 'main.js'),
  path.join(__dirname, 'dist', 'main.js'),
];

const entry = candidates.find((p) => fs.existsSync(p));
if (!entry) {
  console.error(
    'Built API entry not found. Run npm run build first. Looked for:\n' +
      candidates.join('\n'),
  );
  process.exit(1);
}

require(entry);
