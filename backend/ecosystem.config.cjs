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

  /**
   * pm2 starts a shell, and `pm2-exec.sh` immediately `exec`s node over it.
   *
   * The obvious spelling — `script: 'src/server.ts'`, `interpreter: 'node'`,
   * `node_args: ['--import','tsx']` — does not work. In fork mode pm2 loads a Node entry
   * through its own ProcessContainerFork, and that cannot host a TypeScript one: pm2 reports
   * the app "online", nothing is ever logged, and about four seconds later it records
   * `exited with code [0] via signal [SIGINT]`, forever. Running the identical command by
   * hand from the same directory works. Bisected on the box: a plain .mjs entry is stable, a
   * plain .cjs entry is stable, the .ts entry is not.
   *
   * Because the shell `exec`s rather than spawning, there is exactly ONE process and it is
   * node's — so `max_memory_restart` still measures the server's RSS, and SIGTERM still
   * reaches the graceful-shutdown handler that calls `stopQueue()`. Without that handler a
   * worker killed mid-job leaves a WorkflowInstance stuck RUNNING, which is the failure it
   * exists to prevent. `tsx` is still loaded with `--import` (not `tsx file.ts`, which
   * re-execs node in a child and would reintroduce the shim).
   *
   * Each app passes its own entry point through `args`.
   */
  script: './pm2-exec.sh',
  interpreter: 'bash',

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
      args: 'src/server.ts',
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
      args: 'src/superadmin-server.ts',
      env: { NODE_OPTIONS: '--max-old-space-size=256' },
      max_memory_restart: '384M',
      out_file: '/var/log/zunopilot/sa.out.log',
      error_file: '/var/log/zunopilot/sa.err.log',
    },
  ],
};
