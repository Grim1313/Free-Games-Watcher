// Epic tag IDs from https://api.egdata.app/tags, checked 27 October 2026.
// Genre labels and desktop platforms verified against Epic Browse/product pages.
// Keep this local: weekly, catalog and fallback offers share the same IDs.
const genres = new Map(Object.entries({
  1216: "Action", 1336: "Action-Adventure", 1117: "Adventure", 1181: "Card Game",
  1296: "Casual", 1146: "City Builder", 1116: "Comedy", 1265: "Dungeon Crawler",
  1381: "Exploration", 1287: "Fantasy", 1344: "Fighting", 1294: "First Person",
  1218: "Horror", 1263: "Indie", 1275: "MOBA", 1129: "Music", 1395: "Narration",
  1307: "Open World", 1110: "Party", 1151: "Platformer", 1298: "Puzzle",
  1212: "Racing", 1198: "Retro", 1158: "Rhythm", 1083: "Rogue-Lite",
  1367: "RPG", 1120: "RTS", 1210: "Shooter", 1393: "Simulation", 1121: "Space",
  1283: "Sports", 1084: "Stealth", 1115: "Strategy", 1080: "Survival",
  1170: "Tower Defense", 1318: "Trivia", 1386: "Turn-Based", 1088: "Turn-Based Strategy",
}));
const platforms = new Map([["9547", "windows"], ["10719", "mac"]]);

export function epicTagMetadata(tags) {
  const foundGenres = new Set(), foundPlatforms = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const id = tag?.id;
    if (typeof id !== "string") continue;
    if (genres.has(id)) foundGenres.add(genres.get(id));
    if (platforms.has(id)) foundPlatforms.add(platforms.get(id));
  }
  // Unknown/feature/event tags stay unknown. Windows support does not imply Linux.
  return { genres: [...foundGenres], platforms: [...foundPlatforms] };
}
