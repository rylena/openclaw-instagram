#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const out = {
    sessionUsername: "",
    igUsername: "",
    igPassword: "",
    instagramCliDir: "",
    configPath: "",
    link: true,
    skipCliInstall: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "--session-username") {
      out.sessionUsername = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--instagram-cli-dir") {
      out.instagramCliDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--ig-username") {
      out.igUsername = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--ig-password") {
      out.igPassword = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--config") {
      out.configPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--copy") {
      out.link = false;
      continue;
    }
    if (arg === "--skip-cli-install") {
      out.skipCliInstall = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!out.sessionUsername.trim()) {
    throw new Error("--session-username is required");
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/setup-local.mjs --session-username YOUR_INSTAGRAM_USERNAME [options]

Options:
  --instagram-cli-dir <path>   Path to instagram-cli-4llm
  --ig-username <username>     Instagram username for login
  --ig-password <password>     Instagram password for login
  --config <path>              OpenClaw config path
  --copy                       Install plugin by copy instead of --link
  --skip-cli-install           Skip cloning/installing instagram-cli-4llm deps
  -h, --help                   Show help`);
}

function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${argv.join(" ")}`);
  }
}

function runFirstAvailable(candidates, options = {}) {
  for (const argv of candidates) {
    const result = spawnSync(argv[0], argv.slice(1), {
      stdio: "inherit",
      ...options,
    });
    if (result.error && result.error.code === "ENOENT") {
      continue;
    }
    if (result.status === 0) {
      return;
    }
    throw new Error(`command failed: ${argv.join(" ")}`);
  }
  throw new Error(`no supported command found: ${candidates.map((argv) => argv[0]).join(", ")}`);
}

function resolveDefaultConfigPath() {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_CONFIG_PATH.trim());
  }
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function saveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensurePluginConfigured(configPath, repoRoot) {
  const current = loadJson(configPath);
  const existingPaths = Array.isArray(current.plugins?.load?.paths)
    ? current.plugins.load.paths.filter((value) => typeof value === "string" && value.trim())
    : [];
  const nextPaths = Array.from(new Set([...existingPaths, repoRoot]));
  return {
    ...current,
    plugins: {
      ...current.plugins,
      load: {
        ...current.plugins?.load,
        paths: nextPaths,
      },
      entries: {
        ...current.plugins?.entries,
        instagram: {
          ...(current.plugins?.entries?.instagram ?? {}),
          enabled: true,
        },
      },
    },
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const instagramCliDir = path.resolve(
  args.instagramCliDir || path.join(repoRoot, "..", "instagram-cli-4llm"),
);
const configPath = path.resolve(args.configPath || resolveDefaultConfigPath());

runFirstAvailable([
  ["npm", "install", "--omit=dev", "--legacy-peer-deps"],
  ["pnpm", "install", "--prod", "--ignore-workspace"],
], { cwd: repoRoot });

if (!args.skipCliInstall) {
  if (!fs.existsSync(instagramCliDir)) {
    run(["git", "clone", "https://github.com/rylena/instagram-cli-4llm.git", instagramCliDir]);
  }
  run(["pnpm", "install"], { cwd: instagramCliDir });
}

const instagramCliArgv = ["pnpm", "--dir", instagramCliDir, "exec", "instagram-cli"];

if (args.igUsername.trim() && args.igPassword.trim()) {
  run([...instagramCliArgv, "auth", "login", args.igUsername.trim(), args.igPassword]);
} else if (args.igUsername.trim()) {
  run([...instagramCliArgv, "auth", "login", "--username", args.igUsername.trim()]);
}

const current = ensurePluginConfigured(configPath, repoRoot);
const next = {
  ...current,
  channels: {
    ...current.channels,
    instagram: {
      ...(current.channels?.instagram ?? {}),
      cliPath: "pnpm",
      cliArgs: ["--dir", instagramCliDir, "exec", "instagram-cli"],
      sessionUsername: args.sessionUsername,
      dmPolicy: current.channels?.instagram?.dmPolicy ?? "open",
      allowFrom: current.channels?.instagram?.allowFrom ?? ["*"],
      pollIntervalMs: current.channels?.instagram?.pollIntervalMs ?? 5000,
      historyLimit: current.channels?.instagram?.historyLimit ?? 25,
      dmHistoryLimit: current.channels?.instagram?.dmHistoryLimit ?? 10,
    },
  },
};

saveJson(configPath, next);

console.log("");
console.log("Instagram plugin configured.");
console.log(`Plugin repo: ${repoRoot}`);
console.log(`instagram-cli-4llm: ${instagramCliDir}`);
console.log(`OpenClaw config: ${configPath}`);
console.log("");
console.log("Default channel policy:");
console.log('- dmPolicy: "open"');
console.log('- allowFrom: ["*"]');
console.log("- pollIntervalMs: 5000");
console.log("- historyLimit: 25");
console.log("- dmHistoryLimit: 10");
console.log("");
console.log("Next steps:");
if (!args.igUsername.trim()) {
  console.log(
    `1. Log into instagram-cli: ${instagramCliArgv.join(" ")} auth login --username`,
  );
  console.log("2. Restart OpenClaw.");
  console.log("3. Test an Instagram DM.");
} else {
  console.log("1. Restart OpenClaw.");
  console.log("2. Test an Instagram DM.");
}
