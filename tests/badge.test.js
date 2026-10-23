import test from "node:test";
import assert from "node:assert/strict";

import { updateBadge } from "../src/lib/badge.js";

function createChromeMock() {
  const calls = [];
  globalThis.chrome = {
    action: {
      async setBadgeBackgroundColor(payload) {
        calls.push(["setBadgeBackgroundColor", payload]);
      },
      async setBadgeText(payload) {
        calls.push(["setBadgeText", payload]);
      },
    },
  };
  return calls;
}

test("updateBadge hides badge text when badge display is disabled", async (t) => {
  const calls = createChromeMock();
  t.after(() => {
    delete globalThis.chrome;
  });

  await updateBadge(
    { unreadCount: 3, activeFreeToKeepCount: 7 },
    { badgeEnabled: false },
  );

  assert.deepEqual(calls, [["setBadgeText", { text: "" }]]);
});

test("updateBadge shows unread state in red using the active Free to Keep count", async (t) => {
  const calls = createChromeMock();
  t.after(() => {
    delete globalThis.chrome;
  });

  await updateBadge(
    { unreadCount: 2, activeFreeToKeepCount: 5 },
    { badgeEnabled: true },
  );

  assert.deepEqual(calls, [
    ["setBadgeBackgroundColor", { color: "#d94b3d" }],
    ["setBadgeText", { text: "5" }],
  ]);
});

test("updateBadge hides the toolbar badge when no active promotions were found", async (t) => {
  const calls = createChromeMock();
  t.after(() => {
    delete globalThis.chrome;
  });

  await updateBadge(
    { unreadCount: 0, activeFreeToKeepCount: 0 },
    { badgeEnabled: true },
  );

  assert.deepEqual(calls, [["setBadgeText", { text: "" }]]);
});
