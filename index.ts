import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "./src/sdk-compat.js";
import { instagramPlugin } from "./src/channel.js";
import { setInstagramRuntime } from "./src/runtime.js";

const plugin = {
  id: "instagram",
  name: "Instagram",
  description: "Instagram channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    console.log(`[instagram] Registering Instagram plugin (mode: ${api.registrationMode})...`);
    setInstagramRuntime(api.runtime);
    api.registerChannel({ plugin: instagramPlugin as ChannelPlugin });
    console.log("[instagram] api.registerChannel called.");
  },
};

export default plugin;
