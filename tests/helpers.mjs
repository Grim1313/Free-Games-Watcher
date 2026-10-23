export function environment(t, initial = {}) {
  const previousChrome = globalThis.chrome,
    previousFetch = globalThis.fetch;
  const data = structuredClone(initial),
    notifications = [],
    alarms = new Map();
  globalThis.chrome = {
    i18n: { getUILanguage: () => "en" },
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    storage: {
      local: {
        get: async (keys) =>
          keys === null || keys === undefined
            ? structuredClone(data)
            : Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys])
                  .filter((k) => Object.hasOwn(data, k))
                  .map((k) => [k, structuredClone(data[k])]),
              ),
        set: async (values) => {
          Object.assign(data, structuredClone(values));
        },
      },
    },
    alarms: {
      get: async (name) => alarms.get(name),
      create: async (name, options) => {
        alarms.set(name, { name, scheduledTime: options.when });
      },
      clear: async (name) => alarms.delete(name),
    },
    notifications: {
      create: async (id, options) => {
        notifications.push({ id, options });
        return id;
      },
    },
    tabs: { create: async (options) => options },
  };
  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  });
  return { data, notifications, alarms };
}
export function row(id = 123, title = "Test game") {
  return `<a href="https://store.steampowered.com/app/${id}/" class="search_result_row" data-price-final="0"><span class="title">${title}</span><div class="discount_original_price">$9.99</div><div class="discount_final_price">$0.00</div></a>`;
}
export function response(data) {
  return {
    ok: true,
    json: async () => data,
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  };
}
export function steamFetch(options = {}) {
  return async (url) => {
    if (url.includes("/search/results/"))
      return response({ total_count: 1, results_html: row() });
    if (url.includes("/api/appdetails"))
      return response({
        123: {
          success: true,
          data: {
            name: "Test game",
            type: "game",
            platforms: { windows: true, linux: true },
            genres: [{ description: "Action" }],
            price_overview: {
              initial: 999,
              final: 0,
              initial_formatted: "$9.99",
            },
          },
        },
      });
    if (url.includes("/appreviews/"))
      return response({
        success: 1,
        query_summary: {
          total_positive: 90,
          total_negative: 10,
          total_reviews: 100,
        },
      });
    if (url.includes("IStoreBrowseService"))
      return response({
        response: {
          store_items: [
            {
              appid: 123,
              best_purchase_option: {
                is_free_to_keep: true,
                free_to_keep_ends: Math.floor((Date.now() + 86400000) / 1000),
              },
            },
          ],
        },
      });
    if (url.includes("featuredcategories"))
      return response({ specials: { items: [] } });
    if (url.includes("/app/")) return response("<html>No date</html>");
    throw new Error(`Unexpected request: ${url}`);
  };
}
export function entry(extra = {}) {
  return {
    id: "app:123|free-to-keep",
    stableId: "app:123",
    appId: 123,
    packageId: 0,
    promoType: "free-to-keep",
    campaignId: "app:123|free-to-keep",
    fingerprint: "app:123|free-to-keep",
    title: "Test game",
    url: "https://store.steampowered.com/app/123/",
    contentType: "game",
    status: "active",
    region: "US",
    unread: true,
    firstSeenAt: Date.now() - 1000,
    lastSeenAt: Date.now() - 1000,
    lastCheckedAt: Date.now() - 1000,
    ...extra,
  };
}
