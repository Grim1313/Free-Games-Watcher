// Firefox exposes Promise-based APIs through browser; Chromium through chrome.
// Resolve at call time so Node tests can provide isolated API implementations.
export function extensionApi() {
  return globalThis.browser ?? globalThis.chrome;
}

export function isFirefox() {
  return extensionApi()?.runtime?.getURL("").startsWith("moz-extension://") || false;
}

export async function missingHostPermissions() {
  const api = extensionApi();
  if (!api?.permissions?.contains) return [];
  const origins = api.runtime.getManifest().host_permissions || [];
  if (await api.permissions.contains({ origins })) return [];
  const granted = await Promise.all(origins.map((origin) => api.permissions.contains({ origins: [origin] })));
  return origins.filter((_, index) => !granted[index]);
}
