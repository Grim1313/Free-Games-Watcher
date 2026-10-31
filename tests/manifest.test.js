import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);

test("manifest version identifies the current release", () => {
  assert.equal(manifest.version, "2.2.0");
});

test("manifest uses the Chrome Web Store release name and summary", () => {
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_title, "__MSG_extensionName__");
});

test("manifest does not request the tabs permission", () => {
  assert.ok(!manifest.permissions.includes("tabs"));
});

test("manifest allows Steam Store API deadline lookups", () => {
  assert.ok(
    manifest.host_permissions.includes("https://api.steampowered.com/*"),
  );
});

test("manifest permits only the specific Epic catalog and EGData fallback hosts", () => {
  assert.ok(manifest.host_permissions.includes("https://store.epicgames.com/*"));
  assert.ok(manifest.host_permissions.includes("https://api.egdata.app/*"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.ok(!manifest.permissions.includes("cookies"));
});
