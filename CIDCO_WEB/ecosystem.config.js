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
const fs = require('fs');
const path = require('path');

/** Everything runs from this folder, so a relative path in .env means one place. */
const cwd = __dirname;

/**
 * Reads .env so the port lives in one place.
 *
 * Nothing here hardcodes a port or an address: the server this runs on is
 * rebuilt and re-addressed, and a number written into a committed file is a
 * number somebody has to remember to change. Set PORT in .env — or in the
 * shell, which wins — and everything follows it.
 */
function fromEnvFile(name, fallback) {
  if (process.env[name]) return process.env[name];
  try {
    const line = fs
      .readFileSync(path.join(cwd, '.env'), 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${name}=`));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    // No .env yet. The fallback is the answer.
  }
  return fallback;
}

const PORT = fromEnvFile('PORT', '3000');
// The architect API portal is its own app, one folder up and across.
const ARCH = path.join(cwd, '..', 'arch_web');
const ARCH_PORT = fromEnvFile('ARCH_WEB_PORT', '3001');
// 0.0.0.0 so the port is reachable from outside the box; which addresses may
// actually reach it is the firewall's business, not this file's.
const HOSTNAME = fromEnvFile('HOSTNAME', '0.0.0.0');

module.exports = {
  apps: [
    {
      name: 'cidco-web',
      cwd,
      script: path.join(cwd, '.next/standalone/server.js'),
      env: { NODE_ENV: 'production', PORT, HOSTNAME },
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
      env: { NODE_ENV: 'production', POLL_INTERVAL_MS: fromEnvFile('POLL_INTERVAL_MS', '15000') },
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
    //   env: { NODE_ENV: 'production', POLL1_INTERVAL_MS: fromEnvFile('POLL1_INTERVAL_MS', '5000') },
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
    //   env: { NODE_ENV: 'production', POLL2_INTERVAL_MS: fromEnvFile('POLL2_INTERVAL_MS', '60000') },
    //   instances: 1,
    //   exec_mode: 'fork',
    //   autorestart: true,
    //   time: true,
    // },

    {
      // The architect's API dashboard, and the token-authenticated endpoints
      // their stations post readings to. Same database, its own port.
      name: 'arch-web',
      cwd: ARCH,
      script: path.join(ARCH, '.next/standalone/arch_web/server.js'),
      env: { NODE_ENV: 'production', PORT: ARCH_PORT, HOSTNAME },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '600M',
      merge_logs: true,
      time: true,
    },

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
