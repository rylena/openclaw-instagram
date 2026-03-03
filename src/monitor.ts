import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createLoggerBackedRuntime, readJsonFileWithFallback, writeJsonFileAtomically, type RuntimeEnv } from "openclaw/plugin-sdk";
import { resolveInstagramAccount } from "./accounts.js";
import { listInstagramMessages, listInstagramThreads, markInstagramThreadRead } from "./client.js";
import { handleInstagramInbound } from "./inbound.js";
import { getInstagramRuntime } from "./runtime.js";
import type {
  CoreConfig,
  InstagramAccountConfig,
  InstagramInboundMessage,
  InstagramPollState,
  InstagramRealtimeEnvelope,
  ResolvedInstagramAccount,
} from "./types.js";

export type InstagramMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: {
    lastPollAt?: number;
    lastInboundAt?: number;
    lastOutboundAt?: number;
    lastError?: string | null;
  }) => void;
};

function resolveStateFile(accountId: string): string {
  const stateDir = getInstagramRuntime().state.resolveStateDir(process.env);
  return path.join(stateDir, "instagram", `${accountId}.json`);
}

async function waitForDelay(ms: number, signal?: AbortSignal) {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function buildInstagramRealtimeWatchArgv(account: ResolvedInstagramAccount): string[] | null {
  const cliPath = account.cliPath.trim();
  const cliArgs = account.cliArgs ?? [];
  const dirFlagIndex = cliArgs.indexOf("--dir");
  const cliDir =
    dirFlagIndex >= 0 && dirFlagIndex + 1 < cliArgs.length ? String(cliArgs[dirFlagIndex + 1]) : "";
  if (!(cliPath === "pnpm" && cliDir && cliArgs.includes("exec"))) {
    return null;
  }
  const watchPath = fileURLToPath(new URL("../scripts/instagram-watch.ts", import.meta.url));
  const argv = [
    cliPath,
    "--dir",
    cliDir,
    "exec",
    "ts-node",
    "--esm",
    watchPath,
    "--cli-dir",
    cliDir,
  ];
  if (account.sessionUsername) {
    argv.push("--session", account.sessionUsername);
  }
  return argv;
}

async function monitorInstagramRealtimeProvider(params: {
  account: ResolvedInstagramAccount;
  cfg: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: InstagramMonitorOptions["statusSink"];
  abortSignal?: AbortSignal;
}) {
  const core = getInstagramRuntime();
  const logger = core.logging.getChildLogger({
    channel: "instagram",
    accountId: params.account.accountId,
    mode: "realtime",
  });
  const argv = buildInstagramRealtimeWatchArgv(params.account);
  if (!argv) {
    return null;
  }

  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: params.account.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let exited = false;
  let ready = false;
  let queue = Promise.resolve();
  let threadCache = new Map<string, { usernames: string[]; title?: string }>();
  let threadCacheLoadedAt = 0;

  const refreshThreadCache = async () => {
    const now = Date.now();
    if (now - threadCacheLoadedAt < 60_000 && threadCache.size > 0) {
      return;
    }
    const threads = await listInstagramThreads(params.account, { limit: 50 }).catch(() => []);
    threadCache = new Map(
      threads.map((thread) => [thread.id, { usernames: thread.usernames, title: thread.title }]),
    );
    threadCacheLoadedAt = now;
  };
  const waitForReady = new Promise<void>((resolve, reject) => {
    const onExit = () => {
      exited = true;
      reject(new Error("Instagram realtime watcher exited before ready"));
    };
    child.once("exit", onExit);

    const stdout = readline.createInterface({ input: child.stdout! });
    stdout.on("line", (line) => {
      let parsed: InstagramRealtimeEnvelope;
      try {
        parsed = JSON.parse(line) as InstagramRealtimeEnvelope;
      } catch {
        return;
      }
      if (parsed.type === "ready") {
        ready = true;
        child.off("exit", onExit);
        logger.info(`[${params.account.accountId}] Instagram realtime connected (${parsed.sessionUsername})`);
        resolve();
        return;
      }
      if (parsed.type === "error" && !ready) {
        child.off("exit", onExit);
        reject(new Error(parsed.message));
        return;
      }
      if (parsed.type !== "message") {
        return;
      }
      queue = queue
        .catch(() => {})
        .then(async () => {
          await refreshThreadCache();
          const thread = threadCache.get(parsed.data.threadId);
          const inbound: InstagramInboundMessage = {
            messageId: parsed.data.messageId,
            threadId: parsed.data.threadId,
            target: parsed.data.threadId,
            senderUsername: parsed.data.senderUsername,
            text: parsed.data.text,
            timestamp: parsed.data.timestamp,
            isGroup: (thread?.usernames.length ?? 0) > 1,
            usernames: thread?.usernames ?? [],
            title: thread?.title,
          };
          core.channel.activity.record({
            channel: "instagram",
            accountId: params.account.accountId,
            direction: "inbound",
            at: parsed.data.timestamp,
          });
          params.statusSink?.({
            lastPollAt: Date.now(),
            lastInboundAt: parsed.data.timestamp,
            lastError: null,
          });
          await handleInstagramInbound({
            message: inbound,
            account: params.account,
            config: params.cfg,
            runtime: params.runtime,
            statusSink: params.statusSink,
          });
          await markInstagramThreadRead(
            params.account,
            parsed.data.threadId,
            parsed.data.messageId,
          ).catch(() => {});
        })
        .catch((error) => {
          logger.error(`[${params.account.accountId}] Instagram realtime dispatch error: ${String(error)}`);
        });
    });
  });

  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      logger.warn(`[${params.account.accountId}] instagram realtime stderr: ${text}`);
    }
  });

  params.abortSignal?.addEventListener(
    "abort",
    () => {
      if (!exited) {
        child.kill("SIGTERM");
      }
    },
    { once: true },
  );

  await waitForReady;

  return {
    stop: () => {
      if (!exited) {
        child.kill("SIGTERM");
      }
    },
  };
}

function resolveThreadScanLimit(config: InstagramAccountConfig): number {
  const raw = Number(config?.historyLimit ?? 25);
  if (!Number.isFinite(raw)) {
    return 25;
  }
  return Math.max(5, Math.min(100, Math.trunc(raw)));
}

function resolveMessageScanLimit(config: InstagramAccountConfig): number {
  const raw = Number(config?.dmHistoryLimit ?? 10);
  if (!Number.isFinite(raw)) {
    return 10;
  }
  return Math.max(5, Math.min(50, Math.trunc(raw)));
}

function resolvePollIntervalMs(config: InstagramAccountConfig): number {
  const raw = Number(config?.pollIntervalMs ?? 5_000);
  if (!Number.isFinite(raw)) {
    return 5_000;
  }
  return Math.max(5_000, Math.min(300_000, Math.trunc(raw)));
}

function prioritizeThreads(
  threads: Awaited<ReturnType<typeof listInstagramThreads>>,
  state: InstagramPollState,
  limit: number,
) {
  return [...threads]
    .sort((left, right) => {
      if (left.unread !== right.unread) {
        return left.unread ? -1 : 1;
      }
      const leftSeen = state.threads[left.id]?.lastProcessedAt ?? 0;
      const rightSeen = state.threads[right.id]?.lastProcessedAt ?? 0;
      const leftActivity = left.lastActivity ? new Date(left.lastActivity).getTime() : 0;
      const rightActivity = right.lastActivity ? new Date(right.lastActivity).getTime() : 0;
      return Math.max(rightSeen, rightActivity) - Math.max(leftSeen, leftActivity);
    })
    .slice(0, limit);
}

export async function monitorInstagramProvider(
  opts: InstagramMonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getInstagramRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveInstagramAccount({
    cfg,
    accountId: opts.accountId,
  });
  const runtime =
    opts.runtime ??
    createLoggerBackedRuntime({
      logger: core.logging.getChildLogger(),
      exitError: () => new Error("Runtime exit not available"),
    });

  if (!account.configured) {
    throw new Error(`Instagram is not configured for account "${account.accountId}".`);
  }

  const realtimeMonitor = await monitorInstagramRealtimeProvider({
    account,
    cfg,
    runtime,
    statusSink: opts.statusSink,
    abortSignal: opts.abortSignal,
  }).catch(() => null);
  if (realtimeMonitor) {
    return realtimeMonitor;
  }

  const logger = core.logging.getChildLogger({
    channel: "instagram",
    accountId: account.accountId,
  });
  const stateFile = resolveStateFile(account.accountId);
  const threadScanLimit = resolveThreadScanLimit(account.config);
  const messageScanLimit = resolveMessageScanLimit(account.config);
  const pollIntervalMs = resolvePollIntervalMs(account.config);
  let stopped = false;

  const loop = async () => {
    const { value: state } = await readJsonFileWithFallback<InstagramPollState>(stateFile, {
      threads: {},
    });
    while (!stopped && !opts.abortSignal?.aborted) {
      try {
        const threads = await listInstagramThreads(account, { limit: threadScanLimit });
        const now = Date.now();
        opts.statusSink?.({ lastPollAt: now, lastError: null });

        for (const thread of prioritizeThreads(threads, state, threadScanLimit)) {
          const threadState = state.threads[thread.id] ?? {};
          const { messages } = await listInstagramMessages(account, {
            threadId: thread.id,
            limit: messageScanLimit,
            since: threadState.lastTimestamp,
          });
          const ordered = messages
            .filter((message) => !message.isOutgoing)
            .filter((message) => message.itemType === "text")
            .filter((message) => message.text?.trim())
            .sort((a, b) => {
              const left = a.timestamp ? new Date(a.timestamp).getTime() : 0;
              const right = b.timestamp ? new Date(b.timestamp).getTime() : 0;
              return left - right;
            });

          let latestId = threadState.lastMessageId;
          let latestTimestamp = threadState.lastTimestamp;
          for (const entry of ordered) {
            if (entry.id === threadState.lastMessageId) {
              continue;
            }
            const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
            const inbound: InstagramInboundMessage = {
              messageId: entry.id,
              threadId: thread.id,
              target: thread.id,
              senderUsername: entry.username ?? "",
              text: entry.text?.trim() ?? "",
              timestamp,
              isGroup: thread.usernames.length > 1,
              usernames: thread.usernames,
              title: thread.title,
            };
            core.channel.activity.record({
              channel: "instagram",
              accountId: account.accountId,
              direction: "inbound",
              at: timestamp,
            });
            await handleInstagramInbound({
              message: inbound,
              account,
              config: cfg,
              runtime,
              statusSink: opts.statusSink,
            });
            opts.statusSink?.({ lastInboundAt: timestamp });
            latestId = entry.id;
            latestTimestamp = entry.timestamp ?? latestTimestamp;
          }

          if (latestId) {
            state.threads[thread.id] = {
              lastMessageId: latestId,
              lastTimestamp: latestTimestamp,
              lastProcessedAt: now,
            };
            if (thread.unread) {
              await markInstagramThreadRead(account, thread.id, latestId).catch((error) => {
                logger.warn(`[${account.accountId}] failed to mark thread ${thread.id} read: ${String(error)}`);
              });
            }
          }
        }

        state.lastPollAt = now;
        await writeJsonFileAtomically(stateFile, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[${account.accountId}] Instagram monitor error: ${message}`);
        opts.statusSink?.({ lastError: message });
      }
      await waitForDelay(pollIntervalMs, opts.abortSignal);
    }
  };

  void loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
