import test from "node:test";
import assert from "node:assert/strict";
import { buildBucketCorrelations, buildPlayerContributionTrend, buildPlayerTrend, buildRegressionSeries } from "../src/features/dashboard/trends.js";

const TRACKED_PLAYER_ID = "tracked-player-id";

function makeRow({
  date,
  trackedSide = "blue",
  blueScore,
  orangeScore,
  score,
  score_vs_lobby_avg,
  goals,
  assists,
  saves,
  shot_accuracy,
}) {
  const trackedPlayer = {
    name: "Tracked Player",
    player_id: TRACKED_PLAYER_ID,
    online_id: TRACKED_PLAYER_ID,
    score,
    goals,
    assists,
    saves,
  };
  const mate = { name: "Mate", player_id: "mate-id", online_id: "mate-id", score: 50, goals: 1, assists: 0, saves: 1 };
  const enemyA = { name: "Enemy A", player_id: "enemy-a", online_id: "enemy-a", score: 70, goals: 1, assists: 1, saves: 0 };
  const enemyB = { name: "Enemy B", player_id: "enemy-b", online_id: "enemy-b", score: 80, goals: 0, assists: 0, saves: 2 };
  const blue_players = trackedSide === "blue" ? [trackedPlayer, mate] : [enemyA, enemyB];
  const orange_players = trackedSide === "orange" ? [trackedPlayer, mate] : [enemyA, enemyB];
  return {
    date,
    blue_players,
    orange_players,
    blue_score: blueScore,
    orange_score: orangeScore,
    metrics: { score, score_vs_lobby_avg, goals, assists, saves, shot_accuracy },
  };
}

function findMetric(row, metricKey) {
  return row?.metrics?.[metricKey] ?? null;
}

test("buildPlayerTrend keeps Timeline as one point per replay", () => {
  const rows = [
    makeRow({ date: "2026-03-05T10:15:00", blueScore: 3, orangeScore: 1, score: 100, score_vs_lobby_avg: 10, goals: 2, assists: 1, saves: 0 }),
    makeRow({ date: "2026-03-05T10:45:00", blueScore: 1, orangeScore: 2, score: 50, score_vs_lobby_avg: -5, goals: 0, assists: 0, saves: 2 }),
  ];

  const trend = buildPlayerTrend(rows, "hour", TRACKED_PLAYER_ID, findMetric);

  assert.equal(trend.length, 2);
  assert.deepEqual(trend.map((entry) => entry.bucket), ["2026-03-05 10:15", "2026-03-05 10:45"]);
  assert.deepEqual(trend.map((entry) => entry.games), [1, 1]);
  assert.deepEqual(trend.map((entry) => entry.winRate), [1, 0]);
});

test("buildPlayerTrend aggregates chronological hourly buckets for TL Hour", () => {
  const rows = [
    makeRow({ date: "2026-03-05T10:15:00", blueScore: 3, orangeScore: 1, score: 100, score_vs_lobby_avg: 10, goals: 2, assists: 1, saves: 0 }),
    makeRow({ date: "2026-03-05T10:45:00", blueScore: 1, orangeScore: 2, score: 50, score_vs_lobby_avg: -5, goals: 0, assists: 0, saves: 2 }),
    makeRow({ date: "2026-03-06T10:05:00", trackedSide: "orange", blueScore: 1, orangeScore: 4, score: 80, score_vs_lobby_avg: 0, goals: 1, assists: 0, saves: 1 }),
  ];

  const trend = buildPlayerTrend(rows, "timeline_hour", TRACKED_PLAYER_ID, findMetric);

  assert.equal(trend.length, 2);
  assert.equal(trend[0].bucket, "2026-03-05 10:00");
  assert.equal(trend[0].games, 2);
  assert.equal(trend[0].wins, 1);
  assert.equal(trend[0].winRate, 0.5);
  assert.equal(trend[0].avgScore, 75);
  assert.equal(trend[0].scoreGap, 2.5);
  assert.equal(trend[1].bucket, "2026-03-06 10:00");
  assert.equal(trend[1].games, 1);
  assert.equal(trend[1].wins, 1);
});

test("buildPlayerTrend keeps Hour OD as aggregated clock hour across days", () => {
  const rows = [
    makeRow({ date: "2026-03-05T10:15:00", blueScore: 3, orangeScore: 1, score: 100, score_vs_lobby_avg: 10, goals: 2, assists: 1, saves: 0 }),
    makeRow({ date: "2026-03-05T10:45:00", blueScore: 1, orangeScore: 2, score: 50, score_vs_lobby_avg: -5, goals: 0, assists: 0, saves: 2 }),
    makeRow({ date: "2026-03-06T10:05:00", trackedSide: "orange", blueScore: 1, orangeScore: 4, score: 80, score_vs_lobby_avg: 0, goals: 1, assists: 0, saves: 1 }),
  ];

  const trend = buildPlayerTrend(rows, "hour_of_day", TRACKED_PLAYER_ID, findMetric);

  assert.equal(trend.length, 1);
  assert.equal(trend[0].bucket, "10:00");
  assert.equal(trend[0].games, 3);
  assert.equal(trend[0].wins, 2);
  assert.equal(trend[0].winRate, 2 / 3);
  assert.equal(trend[0].avgScore, (100 + 50 + 80) / 3);
});

test("buildPlayerTrend supports aggregate day, week, and month buckets", () => {
  const rows = [
    makeRow({ date: "2026-03-02T10:15:00", blueScore: 3, orangeScore: 1, score: 100, score_vs_lobby_avg: 10, goals: 2, assists: 1, saves: 0 }),
    makeRow({ date: "2026-03-09T10:45:00", blueScore: 1, orangeScore: 2, score: 50, score_vs_lobby_avg: -5, goals: 0, assists: 0, saves: 2 }),
    makeRow({ date: "2026-04-06T10:05:00", trackedSide: "orange", blueScore: 1, orangeScore: 4, score: 80, score_vs_lobby_avg: 0, goals: 1, assists: 0, saves: 1 }),
  ];

  const byDay = buildPlayerTrend(rows, "day_of_week", TRACKED_PLAYER_ID, findMetric);
  assert.deepEqual(byDay.map((entry) => entry.bucket), ["Mon"]);
  assert.equal(byDay[0].games, 3);

  const byWeek = buildPlayerTrend(rows, "week_of_year", TRACKED_PLAYER_ID, findMetric);
  assert.deepEqual(byWeek.map((entry) => entry.bucket), ["W10", "W11", "W15"]);

  const byMonth = buildPlayerTrend(rows, "month_of_year", TRACKED_PLAYER_ID, findMetric);
  assert.deepEqual(byMonth.map((entry) => entry.bucket), ["Mar", "Apr"]);
  assert.equal(byMonth[0].games, 2);
  assert.equal(byMonth[1].games, 1);
});

test("buildPlayerContributionTrend averages per bucket for TL Hour and Hour OD", () => {
  const rows = [
    makeRow({ date: "2026-03-05T10:15:00", blueScore: 3, orangeScore: 1, score: 100, score_vs_lobby_avg: 10, goals: 2, assists: 1, saves: 0, shot_accuracy: 0.5 }),
    makeRow({ date: "2026-03-05T10:45:00", blueScore: 1, orangeScore: 2, score: 50, score_vs_lobby_avg: -5, goals: 0, assists: 0, saves: 2, shot_accuracy: 0 }),
    makeRow({ date: "2026-03-06T10:05:00", trackedSide: "orange", blueScore: 1, orangeScore: 4, score: 80, score_vs_lobby_avg: 0, goals: 1, assists: 0, saves: 1, shot_accuracy: 0.25 }),
  ];

  const timelineHour = buildPlayerContributionTrend(rows, "timeline_hour", TRACKED_PLAYER_ID, findMetric);
  assert.equal(timelineHour.length, 2);
  assert.equal(timelineHour[0].bucket, "2026-03-05 10:00");
  assert.equal(timelineHour[0].goals, 1);
  assert.equal(timelineHour[0].assists, 0.5);
  assert.equal(timelineHour[0].saves, 1);
  assert.equal(timelineHour[0].shot_accuracy, 0.25);

  const hourOfDay = buildPlayerContributionTrend(rows, "hour_of_day", TRACKED_PLAYER_ID, findMetric);
  assert.equal(hourOfDay.length, 1);
  assert.equal(hourOfDay[0].bucket, "10:00");
  assert.equal(hourOfDay[0].goals, 1);
  assert.equal(hourOfDay[0].assists, 1 / 3);
  assert.equal(hourOfDay[0].saves, 1);
  assert.equal(hourOfDay[0].shot_accuracy, 0.25);
});

test("buildRegressionSeries adds independent regression keys without overwriting stacked contribution values", () => {
  const rows = [
    { bucket: "A", goals: 1, assists: 0, saves: 2 },
    { bucket: "B", goals: 2, assists: 1, saves: 1 },
    { bucket: "C", goals: 3, assists: 2, saves: 0 },
  ];

  const goalsRegression = buildRegressionSeries(rows, "goals", "goalsRegression");
  const assistsRegression = buildRegressionSeries(goalsRegression, "assists", "assistsRegression");
  const savesRegression = buildRegressionSeries(assistsRegression, "saves", "savesRegression");

  assert.deepEqual(savesRegression.map((row) => row.goals), [1, 2, 3]);
  assert.deepEqual(savesRegression.map((row) => row.assists), [0, 1, 2]);
  assert.deepEqual(savesRegression.map((row) => row.saves), [2, 1, 0]);
  assert.equal(typeof savesRegression[0].goalsRegression, "number");
  assert.equal(typeof savesRegression[1].assistsRegression, "number");
  assert.equal(typeof savesRegression[2].savesRegression, "number");
});

test("buildBucketCorrelations ranks metrics by absolute correlation to bucket order", () => {
  const rows = [
    { bucket: "A", avgScore: 10, winRate: 0.2, goals: 4 },
    { bucket: "B", avgScore: 20, winRate: 0.4, goals: 3 },
    { bucket: "C", avgScore: 30, winRate: 0.6, goals: 2 },
    { bucket: "D", avgScore: 40, winRate: 0.8, goals: 1 },
  ];

  const correlations = buildBucketCorrelations(rows, [
    { key: "avgScore", label: "Score" },
    { key: "winRate", label: "Win Rate" },
    { key: "goals", label: "Goals" },
  ]);

  assert.equal(correlations.length, 3);
  assert.equal(correlations[0].label, "Score");
  assert.equal(correlations[0].correlation, 1);
  assert.equal(correlations[1].label, "Win Rate");
  assert.equal(correlations[1].correlation, 1);
  assert.equal(correlations[2].label, "Goals");
  assert.equal(correlations[2].correlation, -1);
});
