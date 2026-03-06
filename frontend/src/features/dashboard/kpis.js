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
  playerIdPrompt,
}) {
  return [
    {
      label: "Replays",
      teamValue: String(totalMatches),
      playerValue: hasTrackedPlayerMatch ? String(trackedPlayerOverview.matches) : "",
      playerEmpty: playerMetricPrompt || playerIdPrompt,
      forcePlayerOnly: false,
    },
    {
      label: "Win Rate",
      teamValue: "",
      playerValue: trackedPlayerOverview.winRate === null ? "" : `${(trackedPlayerOverview.winRate * 100).toFixed(2)}%`,
      playerEmpty: playerMetricPrompt || playerIdPrompt,
      forcePlayerOnly: true,
    },
  ].map((card) => {
    const hasPlayerValue = Boolean(card.playerValue);
    const showDual = !card.forcePlayerOnly && hasPlayerValue && card.playerValue !== card.teamValue;
    return {
      ...card,
      showDual,
      primaryValue: card.forcePlayerOnly
        ? (card.playerValue || card.playerEmpty || "-")
        : (showDual ? card.teamValue : (card.playerValue || card.teamValue || card.playerEmpty || "-")),
    };
  });
}
