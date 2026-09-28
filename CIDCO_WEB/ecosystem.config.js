/**
 * pm2 process list for the CIDCO portal.
 *
 * Naming the processes here is what stops a redeploy stacking up instances:
 * `pm2 start` on a name that already exists adds another copy, while
 * `pm2 startOrReload ecosystem.config.js` starts what is missing and reloads
 * what is already there. deploy.sh uses the second, so running it ten times
 * leaves exactly these three processes.
 *
 *   pm2 startOrReload ecosystem.config.js     start or reload everything
 *   pm2 ls                                    what is running
 *   pm2 logs cidco-poll                       follow one
 *   pm2 save                                  remember it across reboots
 *
 * Both polls run in one process by default. To give them separate schedules,
 * comment out `cidco-poll` and uncomment the two below it.
 */
const path = require('path');

/** Everything runs from this folder, so a relative path in .env means one place. */
const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: 'cidco-web',
      cwd,
      script: path.join(cwd, '.next/standalone/server.js'),
      env: { NODE_ENV: 'production', PORT: 8040, HOSTNAME: '0.0.0.0' },
      // One process. Next's standalone server keeps no state worth sharing,
      // but two copies would both answer and only one would be the one you
      // just restarted.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '600M',
      merge_logs: true,
      time: true,
    },

    {
      name: 'cidco-poll',
      cwd,
      script: 'npm',
      args: 'run poll',
      env: { NODE_ENV: 'production', POLL_INTERVAL_MS: 15000 },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      time: true,
    },

    // --- separate schedules: comment out cidco-poll above, uncomment these ---
    // {
    //   name: 'cidco-poll1',
    //   cwd,
    //   script: 'npm',
    //   args: 'run poll -- --only=1',
    //   env: { NODE_ENV: 'production', POLL1_INTERVAL_MS: 5000 },
    //   instances: 1,
    //   exec_mode: 'fork',
    //   autorestart: true,
    //   time: true,
    // },
    // {
    //   name: 'cidco-poll2',
    //   cwd,
    //   script: 'npm',
    //   args: 'run poll -- --only=2',
    //   env: { NODE_ENV: 'production', POLL2_INTERVAL_MS: 60000 },
    //   instances: 1,
    //   exec_mode: 'fork',
    //   autorestart: true,
    //   time: true,
    // },

    {
      name: 'cidco-sftp',
      cwd,
      script: 'npm',
      args: 'run sftp',
      env: { NODE_ENV: 'production' },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      time: true,
    },
  ],
};
