#!/usr/bin/env bash
#
# How pm2 starts both backend processes.
#
# pm2 cannot host a TypeScript entry itself. Point it at `src/server.ts` with
# `interpreter: node` and `node_args: ['--import','tsx']` and, in fork mode, it runs its own
# ProcessContainerFork and loads the script through that. The result on this box was:
# pm2 reports the app "online", the app produces NO output at all — not one line, in pm2's
# logs or its own — and roughly four seconds later pm2 records
#
#     App [zunopilot-sa:0] exited with code [0] via signal [SIGINT]
#
# forever, on an exponential backoff. The same command run by hand from the same directory
# starts, serves /health, and shuts down gracefully. Bisected against pm2: a plain .mjs entry
# is stable, a plain .cjs entry is stable, a bare `pm2 start src/superadmin-server.ts` is not.
# The container is the difference.
#
# So pm2 starts a shell instead, and `exec` immediately REPLACES that shell with node. This is
# not a wrapper process — there is exactly one PID, and it is node's. That matters for three
# things pm2 would otherwise get wrong:
#
#   * SIGTERM/SIGINT land on node, so the graceful handler runs. Without it `stopQueue()` is
#     never called and a worker killed mid-job leaves a WorkflowInstance stuck RUNNING.
#   * `max_memory_restart` measures node's RSS rather than a shell's.
#   * `pm2 list` shows the real process, so an operator debugging at 3am is not chasing a shim.
#
# Verified on the box before shipping: restarts=0, /health 200, pm2 captures stdout, and
# `ps` on pm2's reported pid shows `node --import tsx src/superadmin-server.ts`.
#
# The entry point comes from pm2's `args`, so both apps share this one file.
set -euo pipefail
exec node --import tsx "$@"
