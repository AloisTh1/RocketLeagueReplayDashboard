import test from "node:test";
import assert from "node:assert/strict";

import { buildTopKpiCards, computeTrackedPlayerOverview } from "../src/features/dashboard/kpis.js";

const trackedId = "76561190000000001";

function makeRow({
  id,
  teamColor,
  blueScore,
  orangeScore,
  playerSide,
  tracked = true,
  won,
} = {}) {
  const normalizedTeamColor = teamColor || (playerSide === "orange" ? "orange" : "blue");
  const bluePlayers = [
    { name: "Blue Mate", player_id: "blue-mate", online_id: "blue-mate", score: 500 },
    { name: "Blue Opp", player_id: "blue-opp", online_id: "blue-opp", score: 650 },
  ];
  const orangePlayers = [
    { name: "Orange Mate", player_id: "orange-mate", online_id: "orange-mate", score: 700 },
    { name: "Orange Opp", player_id: "orange-opp", online_id: "orange-opp", score: 550 },
  ];
  if (tracked) {
    const trackedPlayer = { name: "Tracked", player_id: trackedId, online_id: trackedId, score: 800 };
    if (playerSide === "orange") orangePlayers[0] = trackedPlayer;
    else bluePlayers[0] = trackedPlayer;
  }
  const teamScore = normalizedTeamColor === "orange" ? orangeScore : blueScore;
  const opponentScore = normalizedTeamColor === "orange" ? blueScore : orangeScore;
  return {
    id: id || `${normalizedTeamColor}-${blueScore}-${orangeScore}-${playerSide || "blue"}`,
    date: "2026-03-05T20:13:00Z",
    team_color: normalizedTeamColor,
    blue_score: blueScore,
    orange_score: orangeScore,
    team_score: teamScore,
    opponent_score: opponentScore,
    player_id: tracked ? trackedId : "other-player",
    online_id: tracked ? trackedId : "other-player",
    player_name: tracked ? "Tracked" : "Other",
    won: won ?? (teamScore > opponentScore),
    blue_players: bluePlayers,
    orange_players: orangePlayers,
  };
}

test("computeTrackedPlayerOverview returns empty values without a player id", () => {
  assert.deepEqual(computeTrackedPlayerOverview([makeRow()], ""), {
    matches: 0,
    wins: 0,
    winRate: null,
  });
});

test("computeTrackedPlayerOverview uses matched tracked rows only and player-side wins", () => {
  const rows = [
    makeRow({ id: "r1", playerSide: "orange", teamColor: "orange", blueScore: 4, orangeScore: 3, won: true }),
    makeRow({ id: "r2", playerSide: "blue", teamColor: "blue", blueScore: 2, orangeScore: 1, won: false }),
    makeRow({ id: "r3", playerSide: "orange", teamColor: "orange", blueScore: 1, orangeScore: 5, won: false }),
    makeRow({ id: "r4", playerSide: "blue", teamColor: "blue", blueScore: 2, orangeScore: 3, won: true }),
    makeRow({ id: "r5", tracked: false, playerSide: "blue", teamColor: "blue", blueScore: 9, orangeScore: 0 }),
  ];

  assert.deepEqual(computeTrackedPlayerOverview(rows, trackedId), {
    matches: 4,
    wins: 2,
    winRate: 0.5,
  });
});

test("tracked player KPI values stay fresh for the provided scoped rows", () => {
  const allRows = [
    makeRow({ id: "r1", playerSide: "orange", teamColor: "orange", blueScore: 1, orangeScore: 4 }),
    makeRow({ id: "r2", playerSide: "orange", teamColor: "orange", blueScore: 3, orangeScore: 2 }),
    makeRow({ id: "r3", playerSide: "orange", teamColor: "orange", blueScore: 2, orangeScore: 5 }),
  ];
  const scopedRows = allRows.slice(0, 2);

  assert.deepEqual(computeTrackedPlayerOverview(scopedRows, trackedId), {
    matches: 2,
    wins: 1,
    winRate: 0.5,
  });
});

test("buildTopKpiCards collapses replay card when team and player values match", () => {
  const cards = buildTopKpiCards({
    totalMatches: 5,
    trackedPlayerOverview: { matches: 5, wins: 2, winRate: 0.4 },
    hasTrackedPlayerMatch: true,
    playerMetricPrompt: "player id not found",
    playerIdPrompt: "please fill player id",
  });

  assert.equal(cards[0].label, "Replays");
  assert.equal(cards[0].showDual, false);
  assert.equal(cards[0].primaryValue, "5");
  assert.equal(cards[1].label, "Win Rate");
  assert.equal(cards[1].primaryValue, "40.00%");
});

test("buildTopKpiCards shows replay split when tracked scope differs and win-rate prompt when missing", () => {
  const cards = buildTopKpiCards({
    totalMatches: 7,
    trackedPlayerOverview: { matches: 5, wins: 0, winRate: null },
    hasTrackedPlayerMatch: true,
    playerMetricPrompt: "player id not found",
    playerIdPrompt: "please fill player id",
  });

  assert.equal(cards[0].showDual, true);
  assert.equal(cards[0].primaryValue, "7");
  assert.equal(cards[1].primaryValue, "player id not found");
});

