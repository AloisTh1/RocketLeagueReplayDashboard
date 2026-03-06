import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_WINRATE_PRIMARY_KEY,
  MAP_WINRATE_SECONDARY_KEY,
  formatMapAxisLabel,
  formatMapCategoryLabel,
  selectMapWinRateChartRows,
} from "../src/features/dashboard/distribution.js";

test("map win rate chart uses win rate as primary metric and games as secondary context", () => {
  assert.equal(MAP_WINRATE_PRIMARY_KEY, "winRatePct");
  assert.equal(MAP_WINRATE_SECONDARY_KEY, "games");
});

test("selectMapWinRateChartRows returns the top rows with a stable default limit", () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({ map: `Map ${index + 1}`, games: 15 - index, winRatePct: index * 5 }));
  const selected = selectMapWinRateChartRows(rows);
  assert.equal(selected.length, 12);
  assert.deepEqual(selected[0], rows[0]);
  assert.deepEqual(selected[11], rows[11]);
});

test("selectMapWinRateChartRows fails closed on bad input", () => {
  assert.deepEqual(selectMapWinRateChartRows(null), []);
  assert.deepEqual(selectMapWinRateChartRows(undefined), []);
});

test("formatMapAxisLabel truncates long map labels and handles empty values", () => {
  assert.equal(formatMapAxisLabel("DFH_Stadium_P", 18), "DFH_Stadium_P");
  assert.equal(formatMapAxisLabel("VeryLongRocketLeagueMapName", 10), "VeryLongR...");
  assert.equal(formatMapAxisLabel("", 10), "Unknown");
});

test("formatMapCategoryLabel appends game counts next to the map label", () => {
  assert.equal(formatMapCategoryLabel("DFH_Stadium_P", 13, 18), "DFH_Stadium_P (13g)");
  assert.equal(formatMapCategoryLabel("VeryLongRocketLeagueMapName", 7, 10), "VeryLongR... (7g)");
  assert.equal(formatMapCategoryLabel("", null, 10), "Unknown (0g)");
});
