# OpenClaw Instagram Plugin

Standalone Instagram channel plugin for OpenClaw.

It uses [`instagram-cli-4llm`](https://github.com/rylena/instagram-cli-4llm) as the transport layer,
so OpenClaw can read and send Instagram DMs without patching core OpenClaw.

Use a private Instagram account for this plugin.
Do not point it at your main personal account.

## What this repo is

- External plugin, not part of the OpenClaw monorepo
- Installable from a local path with `openclaw plugins install`
- Configures the `instagram` channel under `channels.instagram`

## Fast local install

One-shot installer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/rylena/openclaw-instagram/main/install.sh) \
  --session-username YOUR_INSTAGRAM_SESSION \
  --ig-username YOUR_INSTAGRAM_USERNAME
```

For non-interactive login:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/rylena/openclaw-instagram/main/install.sh) \
  --session-username YOUR_INSTAGRAM_SESSION \
  --ig-username YOUR_INSTAGRAM_USERNAME \
  --ig-password 'YOUR_INSTAGRAM_PASSWORD'
```

The installer will clone/update this repo into `~/.openclaw/plugins-src/openclaw-instagram`, then
run the local setup flow.

## Local repo install

Clone this repo somewhere local, then run:

```bash
node scripts/setup-local.mjs --session-username YOUR_INSTAGRAM_USERNAME
```

That script will:

1. Link this plugin into OpenClaw with `openclaw plugins install --link`
2. Clone `instagram-cli-4llm` next to this repo if it is missing
3. Run `pnpm install` in `instagram-cli-4llm`
4. Optionally log into Instagram through `instagram-cli`
5. Write a minimal `channels.instagram` config into your OpenClaw config file with open DM access enabled by default

After that, restart OpenClaw.

## Manual install

```bash
openclaw plugins install --link /absolute/path/to/openclaw-instagram
```

Minimal config:

```json
{
  "channels": {
    "instagram": {
      "cliPath": "pnpm",
      "cliArgs": [
        "--dir",
        "/absolute/path/to/instagram-cli-4llm",
        "exec",
        "instagram-cli"
      ],
      "sessionUsername": "your_instagram_username",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "pollIntervalMs": 5000,
      "historyLimit": 25,
      "dmHistoryLimit": 10
    }
  }
}
```

## Notes

- Direct targets can be `@username` or `thread:<id>`.
- Polling checkpoints are written under the OpenClaw state dir in `instagram/<account>.json`.
- The plugin expects a working Instagram CLI session for the configured `sessionUsername`.
- The quick installer defaults to `dmPolicy: "open"` with `allowFrom: ["*"]` so the bot can answer immediately after install.
- The quick installer also defaults to a faster poll profile: `pollIntervalMs: 5000`, `historyLimit: 25`, `dmHistoryLimit: 10`.
- Use a private Instagram account dedicated to automation and testing.
- `openclaw plugins install` installs plugin dependencies automatically, but `instagram-cli-4llm`
  still needs its own dependencies installed.
- If you pass `--ig-username` without `--ig-password`, the installer opens the interactive
  Instagram CLI login form.
