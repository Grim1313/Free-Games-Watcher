import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecoveredRuntimeState,
  INTERRUPTED_CHECK_MESSAGE,
} from "../src/lib/runtime-state.js";

test("buildRecoveredRuntimeState clears a stale in-progress check", () => {
  const recovered = buildRecoveredRuntimeState(
    {
      checkInProgress: true,
      lastCheckStartedAt: 100,
      lastCheckFinishedAt: 0,
      lastCheckOutcome: "running",
      lastErrorMessage: "",
      unreadCount: 3,
    },
    250,
  );

  assert.equal(recovered.checkInProgress, false);
  assert.equal(recovered.lastCheckOutcome, "error");
  assert.equal(recovered.lastCheckFinishedAt, 250);
  assert.equal(recovered.lastErrorMessage, INTERRUPTED_CHECK_MESSAGE);
  assert.equal(recovered.unreadCount, 3);
});

test("buildRecoveredRuntimeState keeps settled checks unchanged", () => {
  const recovered = buildRecoveredRuntimeState(
    {
      checkInProgress: false,
      lastCheckFinishedAt: 100,
      lastCheckOutcome: "success",
      lastErrorMessage: "",
    },
    250,
  );

  assert.equal(recovered.checkInProgress, false);
  assert.equal(recovered.lastCheckOutcome, "success");
  assert.equal(recovered.lastCheckFinishedAt, 100);
  assert.equal(recovered.lastErrorMessage, "");
});
