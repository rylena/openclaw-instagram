#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

type BridgeEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  meta?: Record<string, unknown>;
};

function ok<T>(data: T, meta?: Record<string, unknown>): BridgeEnvelope<T> {
  return { ok: true, data, meta };
}

function fail(code: string, message: string, retryable = false): BridgeEnvelope<never> {
  return { ok: false, error: { code, message, retryable } };
}

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
  const command = argv[index] ?? "";
  const rest = argv.slice(index + 1);
  return { cliDir, sessionUsername, command, rest };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function createClient(cliDir: string, sessionUsername: string) {
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
    throw new Error("No Instagram session username configured");
  }

  const sessionManager = new SessionManager(username);
  const sessionExists = await sessionManager.sessionExists();
  if (!sessionExists) {
    throw new Error(`No Instagram session found for ${username}`);
  }

  const client = new InstagramClient(username);
  const loginResult = await client.loginBySession({ initializeRealtime: false });
  if (!loginResult.success) {
    throw new Error(loginResult.error ?? "Instagram session login failed");
  }

  return { client, username };
}

async function main() {
  const { cliDir, sessionUsername, command, rest } = parseArgs(process.argv.slice(2));
  if (!cliDir) {
    console.log(JSON.stringify(fail("CONFIG_ERROR", "missing --cli-dir")));
    process.exit(1);
  }
  if (!command) {
    console.log(JSON.stringify(fail("CONFIG_ERROR", "missing bridge command")));
    process.exit(1);
  }

  try {
    const { client } = await createClient(cliDir, sessionUsername);

    if (command === "threads") {
      const limit = Number.parseInt(readOption(rest, "--limit") ?? "100", 10);
      const result = await client.getThreads(false);
      const items = result.threads.slice(0, limit).map((thread: any) => ({
        id: thread.id,
        title: thread.title,
        lastActivity: thread.lastActivity instanceof Date
          ? thread.lastActivity.toISOString()
          : new Date(thread.lastActivity).toISOString(),
        unread: Boolean(thread.unread),
        usernames: Array.isArray(thread.users)
          ? thread.users.map((user: any) => String(user.username ?? "").toLowerCase()).filter(Boolean)
          : [],
        lastMessageText: thread.lastMessage?.itemType === "text" ? thread.lastMessage.text : undefined,
      }));
      console.log(JSON.stringify(ok(items, { count: items.length, hasMore: result.hasMore })));
      return;
    }

    if (command === "messages") {
      const threadId = rest[0];
      if (!threadId) {
        throw new Error("messages requires threadId");
      }
      const limit = Number.parseInt(readOption(rest, "--limit") ?? "50", 10);
      const since = readOption(rest, "--since");
      const cursor = readOption(rest, "--cursor");
      const result = await client.getMessages(threadId, cursor);
      const sinceTs = since ? new Date(since).getTime() : undefined;
      const items = result.messages
        .filter((message: any) => !sinceTs || message.timestamp.getTime() > sinceTs)
        .slice(-limit)
        .map((message: any) => ({
          id: message.id,
          threadId: message.threadId,
          username: message.username,
          itemType: message.itemType,
          isOutgoing: Boolean(message.isOutgoing),
          timestamp: message.timestamp instanceof Date
            ? message.timestamp.toISOString()
            : new Date(message.timestamp).toISOString(),
          text: message.itemType === "text" || message.text ? message.text : undefined,
        }));
      console.log(JSON.stringify(ok(items, { cursor: result.cursor })));
      return;
    }

    if (command === "send") {
      const threadId = rest[0];
      const text = rest[1];
      if (!threadId || !text) {
        throw new Error("send requires threadId and text");
      }
      await client.sendMessage(threadId, text);
      console.log(JSON.stringify(ok({ sent: true })));
      return;
    }

    if (command === "mark-read") {
      const threadId = rest[0];
      const itemId = rest[1];
      if (!threadId || !itemId) {
        throw new Error("mark-read requires threadId and itemId");
      }
      await client.markThreadAsSeen(threadId, itemId);
      console.log(JSON.stringify(ok({ marked: true, threadId, itemId })));
      return;
    }

    console.log(JSON.stringify(fail("UNKNOWN_COMMAND", `unknown bridge command: ${command}`)));
    process.exit(1);
  } catch (error) {
    console.log(
      JSON.stringify(
        fail("BRIDGE_ERROR", error instanceof Error ? error.message : String(error), true),
      ),
    );
    process.exit(1);
  }
}

await main();
