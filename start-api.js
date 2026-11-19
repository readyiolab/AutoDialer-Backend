/**
 * PM2 entry: load .env then boot Nest dist.
 * Supports both dist/src/main.js (common Nest layout) and dist/main.js.
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '.env') });

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
