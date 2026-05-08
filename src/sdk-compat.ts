import { z } from "zod";
import type { 
  ChannelAccountSnapshot, 
  ChannelConfigSchema, 
  OpenClawConfig,
  PluginRuntime,
  RuntimeEnv,
  PluginLogger,
  ChannelId
} from "openclaw/plugin-sdk";

export type { OpenClawConfig, RuntimeEnv, PluginRuntime, PluginLogger, ChannelId };
export type ChatType = "direct" | "group" | "channel";

/**
 * Compatibility layer for OpenClaw SDK changes.
 * This bridges the gap between old plugin code and the new SDK structure.
 */

export const DEFAULT_ACCOUNT_ID = "default";

/**
 * Re-implementation of missing SDK helpers.
 */

export function applyAccountNameToChannelSection(params: {
  cfg: any;
  sectionKey: string;
  accountId: string;
  name?: string;
}) {
  const { cfg, sectionKey, accountId, name } = params;
  if (!name) return cfg;
  const channels = cfg.channels ?? {};
  const channelConfig = channels[sectionKey] ?? {};
  const accounts = channelConfig.accounts ?? {};
  const account = accounts[accountId] ?? {};
  
  return {
    ...cfg,
    channels: {
      ...channels,
      [sectionKey]: {
        ...channelConfig,
        accounts: {
          ...accounts,
          [accountId]: {
            ...account,
            name,
          },
        },
      },
    },
  };
}

export function migrateBaseNameToDefaultAccount(params: {
  cfg: any;
  sectionKey: string;
  clearBaseFields: string[];
}) {
  const { cfg, sectionKey, clearBaseFields } = params;
  const channels = cfg.channels ?? {};
  const channelConfig = channels[sectionKey];
  if (!channelConfig) return cfg;

  const defaultAccount = channelConfig.accounts?.[DEFAULT_ACCOUNT_ID] ?? {};
  const newDefaultAccount = { ...defaultAccount };
  let moved = false;

  for (const field of clearBaseFields) {
    if (channelConfig[field] !== undefined) {
      newDefaultAccount[field] = channelConfig[field];
      moved = true;
    }
  }

  if (!moved) return cfg;

  const newChannelConfig = { ...channelConfig };
  for (const field of clearBaseFields) {
    delete newChannelConfig[field];
  }

  return {
    ...cfg,
    channels: {
      ...channels,
      [sectionKey]: {
        ...newChannelConfig,
        accounts: {
          ...(newChannelConfig.accounts ?? {}),
          [DEFAULT_ACCOUNT_ID]: newDefaultAccount,
        },
      },
    },
  };
}

/**
 * Modern buildChannelConfigSchema returns an object with both zod and json schema.
 */
export function buildChannelConfigSchema(zodSchema: z.ZodTypeAny): ChannelConfigSchema {
  return {
    schema: {
      type: "object",
      additionalProperties: true,
    },
    runtime: {
      safeParse: (value: unknown) => {
        const result = zodSchema.safeParse(value);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return {
          success: false,
          issues: result.error.issues.map((issue) => ({
            path: issue.path as (string | number)[],
            message: issue.message,
          })),
        };
      },
    },
  };
}

export function requireOpenAllowFrom(params: {
  policy?: string;
  allowFrom?: any[];
  ctx: z.RefinementCtx;
  path: (string | number)[];
  message: string;
}) {
  if (params.policy === "open" && !params.allowFrom?.includes("*")) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: params.message,
      path: params.path,
    });
  }
}

/**
 * Compatibility helper to set account enabled state in config.
 */
export function setAccountEnabledInConfigSection(params: {
  cfg: any;
  sectionKey: string;
  accountId: string;
  enabled: boolean;
  allowTopLevel?: boolean;
}) {
  const { cfg, sectionKey, accountId, enabled } = params;
  const channels = cfg.channels ?? {};
  const channelConfig = channels[sectionKey] ?? {};
  const accounts = channelConfig.accounts ?? {};
  const account = accounts[accountId] ?? {};

  return {
    ...cfg,
    channels: {
      ...channels,
      [sectionKey]: {
        ...channelConfig,
        accounts: {
          ...accounts,
          [accountId]: {
            ...account,
            enabled,
          },
        },
      },
    },
  };
}

/**
 * Compatibility helper to delete an account from config.
 */
export function deleteAccountFromConfigSection(params: {
  cfg: any;
  sectionKey: string;
  accountId: string;
  clearBaseFields?: string[];
}) {
  const { cfg, sectionKey, accountId } = params;
  const channels = cfg.channels ?? {};
  const channelConfig = channels[sectionKey];
  if (!channelConfig) return cfg;

  const accounts = { ...(channelConfig.accounts ?? {}) };
  delete accounts[accountId];

  return {
    ...cfg,
    channels: {
      ...channels,
      [sectionKey]: {
        ...channelConfig,
        accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
      },
    },
  };
}

/**
 * Compatibility helper to build an empty plugin config schema.
 */
export function emptyPluginConfigSchema() {
  return z.object({});
}

/**
 * Modern SDK schemas re-implemented for compatibility.
 */
export const DmPolicySchema = z.enum(["pairing", "allowlist", "open", "disabled"]);
export const GroupPolicySchema = z.enum(["open", "disabled", "allowlist"]);
export const ToolPolicySchema = z.any();
export const MarkdownConfigSchema = z.any();
export const DmConfigSchema = z.any();
export const BlockStreamingCoalesceSchema = z.any();
export const ReplyRuntimeConfigSchemaShape = {};

/**
 * Missing Outbound/Inbound helpers.
 */

export function createNormalizedOutboundDeliverer(deliver: (payload: any) => Promise<void>) {
  return async (payload: any) => {
    // Legacy normalization would happen here.
    await deliver(payload);
  };
}

export function formatTextWithAttachmentLinks(text: string, mediaUrls: string[]) {
  if (!text && mediaUrls.length === 0) return "";
  if (mediaUrls.length === 0) return text;
  return `${text}\n\n${mediaUrls.join("\n")}`;
}

export function resolveOutboundMediaUrls(payload: any): string[] {
  if (Array.isArray(payload?.media)) {
    return payload.media.map((m: any) => (typeof m === "string" ? m : m?.url)).filter(Boolean);
  }
  return [];
}

export function logInboundDrop(params: {
  log: (line: string) => void;
  channel: string;
  reason: string;
  target: string;
}) {
  params.log(`${params.channel}: drop ${params.target} (${params.reason})`);
}

/**
 * Runtime helpers.
 */

export function createLoggerBackedRuntime(params: {
  logger: any;
  exitError?: () => Error;
}): any {
  return {
    log: (line: string) => params.logger?.info?.(line),
    error: (line: string) => params.logger?.error?.(line),
    logging: {
      getChildLogger: () => params.logger
    }
  };
}

/**
 * File IO helpers (moved or removed).
 */
import * as fs from "node:fs/promises";

export async function readJsonFileWithFallback<T>(path: string, fallback: T): Promise<{ value: T }> {
  try {
    const data = await fs.readFile(path, "utf8");
    return { value: JSON.parse(data) };
  } catch {
    return { value: fallback };
  }
}

export async function writeJsonFileAtomically(path: string, data: any) {
  const content = JSON.stringify(data, null, 2);
  const tmpPath = `${path}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, path);
}

/**
 * Type compatibility.
 */
export type OutboundReplyPayload = any;
export type BaseProbeResult<TError = string | null> = { ok: boolean; error?: TError; value?: string; latencyMs?: number };
export type BlockStreamingCoalesceConfig = any;
export type DmConfig = any;
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type GroupPolicy = "open" | "disabled" | "allowlist";
export type GroupToolPolicyBySenderConfig = any;
export type GroupToolPolicyConfig = any;
export type MarkdownConfig = any;

/**
 * Status helpers.
 */

export function buildBaseAccountStatusSnapshot(params: {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
}) {
  return {
    accountId: params.accountId,
    enabled: params.enabled,
    configured: params.configured,
    name: params.name,
  };
}

export function buildBaseChannelStatusSummary(snapshot: any) {
  return {
    connected: snapshot.extra?.connected ?? false,
  };
}

export function formatPairingApproveHint(code: string) {
  return `Approve with command: approve ${code}`;
}

/**
 * Export specialized sub-paths from the main openclaw package.
 * Note: These require the consumer to have correctly configured module resolution.
 */
export { 
  createReplyPrefixOptions 
} from "openclaw/plugin-sdk/channel-reply-pipeline";

export {
  createChatChannelPlugin
} from "openclaw/plugin-sdk/channel-core";
