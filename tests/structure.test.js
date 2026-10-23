import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
async function files(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
test("all source-relative imports and static UI translation keys resolve", async () => {
  const catalog = JSON.parse(
    await readFile("_locales/en/messages.json", "utf8"),
  );
  for (const path of await files("src")) {
    if (!/\.(js|html)$/.test(path)) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(
      /(?:from\s+|import\s*)["'](\.[^"']+)["']/g,
    ))
      await access(resolve(dirname(path), match[1]));
    for (const match of source.matchAll(
      /data-i18n(?:-aria)?="([^"]+)"|\bt\(["']([^"']+)["']/g,
    )) {
      const key = match[1] || match[2];
      assert.ok(catalog[key], `${path}: missing ${key}`);
    }
  }
});
test("the localized manifest is consistent with package and catalogs", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.version, pkg.version);
  for (const locale of ["en", "ru"]) {
    const catalog = JSON.parse(
      await readFile(`_locales/${locale}/messages.json`, "utf8"),
    );
    for (const key of Object.keys(catalog))
      assert.match(key, /^[a-zA-Z0-9_@]+$/);
    assert.ok(catalog.extensionName.message);
    assert.ok(catalog.extensionDescription.message.length <= 132);
  }
});
