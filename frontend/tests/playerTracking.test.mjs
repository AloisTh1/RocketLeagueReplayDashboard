import test from "node:test";
import assert from "node:assert/strict";

import {
  didPlayerWin,
  findTrackedPlayerInRow,
  isTrackedRow,
  resolvePerspective,
} from "../src/features/dashboard/playerTracking.js";

const trackedId = "76561190000000001";

function makeRow(overrides = {}) {
  return {
    id: "replay-1",
    date: "2026-03-05T20:13:00Z",
    team_color: "orange",
    team_score: 3,
    opponent_score: 4,
    blue_score: 4,
    orange_score: 3,
    player_id: trackedId,
    online_id: trackedId,
    player_name: "tracked_player",
    won: false,
    blue_players: [
      { name: "Dexterity", player_id: "epic-1", online_id: "0", score: 766, goals: 1, assists: 0, saves: 1, shots: 4, big_boosts: 8, small_boosts: 40 },
      { name: "Spoke73", player_id: "epic-2", online_id: "0", score: 1275, goals: 3, assists: 1, saves: 2, shots: 8, big_boosts: 13, small_boosts: 55 },
    ],
    orange_players: [
      { name: "tracked_player", player_id: trackedId, online_id: trackedId, score: 848, goals: 2, assists: 1, saves: 1, shots: 5, big_boosts: 10, small_boosts: 45 },
      { name: "Cartben [FR]", player_id: "steam-2", online_id: "steam-2", score: 871, goals: 1, assists: 1, saves: 2, shots: 3, big_boosts: 12, small_boosts: 48 },
    ],
    ...overrides,
  };
}

test("findTrackedPlayerInRow ignores short-id false positives", () => {
  const row = makeRow();
  const player = findTrackedPlayerInRow(row, trackedId);
  assert.equal(player?.name, "tracked_player");
});

test("resolvePerspective puts tracked player on the correct color side", () => {
  const perspective = resolvePerspective(makeRow(), trackedId);
  assert.equal(perspective.teamColor, "orange");
  assert.equal(perspective.selectedPlayer?.name, "tracked_player");
  assert.deepEqual(
    perspective.teamPlayers.map((player) => player.name),
    ["tracked_player", "Cartben [FR]"],
  );
  assert.deepEqual(
    perspective.opponentPlayers.map((player) => player.name),
    ["Dexterity", "Spoke73"],
  );
});

test("didPlayerWin uses tracked-player side instead of raw row orientation", () => {
  assert.equal(didPlayerWin(makeRow(), trackedId), false);
  assert.equal(
    didPlayerWin(
      makeRow({
        team_score: 6,
        opponent_score: 3,
        blue_score: 3,
        orange_score: 6,
        won: true,
      }),
      trackedId,
    ),
    true,
  );
});

test("isTrackedRow requires a real tracked match", () => {
  assert.equal(isTrackedRow(makeRow(), trackedId), true);
  assert.equal(isTrackedRow(makeRow({ player_id: "junk", online_id: "junk" }), "not-found"), false);
});

