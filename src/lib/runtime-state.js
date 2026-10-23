import { STORAGE_KEYS } from "./constants.js";
import { readKey, writeLocal } from "./storage.js";
import { clamp, safeNumber } from "./utils.js";

export const INTERRUPTED_CHECK_MESSAGE =
  "Previous check was interrupted. Run Check now again.";

export const DEFAULT_RUNTIME_STATE = Object.freeze({
  checkInProgress: false,
  lastCheckStartedAt: 0,
  lastCheckFinishedAt: 0,
  lastSuccessAt: 0,
  lastFullSuccessAt: 0,
  lastCheckOutcome: "idle",
  lastErrorMessage: "",
  lastProviderSummary: "",
  nextCheckAt: 0,
  unreadCount: 0,
  activeFreeToKeepCount: 0,
  backoffLevel: 0,
  lastResultFingerprint: "",
  lastResultCount: 0,
  pendingQuietCount: 0,
  lastTrigger: "",
});

export function sanitizeRuntimeState(raw = {}) {
  const source = typeof raw === "object" && raw ? raw : {};
  return {
    checkInProgress: Boolean(source.checkInProgress),
    lastCheckStartedAt: safeNumber(source.lastCheckStartedAt, 0),
    lastCheckFinishedAt: safeNumber(source.lastCheckFinishedAt, 0),
    lastFullSuccessAt: safeNumber(source.lastFullSuccessAt, 0),
    lastSuccessAt: safeNumber(source.lastSuccessAt, 0),
    lastCheckOutcome:
      typeof source.lastCheckOutcome === "string"
        ? source.lastCheckOutcome
        : "idle",
    lastErrorMessage:
      typeof source.lastErrorMessage === "string"
        ? source.lastErrorMessage
        : "",
    lastProviderSummary:
      typeof source.lastProviderSummary === "string"
        ? source.lastProviderSummary
        : "",
    nextCheckAt: safeNumber(source.nextCheckAt, 0),
    unreadCount: clamp(safeNumber(source.unreadCount, 0), 0, 999),
    activeFreeToKeepCount: clamp(
      safeNumber(source.activeFreeToKeepCount, 0),
      0,
      999,
    ),
    backoffLevel: clamp(safeNumber(source.backoffLevel, 0), 0, 10),
    lastResultFingerprint:
      typeof source.lastResultFingerprint === "string"
        ? source.lastResultFingerprint
        : "",
    lastResultCount: clamp(safeNumber(source.lastResultCount, 0), 0, 999),
    pendingQuietCount: clamp(safeNumber(source.pendingQuietCount, 0), 0, 999),
    lastTrigger:
      typeof source.lastTrigger === "string" ? source.lastTrigger : "",
  };
}

export function buildRecoveredRuntimeState(raw = {}, nowTs = Date.now()) {
  const runtimeState = sanitizeRuntimeState(raw);
  if (!runtimeState.checkInProgress) {
    return runtimeState;
  }

  return sanitizeRuntimeState({
    ...runtimeState,
    checkInProgress: false,
    lastCheckFinishedAt: Math.max(
      runtimeState.lastCheckFinishedAt,
      safeNumber(nowTs, 0),
    ),
    lastCheckOutcome: "error",
    lastErrorMessage:
      runtimeState.lastErrorMessage || INTERRUPTED_CHECK_MESSAGE,
  });
}

export async function getRuntimeState() {
  const stored = await readKey(
    STORAGE_KEYS.runtimeState,
    DEFAULT_RUNTIME_STATE,
  );
  return sanitizeRuntimeState(stored);
}

let runtimeWrite = Promise.resolve();
export function setRuntimeState(patch) {
  const operation = runtimeWrite.then(async () => {
    const current = await getRuntimeState();
    const next = sanitizeRuntimeState({ ...current, ...patch });
    await writeLocal({ [STORAGE_KEYS.runtimeState]: next });
    return next;
  });
  runtimeWrite = operation.catch(() => undefined);
  return operation;
}
