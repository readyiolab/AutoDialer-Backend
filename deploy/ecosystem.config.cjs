/**
 * PM2 — starts ONLY autodialer-api. Never use pm2 restart all on this box.
 *
 * Backend GitHub repo layout (code at /opt/autodialer):
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save
 *
 * cwd is the repo root (parent of deploy/). PORT from .env (default 3010).
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'autodialer-api',
      cwd: path.join(__dirname, '..'),
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3010,
      },
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
