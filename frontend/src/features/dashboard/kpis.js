import { didPlayerWin, isTrackedRow, normalizeIdentity } from "./playerTracking.js";

export function computeTrackedPlayerOverview(rows, trackedPlayerId) {
  const normalizedTrackedId = normalizeIdentity(trackedPlayerId);
  if (!normalizedTrackedId || !Array.isArray(rows) || rows.length === 0) {
    return {
      matches: 0,
      wins: 0,
      winRate: null,
    };
  }
  const trackedRows = rows.filter((row) => isTrackedRow(row, normalizedTrackedId));
  const wins = trackedRows.filter((row) => didPlayerWin(row, normalizedTrackedId)).length;
  return {
    matches: trackedRows.length,
    wins,
    winRate: trackedRows.length ? wins / trackedRows.length : null,
  };
}

export function buildTopKpiCards({
  totalMatches,
  trackedPlayerOverview,
  hasTrackedPlayerMatch,
  playerMetricPrompt,
}) {
  return [
    {
      label: "Replays",
      primaryValue: String(totalMatches),
    },
    {
      label: "Win Rate",
      primaryValue:
        trackedPlayerOverview.winRate === null
          ? (playerMetricPrompt || "-")
          : `${(trackedPlayerOverview.winRate * 100).toFixed(2)}%`,
    },
  ];
}
