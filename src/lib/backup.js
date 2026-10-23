import { sanitizeSettings } from "./settings.js";
import { getActions, sanitizeActions } from "./actions.js";
import { readKey, writeLocal } from "./storage.js";
import { mutate } from "./queue.js";

export async function exportBackup() {
  return {
    format: "steam-promo-watch",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: sanitizeSettings(await readKey("settings", {})),
    userActions: await getActions(),
  };
}
export function validateBackup(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (!text || text.length > 1024 * 1024) throw new Error("invalidBackup");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("invalidBackup");
  }
  if (data?.format !== "steam-promo-watch" || data.version !== 1)
    throw new Error("unsupportedBackup");
  if (
    !data.settings ||
    typeof data.settings !== "object" ||
    Array.isArray(data.settings) ||
    !data.userActions ||
    typeof data.userActions !== "object" ||
    Array.isArray(data.userActions)
  )
    throw new Error("invalidBackup");
  if (
    Object.keys(data.userActions).length > 2000 ||
    Object.entries(data.userActions).some(
      ([k, v]) =>
        !/^(app|sub):[1-9]\d*$/.test(k) ||
        !v ||
        typeof v !== "object" ||
        Array.isArray(v),
    )
  )
    throw new Error("invalidBackup");
  return {
    settings: sanitizeSettings(data.settings),
    userActions: sanitizeActions(data.userActions),
  };
}
export async function importBackup(input) {
  const data = validateBackup(input);
  await mutate(() => writeLocal({ ...data, metadataCache: {} }));
  return {
    ok: true,
    settings: data.settings,
    count: Object.keys(data.userActions).length,
  };
}
