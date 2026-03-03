# OpenClaw Instagram Plugin

Standalone Instagram channel plugin for OpenClaw.

It uses [`instagram-cli-4llm`](https://github.com/rylena/instagram-cli-4llm) as the transport layer,
so OpenClaw can read and send Instagram DMs without patching core OpenClaw.

## What this repo is

- External plugin, not part of the OpenClaw monorepo
- Installable from a local path with `openclaw plugins install`
- Configures the `instagram` channel under `channels.instagram`

## Fast local install

Clone this repo somewhere local, then run:

```bash
node scripts/setup-local.mjs --session-username YOUR_INSTAGRAM_USERNAME
```

That script will:

1. Link this plugin into OpenClaw with `openclaw plugins install --link`
2. Clone `instagram-cli-4llm` next to this repo if it is missing
3. Run `pnpm install` in `instagram-cli-4llm`
4. Write a minimal `channels.instagram` config into your OpenClaw config file

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
      "dmPolicy": "pairing",
      "pollIntervalMs": 30000
    }
  }
}
```

## Notes

- Direct targets can be `@username` or `thread:<id>`.
- Polling checkpoints are written under the OpenClaw state dir in `instagram/<account>.json`.
- The plugin expects a working Instagram CLI session for the configured `sessionUsername`.
- `openclaw plugins install` installs plugin dependencies automatically, but `instagram-cli-4llm`
  still needs its own dependencies installed.
