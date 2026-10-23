const catalogs = new Map();
export function resolveLocale(language = "auto") {
  const preferred =
    language === "auto"
      ? globalThis.chrome?.i18n?.getUILanguage?.() ||
        globalThis.navigator?.language ||
        "en"
      : language;
  return String(preferred).toLowerCase().startsWith("ru") ? "ru" : "en";
}
export async function getTranslator(language = "auto") {
  const locale = resolveLocale(language);
  if (!catalogs.has(locale)) {
    const url = new URL(
      `../../_locales/${locale}/messages.json`,
      import.meta.url,
    );
    const promise =
      url.protocol === "file:"
        ? import("node:fs/promises")
            .then((fs) => fs.readFile(url, "utf8"))
            .then(JSON.parse)
        : fetch(url).then((r) => r.json());
    catalogs.set(locale, promise);
  }
  const catalog = await catalogs.get(locale);
  const t = (key, values = {}) =>
    (catalog[key.replace(/-/g, "_")]?.message || key).replace(/\{(\w+)\}/g, (_, name) =>
      String(values[name] ?? ""),
    );
  t.locale = locale;
  return t;
}
