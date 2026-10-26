// Synthetic offers using field names observed in the public store responses/code.
// GOG's positive giveaway section has not yet been observed during a live giveaway.
export function epicFeed(now = Date.now()) {
  const item = (id, future) => ({
    id, namespace: "test-namespace", title: future ? "Future game" : "Test game", offerType: "BASE_GAME",
    catalogNs: { mappings: [{ pageType: "productHome", pageSlug: future ? "future-game" : "test-game" }] },
    keyImages: [{ type: "OfferImageWide", url: "https://cdn1.epicgames.com/test.png" }],
    price: { totalPrice: { originalPrice: 1999, discountPrice: future ? 1999 : 0,
      currencyCode: "USD", fmtPrice: { originalPrice: "$19.99" } } },
    promotions: {
      promotionalOffers: future ? [] : [{ promotionalOffers: [{
        startDate: new Date(now - 86400000).toISOString(), endDate: new Date(now + 86400000).toISOString(),
        discountSetting: { discountType: "PERCENTAGE", discountPercentage: 0 },
      }] }],
      upcomingPromotionalOffers: future ? [{ promotionalOffers: [{
        startDate: new Date(now + 3600000).toISOString(), endDate: new Date(now + 172800000).toISOString(),
        discountSetting: { discountType: "PERCENTAGE", discountPercentage: 0 },
      }] }] : [],
    },
  });
  return { data: { Catalog: { searchStore: { elements: [item("123", false), item("456", true)] } } } };
}
export function gogPage() {
  return { config: { pageId: "test-page" }, sections: [{ sectionType: "GIVEAWAY_SECTION",
    sectionId: "test-section", visibilityControl: "ALL", isPersonalized: false, hideOnLoad: false }] };
}
export function gogGiveaway(now = Date.now()) {
  return { properties: { endDate: new Date(now + 86400000).toISOString(), product: {
    id: "123", title: "Test game", slug: "test_game", productType: "game",
    coverHorizontal: "https://images.gog-statics.com/test.png",
    price: { base: "$9.99", baseMoney: { amount: "9.99", currency: "USD" } },
    genres: [{ name: "Action" }], operatingSystems: ["windows"], reviewsRating: 45, reviewsCount: 20,
  } } };
}
