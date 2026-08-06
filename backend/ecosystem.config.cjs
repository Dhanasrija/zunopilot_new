// pm2 process definitions for the two backend servers.
//
// `.cjs` rather than `.js` because backend/package.json is `"type": "module"` and pm2 reads
// this file with `require`.
//
// Three details here are load-bearing rather than stylistic. Each is explained where it sits.

const base = {
  /**
   * The SYMLINK path, never a resolved release directory.
   *
   * `dotenv.config()` in config/env.ts resolves `.env` against `process.cwd()`, so this is
   * what makes the environment load at all. It must stay the symlink: pinning a process to
   * `releases/<sha>` means the next deploy's prune deletes the directory out from under a
   * running server.
   */
  cwd: '/srv/zunopilot/backend/current',

  interpreter: 'node',

  /**
   * `--import tsx`, NOT `script: 'tsx'`.
   *
   * Running `tsx file.ts` re-execs node in a child process, which leaves pm2 supervising a
   * shim. Two things then break quietly: `max_memory_restart` measures the shim's RSS rather
   * than the server's, and SIGTERM is delivered to the shim, so the graceful-shutdown handler
   * in server.ts never runs. That handler is what calls `stopQueue()` — without it a worker
   * killed mid-job leaves a WorkflowInstance stuck RUNNING, which is precisely the failure it
   * was written to prevent.
   *
   * `--import` installs the loader in *this* process instead. Needs node >= 20.6 (the box is
   * on 22.22) and tsx >= 4.7 (the lockfile has 4.23).
   */
  node_args: ['--import', 'tsx'],

  exec_mode: 'fork',

  /**
   * Exactly one, permanently.
   *
   * RUN_WORKERS_IN_API=true means the pg-boss workers and the scheduled sweeps run inside the
   * API process. A second instance would double-run every sweep — billing overage, reminders,
   * campaign sends. Scaling out requires moving workers to their own process first.
   */
  instances: 1,

  autorestart: true,
  // A crash loop must not spin the CPU on a burstable instance and burn its credits.
  exp_backoff_restart_delay: 2000,
  min_uptime: '30s',
  max_restarts: 10,
  // server.ts gives itself 10s then hard-exits; leave room for that to finish first.
  kill_timeout: 15000,
  time: true,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...base,
      name: 'zunopilot-api',
      script: 'src/server.ts',
      env: { NODE_OPTIONS: '--max-old-space-size=768' },
      // Recycle before the kernel's OOM killer has to choose a victim — on a shared box it is
      // as likely to pick nginx as node.
      max_memory_restart: '1000M',
      out_file: '/var/log/zunopilot/api.out.log',
      error_file: '/var/log/zunopilot/api.err.log',
    },
    {
      ...base,
      name: 'zunopilot-sa',
      // Deliberately starts no workers, and serves a handful of operators rather than every
      // tenant's traffic — so it gets a much smaller share.
      script: 'src/superadmin-server.ts',
      env: { NODE_OPTIONS: '--max-old-space-size=256' },
      max_memory_restart: '384M',
      out_file: '/var/log/zunopilot/sa.out.log',
      error_file: '/var/log/zunopilot/sa.err.log',
    },
  ],
};
