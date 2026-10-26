import { validStableId, storeUrl } from "./stores.js";
import { STORAGE_KEYS } from "./constants.js";
import { readKey, writeLocal } from "./storage.js";
import { mutate } from "./queue.js";

export function sanitizeActions(raw = {}) {
  return Object.fromEntries(
    Object.entries(raw || {})
      .filter(
        ([id, v]) =>
          validStableId(id) && v && typeof v === "object",
      )
      .map(([id, v]) => [
        id,
        {
          url: storeUrl({ stableId: id, url: v.url }),
          claimed: v.claimed === true,
          ignored: v.ignored === true,
          snoozePending: v.snoozePending === true,
          hiddenCampaign:
            typeof v.hiddenCampaign === "string"
              ? v.hiddenCampaign.slice(0, 200)
              : "",
          snoozedUntil: Math.max(0, Number(v.snoozedUntil) || 0),
          title: String(v.title || id).slice(0, 300),
          updatedAt: Math.max(0, Number(v.updatedAt) || 0),
        },
      ])
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 2000),
  );
}
export const getActions = async () =>
  sanitizeActions(await readKey(STORAGE_KEYS.userActions, {}));
export function actionState(entry, actions, now = Date.now()) {
  const a = actions[entry.stableId] || {};
  if (a.claimed) return "claimed";
  if (a.ignored) return "ignored";
  if (a.hiddenCampaign && a.hiddenCampaign === entry.fingerprint)
    return "hidden";
  if (a.snoozedUntil > now) return "snoozed";
  return "";
}
export async function changeAction(stableId, action, payload = {}) {
  if (!validStableId(stableId))
    throw new Error("invalidData");
  return mutate(async () => {
    const actions = await getActions();
    const previous = actions[stableId] || null;
    const next = {
      ...previous,
      title: payload.title || previous?.title || stableId,
      url: storeUrl({ stableId, url: payload.url || previous?.url }),
      updatedAt: Date.now(),
    };
    if (action === "claim") next.claimed = true;
    else if (action === "ignore") next.ignored = true;
    else if (action === "hide" && payload.fingerprint)
      next.hiddenCampaign = payload.fingerprint;
    else if (action === "snooze") {
      next.snoozedUntil =
        Date.now() +
        Math.min(168, Math.max(1, Number(payload.hours) || 24)) * 3600000;
      next.snoozePending = true;
    } else if (action === "restore") {
      next.claimed = false;
      next.ignored = false;
      next.hiddenCampaign = "";
      next.snoozedUntil = 0;
      next.snoozePending = false;
    } else if (action === "undo") {
      if (payload.previous) actions[stableId] = payload.previous;
      else delete actions[stableId];
      await writeLocal({
        [STORAGE_KEYS.userActions]: sanitizeActions(actions),
      });
      return { ok: true };
    } else throw new Error("invalidData");
    actions[stableId] = next;
    await writeLocal({ [STORAGE_KEYS.userActions]: sanitizeActions(actions) });
    return { ok: true, previous };
  });
}
