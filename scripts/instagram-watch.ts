#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function parseArgs(argv: string[]) {
  let cliDir = "";
  let sessionUsername = "";
  let index = 0;
  while (index < argv.length) {
    const current = argv[index];
    if (current === "--cli-dir") {
      cliDir = argv[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (current === "--session") {
      sessionUsername = argv[index + 1] ?? "";
      index += 2;
      continue;
    }
    break;
  }
  return { cliDir, sessionUsername };
}

function emit(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  const { cliDir, sessionUsername } = parseArgs(process.argv.slice(2));
  if (!cliDir) {
    emit({ type: "error", message: "missing --cli-dir" });
    process.exit(1);
  }

  const clientUrl = pathToFileURL(path.join(cliDir, "dist", "client.js")).href;
  const configUrl = pathToFileURL(path.join(cliDir, "dist", "config.js")).href;
  const sessionUrl = pathToFileURL(path.join(cliDir, "dist", "session.js")).href;

  const [{ InstagramClient }, { ConfigManager }, { SessionManager }] = await Promise.all([
    import(clientUrl),
    import(configUrl),
    import(sessionUrl),
  ]);

  const config = ConfigManager.getInstance();
  await config.initialize();

  const username =
    sessionUsername.trim() ||
    config.get("login.currentUsername") ||
    config.get("login.defaultUsername") ||
    "";
  if (!username) {
    emit({ type: "error", message: "No Instagram session username configured" });
    process.exit(1);
  }

  const sessionManager = new SessionManager(username);
  const sessionData = await sessionManager.loadSession();
  if (!sessionData) {
    emit({ type: "error", message: `No Instagram session found for ${username}` });
    process.exit(1);
  }

  const client = new InstagramClient(username);
  const ig = client.getInstagramClient();
  ig.state.generateDevice(username);
  await ig.state.deserialize(sessionData);

  client.on("error", (error: unknown) => {
    emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });

  client.on("message", (message: any) => {
    if (!message || message.isOutgoing || message.itemType !== "text" || !message.text?.trim()) {
      return;
    }
    emit({
      type: "message",
      data: {
        messageId: String(message.id),
        threadId: String(message.threadId),
        senderUsername: String(message.username ?? "").trim().toLowerCase(),
        text: String(message.text ?? "").trim(),
        timestamp: message.timestamp instanceof Date
          ? message.timestamp.getTime()
          : new Date(message.timestamp ?? Date.now()).getTime(),
      },
    });
  });

  const initializeRealtime = (client as { initializeRealtime?: () => Promise<void> }).initializeRealtime;
  if (!initializeRealtime) {
    emit({ type: "error", message: "Realtime initialization is not available" });
    process.exit(1);
  }

  await initializeRealtime.call(client);
  emit({ type: "ready", sessionUsername: username });

  const shutdown = async () => {
    try {
      await client.shutdown();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error) => {
  emit({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
