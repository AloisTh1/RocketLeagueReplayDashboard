export const MAP_WINRATE_PRIMARY_KEY = "winRatePct";
export const MAP_WINRATE_SECONDARY_KEY = "games";

export function selectMapWinRateChartRows(mapWinBars, limit = 12) {
  return Array.isArray(mapWinBars) ? mapWinBars.slice(0, limit) : [];
}

export function formatMapAxisLabel(label, maxLength = 16) {
  const text = String(label || "").trim();
  if (!text) return "Unknown";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}...`;
}

export function formatMapCategoryLabel(label, games, maxLength = 18) {
  const short = formatMapAxisLabel(label, maxLength);
  const safeGames = Number.isFinite(Number(games)) ? Number(games) : 0;
  return `${short} (${safeGames}g)`;
}
