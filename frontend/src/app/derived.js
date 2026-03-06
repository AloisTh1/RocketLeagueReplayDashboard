import { format, parseISO } from "date-fns";
import { num } from "./utils/formatters";
import { didPlayerWin, findPlayerMetric, findTrackedPlayerInRow, normalizeIdentity, resolvePerspective, samePlayer } from "../features/dashboard/playerTracking";

export function computeDerived(filteredRecent, trackedPlayerId = "") {
const rows = filteredRecent;
const matches = rows.length;
const wins = rows.filter((r) => r.won).length;
const trackedId = normalizeIdentity(trackedPlayerId);
const safeNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const nameKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const selfNameKeys = new Set(
  rows
    .flatMap((row) => {
      const names = [];
      if (trackedId) {
        const trackedPlayer = findTrackedPlayerInRow(row, trackedId);
        if (trackedPlayer?.name) names.push(trackedPlayer.name);
      }
      if (row?.player_name) names.push(row.player_name);
      return names;
    })
    .map((name) => nameKey(name))
    .filter(Boolean)
);
const boostParts = (row) => {
  let big = Math.max(0, safeNum(row?.team_big_boosts ?? row?.big_boosts));
  let small = Math.max(0, safeNum(row?.team_small_boosts ?? row?.small_boosts));
  const rawTotal = Math.max(0, safeNum(row?.team_boost_total ?? row?.boost_total));
  if (rawTotal > 0) {
    if (big <= 0 && small > 0) big = Math.max(0, rawTotal - small);
    else if (small <= 0 && big > 0) small = Math.max(0, rawTotal - big);
    else if (big <= 0 && small <= 0) {
      // Some parses only expose a single total field.
      big = rawTotal;
      small = 0;
    }
  }
  return { big, small, total: big + small };
};
const avg = (k) => {
  if (!matches) return 0;
  if (k === "big_boosts") return rows.reduce((s, r) => s + boostParts(r).big, 0) / matches;
  if (k === "small_boosts") return rows.reduce((s, r) => s + boostParts(r).small, 0) / matches;
  if (k === "boost_total") return rows.reduce((s, r) => s + boostParts(r).total, 0) / matches;
  return rows.reduce((s, r) => s + safeNum(r?.[k]), 0) / matches;
};

const ordered = rows.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
const daysPlayedMap = new Map();
rows.forEach((r) => {
  const dateValue = String(r?.date || "");
  if (!dateValue) return;
  const dayKey = format(parseISO(dateValue), "yyyy-MM-dd");
  const current = daysPlayedMap.get(dayKey) || {
    count: 0,
    matchTypes: {
      ranked: 0,
      tournament: 0,
      casual: 0,
      other: 0,
    },
  };
  current.count += 1;
  const rawType = String(r?.match_type || "").trim().toLowerCase();
  if (rawType === "ranked") current.matchTypes.ranked += 1;
  else if (rawType === "tournament") current.matchTypes.tournament += 1;
  else if (rawType === "casual") current.matchTypes.casual += 1;
  else current.matchTypes.other += 1;
  daysPlayedMap.set(dayKey, current);
});
const playedDayKeys = Array.from(daysPlayedMap.keys()).sort();
const daysPlayedHeatmap = (() => {
  if (!playedDayKeys.length) return { cells: [], maxCount: 0, playedDays: 0 };
  const endDate = new Date(`${playedDayKeys[playedDayKeys.length - 1]}T00:00:00`);
  const cells = [];
  for (let offset = 41; offset >= 0; offset -= 1) {
    const cellDate = new Date(endDate);
    cellDate.setDate(endDate.getDate() - offset);
    const key = format(cellDate, "yyyy-MM-dd");
    cells.push({
      key,
      label: format(cellDate, "MMM d"),
      longLabel: format(cellDate, "EEE, MMM d, yyyy"),
      count: Number(daysPlayedMap.get(key)?.count || 0),
      matchTypes: daysPlayedMap.get(key)?.matchTypes || { ranked: 0, tournament: 0, casual: 0, other: 0 },
    });
  }
  return {
    cells,
    maxCount: Math.max(...cells.map((cell) => cell.count), 0),
    playedDays: playedDayKeys.length,
  };
})();

const modeMap = new Map();
const modeOutcomeMap = new Map();
rows.forEach((r) => {
  const k = r.game_mode || "Unknown";
  modeMap.set(k, (modeMap.get(k) || 0) + 1);
  const prev = modeOutcomeMap.get(k) || { mode: k, wins: 0, losses: 0, games: 0 };
  prev.games += 1;
  if (r.won) prev.wins += 1;
  else prev.losses += 1;
  modeOutcomeMap.set(k, prev);
});
const modeBars = Array.from(modeMap.entries())
  .map(([mode, replays]) => ({ mode, replays }))
  .sort((a, b) => b.replays - a.replays);
const modeOutcomeBars = Array.from(modeOutcomeMap.values())
  .sort((a, b) => b.games - a.games)
  .map((m) => ({
    mode: m.mode,
    wins: m.wins,
    losses: m.losses,
    games: m.games,
    winRate: m.games ? m.wins / m.games : 0,
  }));

const durationBucketsMap = new Map([
  ["<=3m", { bucket: "<=3m", games: 0, wins: 0 }],
  ["3-4m", { bucket: "3-4m", games: 0, wins: 0 }],
  ["4-5m", { bucket: "4-5m", games: 0, wins: 0 }],
  ["5-6m", { bucket: "5-6m", games: 0, wins: 0 }],
  [">=6m", { bucket: ">=6m", games: 0, wins: 0 }],
]);
rows.forEach((r) => {
  const duration = safeNum(r?.duration_seconds);
  let key = ">=6m";
  if (duration < 180) key = "<=3m";
  else if (duration < 240) key = "3-4m";
  else if (duration < 300) key = "4-5m";
  else if (duration < 360) key = "5-6m";
  const bucket = durationBucketsMap.get(key);
  bucket.games += 1;
  bucket.wins += r.won ? 1 : 0;
});
const durationBuckets = Array.from(durationBucketsMap.values()).map((item) => {
  const winRate = item.games ? item.wins / item.games : 0;
  return {
    ...item,
    losses: Math.max(0, item.games - item.wins),
    winRate,
    winRatePct: Number((winRate * 100).toFixed(2)),
  };
});

const goalDiffMap = new Map();
rows.forEach((r) => {
  const diff = safeNum(r?.team_score) - safeNum(r?.opponent_score);
  const clamped = Math.max(-5, Math.min(5, Math.round(diff)));
  const key = clamped <= -5 ? "<=-5" : clamped >= 5 ? ">=5" : String(clamped);
  const prev = goalDiffMap.get(key) || { diff: key, games: 0 };
  prev.games += 1;
  goalDiffMap.set(key, prev);
});
const goalDiffOrder = ["<=-5", "-4", "-3", "-2", "-1", "0", "1", "2", "3", "4", ">=5"];
const goalDiffBuckets = goalDiffOrder.map((key) => goalDiffMap.get(key) || { diff: key, games: 0 });

const colorMap = new Map();
rows.forEach((r) => {
  const key = String(r.team_color || "").toLowerCase() === "orange" ? "Orange" : "Blue";
  const prev = colorMap.get(key) || { color: key, games: 0, wins: 0 };
  prev.games += 1;
  prev.wins += r.won ? 1 : 0;
  colorMap.set(key, prev);
});
const colorWinBars = ["Blue", "Orange"].map((color) => {
  const item = colorMap.get(color) || { color, games: 0, wins: 0 };
  const winRate = item.games ? item.wins / item.games : 0;
  return {
    color,
    games: item.games,
    wins: item.wins,
    winRate,
    winRatePct: Number((winRate * 100).toFixed(2)),
  };
});
const blueWinRate = colorWinBars.find((d) => d.color === "Blue")?.winRate || 0;
const orangeWinRate = colorWinBars.find((d) => d.color === "Orange")?.winRate || 0;

const mapStatsMap = new Map();
rows.forEach((r) => {
  const key = String(r.map_name || "Unknown").trim() || "Unknown";
  const prev = mapStatsMap.get(key) || { map: key, games: 0, wins: 0 };
  prev.games += 1;
  prev.wins += r.won ? 1 : 0;
  mapStatsMap.set(key, prev);
});
const mapWinBars = Array.from(mapStatsMap.values())
  .map((item) => {
    const winRate = item.games ? item.wins / item.games : 0;
    return {
      map: item.map,
      games: item.games,
      wins: item.wins,
      losses: Math.max(0, item.games - item.wins),
      winRate,
      winRatePct: Number((winRate * 100).toFixed(2)),
    };
  })
  .sort((a, b) => {
    if (b.games !== a.games) return b.games - a.games;
    return b.winRate - a.winRate;
  });

const mateMap = new Map();
rows.forEach((r) => {
  if (trackedId) {
    const perspective = resolvePerspective(r, trackedPlayerId);
    if (!perspective?.selectedPlayer) return;
    const teammates = (perspective.teamPlayers || []).filter((player) => player && !samePlayer(player, perspective.selectedPlayer));
    const playerScore = findPlayerMetric(r, "score", trackedPlayerId);
    const playerGoals = findPlayerMetric(r, "goals", trackedPlayerId);
    const seenMateKeys = new Set();
    teammates.forEach((mate) => {
      const name = String(mate?.name || "").trim();
      const mateKey = normalizeIdentity(mate?.player_id) || normalizeIdentity(mate?.online_id) || nameKey(name);
      if (!name || !mateKey || seenMateKeys.has(mateKey)) return;
      seenMateKeys.add(mateKey);
      const mateScore = Number(mate?.score ?? 0);
      const prev = mateMap.get(name) || {
        name,
        games: 0,
        wins: 0,
        scoreDiffVsMateTotal: 0,
        scoreTotal: 0,
        goalsTotal: 0,
      };
      prev.games += 1;
      prev.wins += didPlayerWin(r, trackedPlayerId) ? 1 : 0;
      prev.scoreDiffVsMateTotal += Number(playerScore || 0) - mateScore;
      prev.scoreTotal += Number(playerScore || 0);
      prev.goalsTotal += Number(playerGoals || 0);
      mateMap.set(name, prev);
    });
    return;
  }
  const teammates = Array.isArray(r.teammate_names) ? r.teammate_names : [];
  const selfKey = nameKey(r.player_name);
  const unique = Array.from(
    new Set(
      teammates
        .map((n) => String(n || "").trim())
        .filter((n) => n && (!selfKey || nameKey(n) !== selfKey))
    )
  );
  unique.forEach((name) => {
    const prev = mateMap.get(name) || {
      name,
      games: 0,
      wins: 0,
      scoreDiffVsMateTotal: 0,
      scoreTotal: 0,
      goalsTotal: 0,
    };
    prev.games += 1;
    prev.wins += r.won ? 1 : 0;
    prev.scoreDiffVsMateTotal += Number(r.score_diff_vs_mate || 0);
    prev.scoreTotal += Number(r.score || 0);
    prev.goalsTotal += Number(r.goals || 0);
    mateMap.set(name, prev);
  });
});
const mates = Array.from(mateMap.values())
  .map((m) => ({
    name: m.name,
    games: m.games,
    wins: m.wins,
    winRate: m.games ? m.wins / m.games : 0,
    avgScoreDiffVsMate: m.games ? m.scoreDiffVsMateTotal / m.games : 0,
    avgScore: m.games ? m.scoreTotal / m.games : 0,
    avgGoals: m.games ? m.goalsTotal / m.games : 0,
  }))
  .filter((m) => !selfNameKeys.has(nameKey(m.name)))
  .sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.games !== a.games) return b.games - a.games;
    return b.avgScoreDiffVsMate - a.avgScoreDiffVsMate;
  });
const matesByGames = mates.slice().sort((a, b) => b.games - a.games);

const enemyMap = new Map();
rows.forEach((r) => {
  if (trackedId) {
    const perspective = resolvePerspective(r, trackedPlayerId);
    if (!perspective?.selectedPlayer) return;
    const teamKeys = new Set(
      (perspective.teamPlayers || [])
        .map((player) => nameKey(player?.name))
        .filter(Boolean)
    );
    teamKeys.add(nameKey(perspective.selectedPlayer?.name));
    const playerScore = findPlayerMetric(r, "score", trackedPlayerId);
    const playerGoals = findPlayerMetric(r, "goals", trackedPlayerId);
    const seenEnemyKeys = new Set();
    (perspective.opponentPlayers || []).forEach((enemy) => {
      const name = String(enemy?.name || "").trim();
      const enemyKey = normalizeIdentity(enemy?.player_id) || normalizeIdentity(enemy?.online_id) || nameKey(name);
      if (!name || !enemyKey || teamKeys.has(nameKey(name)) || seenEnemyKeys.has(enemyKey)) return;
      seenEnemyKeys.add(enemyKey);
      const enemyScore = Number(enemy?.score ?? 0);
      const prev = enemyMap.get(name) || {
        name,
        games: 0,
        wins: 0,
        scoreDiffVsOppTotal: 0,
        scoreTotal: 0,
        goalsTotal: 0,
      };
      prev.games += 1;
      prev.wins += didPlayerWin(r, trackedPlayerId) ? 1 : 0;
      prev.scoreDiffVsOppTotal += Number(playerScore || 0) - enemyScore;
      prev.scoreTotal += Number(playerScore || 0);
      prev.goalsTotal += Number(playerGoals || 0);
      enemyMap.set(name, prev);
    });
    return;
  }
  const teamKeys = new Set(
    [
      ...(Array.isArray(r.team_player_names) ? r.team_player_names : []),
      ...(Array.isArray(r.team_players) ? r.team_players.map((p) => p?.name) : []),
      r.player_name,
    ]
      .map((n) => nameKey(n))
      .filter(Boolean)
  );
  const opponents = [
    ...(Array.isArray(r.opponent_player_names) ? r.opponent_player_names : []),
    ...(Array.isArray(r.opponent_players) ? r.opponent_players.map((p) => p?.name) : []),
  ];
  const unique = Array.from(
    new Set(
      opponents
        .map((n) => String(n || "").trim())
        .filter((name) => {
          if (!name) return false;
          return !teamKeys.has(nameKey(name));
        })
    )
  );
  unique.forEach((name) => {
    const prev = enemyMap.get(name) || {
      name,
      games: 0,
      wins: 0,
      scoreDiffVsOppTotal: 0,
      scoreTotal: 0,
      goalsTotal: 0,
    };
    prev.games += 1;
    prev.wins += r.won ? 1 : 0;
    prev.scoreDiffVsOppTotal += Number(r.score_diff_vs_opponents || 0);
    prev.scoreTotal += Number(r.score || 0);
    prev.goalsTotal += Number(r.goals || 0);
    enemyMap.set(name, prev);
  });
});
const enemies = Array.from(enemyMap.values())
  .map((e) => ({
    name: e.name,
    games: e.games,
    wins: e.wins,
    losses: Math.max(0, e.games - e.wins),
    winRate: e.games ? e.wins / e.games : 0,
    avgScoreDiffVsOpp: e.games ? e.scoreDiffVsOppTotal / e.games : 0,
    avgScore: e.games ? e.scoreTotal / e.games : 0,
    avgGoals: e.games ? e.goalsTotal / e.games : 0,
  }))
  .filter((e) => !selfNameKeys.has(nameKey(e.name)))
  .sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.games !== a.games) return b.games - a.games;
    return b.avgScoreDiffVsOpp - a.avgScoreDiffVsOpp;
  });
const carryLosses = rows.filter((r) => !r.won && Number(r.pressure_index || 0) >= 3.8).length;
const backpackWins = rows.filter((r) => r.won && Number(r.score_diff_vs_others || 0) >= 180).length;
const backpackSimulatorWins = rows.filter((r) => r.won && Number(r.score_diff_vs_others || 0) >= 300).length;
const zeroGoalWins = rows.filter((r) => r.won && Number(r.goals || 0) === 0).length;
const assistMerchantWins = rows.filter((r) => r.won && Number(r.goals || 0) === 0 && Number(r.assists || 0) >= 2).length;
const brickWallGames = rows.filter((r) => Number(r.saves || 0) >= 7).length;
const emptyNetPoetGames = rows.filter((r) => Number(r.shots || 0) >= 6 && Number(r.goals || 0) === 0).length;
const openNetCurseGames = rows.filter((r) => Number(r.shots || 0) >= 7 && Number(r.goals || 0) === 0).length;
const oneShotWonderGames = rows.filter((r) => Number(r.goals || 0) >= 1 && Number(r.shots || 0) <= 1).length;
const sharpshooterGames = rows.filter((r) => Number(r.shots || 0) >= 3 && Number(r.shot_accuracy || 0) >= 0.5).length;
const boostGoblinGames = rows.filter((r) => boostParts(r).big >= 20).length;
const passengerWins = rows.filter((r) => r.won && Number(r.score_share_team || 0) <= 0.53).length;
const heroLosses = rows.filter((r) => !r.won && Number(r.score_share_team || 0) >= 0.47).length;
const overtimeHeroics = rows.filter((r) => r.won && Number(r.duration_seconds || 0) >= 360).length;
const overtimeHeartbreaks = rows.filter((r) => !r.won && Number(r.duration_seconds || 0) >= 360).length;
const teamCarryGames = rows.filter((r) => Number(r.score_share_team || 0) >= 0.45).length;
const pressureCookerGames = rows.filter((r) => Number(r.pressure_index || 0) >= 1.35).length;
const peakGame = rows.reduce((best, r) => {
  if (!best) return r;
  return Number(r.score || 0) > Number(best.score || 0) ? r : best;
}, null);
const valleyGame = rows.reduce((worst, r) => {
  if (!worst) return r;
  return Number(r.score || 0) < Number(worst.score || 0) ? r : worst;
}, null);
const hourMap = new Map();
rows.forEach((r) => {
  const h = format(parseISO(r.date), "HH");
  hourMap.set(h, (hourMap.get(h) || 0) + 1);
});
const chaosHour = Array.from(hourMap.entries()).sort((a, b) => b[1] - a[1])[0];
const modeChaos = Array.from(modeMap.entries()).sort((a, b) => b[1] - a[1])[0];
const dominantMate = matesByGames[0] || null;
let lossStreak = 0;
let maxLossStreak = 0;
let winStreak = 0;
let maxWinStreak = 0;
ordered.forEach((r) => {
  if (r.won) {
    winStreak += 1;
    if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    lossStreak = 0;
  } else {
    winStreak = 0;
    lossStreak += 1;
    if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
  }
});
let biggestMoodSwing = 0;
for (let i = 1; i < ordered.length; i += 1) {
  const prevScore = Number(ordered[i - 1]?.score || 0);
  const nextScore = Number(ordered[i]?.score || 0);
  const swing = Math.abs(nextScore - prevScore);
  if (swing > biggestMoodSwing) biggestMoodSwing = swing;
}
let worstWindow = null;
let bestWindow = null;
if (ordered.length >= 5) {
  for (let i = 0; i <= ordered.length - 5; i += 1) {
    const slice = ordered.slice(i, i + 5);
    const winsInSlice = slice.filter((r) => r.won).length;
    const rate = winsInSlice / 5;
    if (worstWindow === null || rate < worstWindow.rate) worstWindow = { rate, start: slice[0], end: slice[4] };
    if (bestWindow === null || rate > bestWindow.rate) bestWindow = { rate, start: slice[0], end: slice[4] };
  }
}
const miscStats = [
  {
    label: "Backpack Wins",
    value: backpackWins,
    hint: "Wins where your score was far above lobby average.",
  },
  {
    label: "Carry Losses",
    value: carryLosses,
    hint: "Losses despite a strong score gap vs others.",
  },
  {
    label: "Backpack Simulator",
    value: backpackSimulatorWins,
    hint: "Wins where you outscored your teammate by 220+.",
  },
  {
    label: "Zero-Goal Wins",
    value: zeroGoalWins,
    hint: "Wins with no goals scored by you.",
  },
  {
    label: "Assist Merchant",
    value: assistMerchantWins,
    hint: "Wins with 2+ assists and zero goals.",
  },
  {
    label: "Brick Wall Games",
    value: brickWallGames,
    hint: "Games with 7+ saves.",
  },
  {
    label: "Longest Heater",
    value: maxWinStreak,
    hint: "Longest consecutive win streak.",
  },
  {
    label: "Longest Doom Streak",
    value: maxLossStreak,
    hint: "Longest consecutive loss streak.",
  },
  {
    label: "Chaos Hour",
    value: chaosHour ? `${chaosHour[0]}:00 (${chaosHour[1]} games)` : "-",
    hint: "Hour of day where you played the most.",
  },
  {
    label: "Peak Pop-off",
    value: peakGame ? `${num(peakGame.score)} (${peakGame.id})` : "-",
    hint: "Highest individual score in filtered matches.",
  },
  {
    label: "Score Abyss",
    value: valleyGame ? `${num(valleyGame.score)} (${valleyGame.id})` : "-",
    hint: "Lowest score game in filtered matches.",
  },
  {
    label: "Mood Swing",
    value: num(biggestMoodSwing),
    hint: "Biggest score jump between two consecutive games.",
  },
  {
    label: "Empty-Net Poet",
    value: emptyNetPoetGames,
    hint: "Games with 6+ shots and zero goals.",
  },
  {
    label: "Open-Net Curse",
    value: openNetCurseGames,
    hint: "Games with 7+ shots and still zero goals.",
  },
  {
    label: "One-Shot Wonder",
    value: oneShotWonderGames,
    hint: "Scored with one shot or fewer.",
  },
  {
    label: "Laser Precision",
    value: sharpshooterGames,
    hint: "Games with 50%+ shot accuracy on at least 3 shots.",
  },
  {
    label: "Boost Goblin",
    value: boostGoblinGames,
    hint: "Games with 20+ big boosts collected.",
  },
  {
    label: "Passenger Wins",
    value: passengerWins,
    hint: "Wins while trailing your teammate by 120+ score.",
  },
  {
    label: "Hero Losses",
    value: heroLosses,
    hint: "Losses while leading your teammate by 120+ score.",
  },
  {
    label: "Main Character Games",
    value: teamCarryGames,
    hint: "Games where you delivered 45%+ of team score.",
  },
  {
    label: "Pressure Cooker",
    value: pressureCookerGames,
    hint: "Games with pressure index at or above 1.35.",
  },
  {
    label: "OT Heroics",
    value: overtimeHeroics,
    hint: "Wins in marathon games (6:00+ elapsed).",
  },
  {
    label: "OT Heartbreaks",
    value: overtimeHeartbreaks,
    hint: "Losses in marathon games (6:00+ elapsed).",
  },
  {
    label: "Comfort Mode",
    value: modeChaos ? `${modeChaos[0]} (${modeChaos[1]})` : "-",
    hint: "Most played game mode in current filters.",
  },
  {
    label: "Ride-or-Die Mate",
    value: dominantMate ? `${dominantMate.name} (${dominantMate.games})` : "-",
    hint: "Most frequent teammate in filtered matches.",
  },
  {
    label: "Darkest 5-Game Arc",
    value: worstWindow ? `${(worstWindow.rate * 100).toFixed(2)}% (${worstWindow.start.id} -> ${worstWindow.end.id})` : "-",
    hint: "Lowest win rate observed in any 5-game sequence.",
  },
  {
    label: "Best 5-Game Arc",
    value: bestWindow ? `${(bestWindow.rate * 100).toFixed(2)}% (${bestWindow.start.id} -> ${bestWindow.end.id})` : "-",
    hint: "Highest win rate observed in any 5-game sequence.",
  },
].slice(0, 8);

const avgBigBoosts = avg("big_boosts");
const avgSmallBoosts = avg("small_boosts");
const avgBoostTotal = avgBigBoosts + avgSmallBoosts;
const bigBoostShare = avgBoostTotal > 0 ? avgBigBoosts / avgBoostTotal : 0;

return {
  matches,
  wins,
  losses: matches - wins,
  winRate: matches ? wins / matches : 0,
  avgScore: avg("score"),
  avgGoals: avg("goals"),
  avgAssists: avg("assists"),
  avgSaves: avg("saves"),
  avgBigBoosts,
  avgSmallBoosts,
  avgBoostTotal,
  bigBoostShare,
  modeBars,
  modeOutcomeBars,
  durationBuckets,
  goalDiffBuckets,
  colorWinBars,
  mapWinBars,
  blueWinRate,
  orangeWinRate,
  mates,
  uniqueMates: mates.length,
  enemies,
  uniqueEnemies: enemies.length,
  miscStats,
  daysPlayedHeatmap,
};
}
