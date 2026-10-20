import { registerOnResumeFromSuspend } from "./platform/steam-compat";
import type { SteamListenerNamespace } from "./platform/steam-compat";

type PluginDescriptor = { onDismount?: () => void };

export function attachResumeRegistration<T extends PluginDescriptor>(descriptor: T, onResume: () => void, namespace: SteamListenerNamespace = "production"): T {
  const unregisterResume = registerOnResumeFromSuspend(onResume, namespace);
  return {
    ...descriptor,
    onDismount: () => {
      unregisterResume();
      descriptor.onDismount?.();
    }
  };
}
