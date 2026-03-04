/**
 * PM2 Ecosystem Configuration
 *
 * This file configures PM2 to run SNIPER as a persistent background service.
 *
 * Commands:
 *   npm run pm2:start   - Start SNIPER in background
 *   npm run pm2:stop    - Stop SNIPER
 *   npm run pm2:restart - Restart SNIPER
 *   npm run pm2:logs    - View logs
 *   npm run pm2:status  - Check status
 */

module.exports = {
  apps: [
    {
      name: 'sniper',
      script: 'src/server.js',
      cwd: '/Users/dadirohit/Desktop/Cryp/sniper',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
    },
  ],
};
