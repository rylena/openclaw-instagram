import {
  applyAccountNameToChannelSection,
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  createChatChannelPlugin,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  setAccountEnabledInConfigSection,
  type OpenClawConfig,
  type ChatType,
} from "./sdk-compat.js";
import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { InstagramConfigSchema } from "./config-schema.js";
import {
  listInstagramAccountIds,
  resolveDefaultInstagramAccountId,
  resolveInstagramAccount,
} from "./accounts.js";
import {
  listInstagramThreads,
  probeInstagram,
  resolveInstagramTargets,
} from "./client.js";
import { normalizeInstagramMessagingTarget, normalizeInstagramUsername, looksLikeInstagramTargetId } from "./normalize.js";
import { monitorInstagramProvider } from "./monitor.js";
import type { CoreConfig, InstagramProbe, ResolvedInstagramAccount } from "./types.js";

const meta = {
  id: "instagram",
  label: "Instagram",
  selectionLabel: "Instagram (plugin)",
  detailLabel: "Instagram CLI",
  docsPath: "/channels/instagram",
  docsLabel: "instagram",
  blurb: "routes Instagram DMs and group chats through instagram-cli LLM commands.",
  systemImage: "camera",
  order: 75,
  quickstartAllowFrom: true,
} as const;

function formatAllowEntry(entry: string): string {
  const username = normalizeInstagramUsername(entry);
  if (!username) {
    return "";
  }
  if (username === "*") {
    return "*";
  }
  return `@${username}`;
}

export const instagramPlugin: ChannelPlugin<ResolvedInstagramAccount, InstagramProbe> = 
  createChatChannelPlugin<ResolvedInstagramAccount, InstagramProbe>({
    base: {
      id: "instagram",
      meta: {
        ...meta,
      },
      capabilities: {
        chatTypes: ["direct", "group"],
        reactions: false,
        threads: false,
        media: true,
        nativeCommands: true,
      },
      reload: { configPrefixes: ["channels.instagram"] },
      configSchema: buildChannelConfigSchema(InstagramConfigSchema),
      config: {
        listAccountIds: (cfg: OpenClawConfig) => listInstagramAccountIds(cfg as CoreConfig),
        resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => {
          if (!accountId) return {} as any;
          return resolveInstagramAccount({ cfg: cfg as CoreConfig, accountId });
        },
        defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultInstagramAccountId(cfg as CoreConfig),
        setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) =>
          setAccountEnabledInConfigSection({
            cfg,
            sectionKey: "instagram",
            accountId,
            enabled,
            allowTopLevel: true,
          }),
        deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
          deleteAccountFromConfigSection({
            cfg,
            sectionKey: "instagram",
            accountId,
            clearBaseFields: ["cliPath", "cwd", "sessionUsername", "name"],
          }),
        isConfigured: (account: ResolvedInstagramAccount) => account.configured,
        describeAccount: (account: ResolvedInstagramAccount) => ({
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: account.configured,
          extra: {
            cliPath: account.cliPath,
            cwd: account.cwd,
            sessionUsername: account.sessionUsername,
          }
        }),
        resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) => {
          if (!accountId) return [];
          return (resolveInstagramAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map((entry) =>
            String(entry),
          );
        },
        formatAllowFrom: ({ allowFrom }: { cfg: OpenClawConfig; accountId?: string | null; allowFrom: (string | number)[] }) =>
          allowFrom.map((entry) => formatAllowEntry(String(entry))).filter(Boolean),
      },
      setup: {
        applyAccountConfig: ({ cfg, accountId, input }: { cfg: OpenClawConfig; accountId: string; input: any }) => {
          const namedConfig = applyAccountNameToChannelSection({
            cfg,
            sectionKey: "instagram",
            accountId,
            name: input.name,
          });
          const next = migrateBaseNameToDefaultAccount({
            cfg: namedConfig,
            sectionKey: "instagram",
            clearBaseFields: ["cliPath", "cwd", "sessionUsername", "name"],
          });
          
          const instagramCfg = (next as any).channels?.instagram ?? {};
          const accounts = instagramCfg.accounts ?? {};
          const account = accounts[accountId] ?? {};
          
          return {
            ...next,
            channels: {
              ...(next as any).channels,
              instagram: {
                ...instagramCfg,
                accounts: {
                  ...accounts,
                  [accountId]: {
                    ...account,
                    ...(input.cliPath ? { cliPath: input.cliPath } : {}),
                    enabled: true,
                  },
                },
              },
            },
          } as OpenClawConfig;
        },
      },
      directory: {
        self: async () => null,
        listPeers: async ({ cfg, accountId, query, limit }: any) => {
          if (!accountId) return [];
          const account = resolveInstagramAccount({ cfg: cfg as CoreConfig, accountId });
          const threads = await listInstagramThreads(account, { limit: 100 });
          const q = query?.trim().toLowerCase() ?? "";
          return threads
            .filter((thread) => thread.usernames.length <= 1)
            .flatMap((thread) =>
              thread.usernames.map((username) => ({
                kind: "user" as const,
                id: username,
                name: `@${username}`,
                threadId: thread.id,
              })),
            )
            .filter((entry) => (q ? entry.id.includes(q) : true))
            .slice(0, limit && limit > 0 ? limit : undefined);
        },
        listGroups: async ({ cfg, accountId, query, limit }: any) => {
          if (!accountId) return [];
          const account = resolveInstagramAccount({ cfg: cfg as CoreConfig, accountId });
          const threads = await listInstagramThreads(account, { limit: 100 });
          const q = query?.trim().toLowerCase() ?? "";
          return threads
            .filter((thread) => thread.usernames.length > 1)
            .map((thread) => ({
              kind: "group" as const,
              id: thread.id,
              name: thread.title || thread.usernames.join(", "),
            }))
            .filter((entry) => (q ? entry.name.toLowerCase().includes(q) : true))
            .slice(0, limit && limit > 0 ? limit : undefined);
        },
      },
      status: {
        buildAccountSnapshot: ({ account, runtime, probe }: any) => {
          const snapshot = buildBaseAccountStatusSnapshot({
            accountId: account.accountId,
            enabled: account.enabled,
            configured: account.configured,
            name: account.name,
          });
          return {
            ...snapshot,
            extra: {
              ...(runtime || {}),
              probe,
            },
          } as any;
        },
        buildChannelSummary: ({ snapshot }: { snapshot: any }) => buildBaseChannelStatusSummary(snapshot),
        probeAccount: async ({ account }: { account: ResolvedInstagramAccount }) => await probeInstagram(account),
      },
      gateway: {
        startAccount: async (ctx: any) => {
          console.log(`[instagram] Starting account: ${ctx.accountId}`);
          const monitor = await monitorInstagramProvider({
            accountId: ctx.accountId,
            config: ctx.cfg as CoreConfig,
            runtime: ctx.runtime,
            abortSignal: ctx.abortSignal,
            statusSink: (patch: any) => ctx.setStatus({ ...ctx.getStatus(), ...patch }),
          });
          console.log(`[instagram] Monitor started for account: ${ctx.accountId}`);

          // Block until aborted
          await new Promise<void>((resolve) => {
            const onAbort = () => {
              monitor.stop();
              resolve();
            };
            if (ctx.abortSignal.aborted) {
              onAbort();
            } else {
              ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
            }
          });
        },
        stopAccount: async () => {},
      },
      messaging: {
        targetPrefixes: ["instagram"],
        normalizeTarget: normalizeInstagramMessagingTarget,
        targetResolver: {
          looksLikeId: looksLikeInstagramTargetId,
          hint: "<thread:ID|@username>",
        },
      },
      resolver: {
        resolveTargets: async ({ cfg, accountId, inputs, kind }: any) => {
          const account = resolveInstagramAccount({ cfg: cfg as CoreConfig, accountId });
          return await resolveInstagramTargets({
            account,
            inputs,
            kind: kind === "group" ? "group" : "peer",
          });
        },
      },
    },
    pairing: {
      text: {
        idLabel: "instagramUser",
        normalizeAllowEntry: (entry: string) => normalizeInstagramUsername(entry),
        notify: async () => {}, // Not used by legacy instagram plugin
        message: "Instagram pairing approved",
      }
    },
    security: {
      resolveDmPolicy: ({ account }: { account: ResolvedInstagramAccount }) => ({
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: (account.config.allowFrom ?? []).map((entry) => String(entry)),
        policyPath: "channels.instagram.dmPolicy",
        allowFromPath: "channels.instagram.allowFrom",
        approveHint: formatPairingApproveHint("instagram"),
        normalizeEntry: (raw: string) => normalizeInstagramUsername(raw),
      }),
    },
  });
