import { addHours, format, parseISO, startOfWeek } from "date-fns";
import { num, pct, signed } from "./utils/formatters";

export function computeDerived(filteredRecent) {
const rows = filteredRecent;
const matches = rows.length;
const wins = rows.filter((r) => r.won).length;
const safeNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const nameKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
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
const emptyBucket = (bucket) => ({ bucket, wins: 0, games: 0, scoreTotal: 0, diffTotal: 0 });
const toBucketRow = (d) => ({
  bucket: d.bucket,
  games: d.games,
  wins: d.wins,
  winRate: d.games ? d.wins / d.games : 0,
  avgScore: d.games ? d.scoreTotal / d.games : 0,
  scoreDiff: d.games ? d.diffTotal / d.games : 0,
});
const buildBuckets = (keyFn, sorter) => {
  const map = new Map();
  ordered.forEach((r) => {
    const key = keyFn(r);
    const prev = map.get(key) || emptyBucket(key);
    prev.games += 1;
    prev.wins += r.won ? 1 : 0;
    prev.scoreTotal += Number(r.score || 0);
    prev.diffTotal += Number(r.score_diff_vs_others || 0);
    map.set(key, prev);
  });
  const out = Array.from(map.values()).map((d) => toBucketRow(d));
  return sorter ? out.sort(sorter) : out;
};
const trendDay = buildBuckets((r) => format(parseISO(r.date), "yyyy-MM-dd"), (a, b) => a.bucket.localeCompare(b.bucket));
const trendWeek = buildBuckets(
  (r) => format(startOfWeek(parseISO(r.date), { weekStartsOn: 1 }), "yyyy-MM-dd"),
  (a, b) => a.bucket.localeCompare(b.bucket)
);
const trendMonth = buildBuckets((r) => format(parseISO(r.date), "yyyy-MM"), (a, b) => a.bucket.localeCompare(b.bucket));
const trendHourOfDay = buildBuckets(
  (r) => format(parseISO(r.date), "HH:00"),
  (a, b) => Number(a.bucket.slice(0, 2)) - Number(b.bucket.slice(0, 2))
);
const hourTimelineMap = new Map();
ordered.forEach((r) => {
  const dt = parseISO(r.date);
  const key = format(dt, "yyyy-MM-dd HH:00");
  const prev = hourTimelineMap.get(key) || emptyBucket(key);
  prev.games += 1;
  prev.wins += r.won ? 1 : 0;
  prev.scoreTotal += Number(r.score || 0);
  prev.diffTotal += Number(r.score_diff_vs_others || 0);
  hourTimelineMap.set(key, prev);
});
const trendHour = [];
if (ordered.length > 0) {
  const start = parseISO(ordered[0].date);
  start.setMinutes(0, 0, 0);
  const end = parseISO(ordered[ordered.length - 1].date);
  end.setMinutes(0, 0, 0);
  for (let cursor = new Date(start); cursor <= end; cursor = addHours(cursor, 1)) {
    const key = format(cursor, "yyyy-MM-dd HH:00");
    trendHour.push(toBucketRow(hourTimelineMap.get(key) || emptyBucket(key)));
  }
}

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

const mateMap = new Map();
rows.forEach((r) => {
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
  .sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.games !== a.games) return b.games - a.games;
    return b.avgScoreDiffVsMate - a.avgScoreDiffVsMate;
  });
const matesByGames = mates.slice().sort((a, b) => b.games - a.games);
const eligibleBestMate = mates.filter((m) => m.games >= 3);
const bestMate = (eligibleBestMate.length ? eligibleBestMate : mates)[0] || null;
const mateBars = matesByGames
  .filter((m) => m.games >= 2)
  .slice(0, 10)
  .map((m) => ({
  mate: m.name,
  games: m.games,
  winRate: Number((m.winRate * 100).toFixed(2)),
}));

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
    label: "Longest Heater",
    value: maxWinStreak,
    hint: "Longest consecutive win streak.",
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
].slice(0, 7);

const avgIn = (list, key) => {
  if (!list.length) return 0;
  if (key === "big_boosts") return list.reduce((sum, r) => sum + boostParts(r).big, 0) / list.length;
  if (key === "small_boosts") return list.reduce((sum, r) => sum + boostParts(r).small, 0) / list.length;
  if (key === "boost_total") return list.reduce((sum, r) => sum + boostParts(r).total, 0) / list.length;
  return list.reduce((sum, r) => sum + safeNum(r?.[key]), 0) / list.length;
};
const winsOnly = rows.filter((r) => r.won);
const lossesOnly = rows.filter((r) => !r.won);
const impactStats = [
  { key: "score", label: "Score" },
  { key: "goals", label: "Goals" },
  { key: "shots", label: "Shots" },
  { key: "saves", label: "Saves" },
  { key: "big_boosts", label: "Big Boosts" },
  { key: "small_boosts", label: "Small Boosts" },
]
  .map((m) => {
    const winAvg = avgIn(winsOnly, m.key);
    const lossAvg = avgIn(lossesOnly, m.key);
    return {
      label: m.label,
      winAvg,
      lossAvg,
      delta: winAvg - lossAvg,
    };
  })
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

const byTypeMap = new Map();
rows.forEach((r) => {
  const type = r.match_type || "Unknown";
  const prev = byTypeMap.get(type) || {
    type,
    games: 0,
    wins: 0,
    scoreTotal: 0,
    bigBoostsTotal: 0,
    smallBoostsTotal: 0,
  };
  prev.games += 1;
  prev.wins += r.won ? 1 : 0;
  const boosts = boostParts(r);
  prev.scoreTotal += safeNum(r.score);
  prev.bigBoostsTotal += boosts.big;
  prev.smallBoostsTotal += boosts.small;
  byTypeMap.set(type, prev);
});
const byType = Array.from(byTypeMap.values())
  .map((v) => ({
    type: v.type,
    games: v.games,
    winRate: v.games ? v.wins / v.games : 0,
    avgScore: v.games ? v.scoreTotal / v.games : 0,
    avgBigBoosts: v.games ? v.bigBoostsTotal / v.games : 0,
    avgSmallBoosts: v.games ? v.smallBoostsTotal / v.games : 0,
    avgBoostTotal: v.games ? (v.bigBoostsTotal + v.smallBoostsTotal) / v.games : 0,
  }))
  .sort((a, b) => b.games - a.games);

const avgBigBoosts = avg("big_boosts");
const avgSmallBoosts = avg("small_boosts");
const avgBoostTotal = avgBigBoosts + avgSmallBoosts;
const bigBoostShare = avgBoostTotal > 0 ? avgBigBoosts / avgBoostTotal : 0;
const winBigBoost = avgIn(winsOnly, "big_boosts");
const lossBigBoost = avgIn(lossesOnly, "big_boosts");
const winSmallBoost = avgIn(winsOnly, "small_boosts");
const lossSmallBoost = avgIn(lossesOnly, "small_boosts");
const boostBars = [
  { metric: "Big", avg: avgBigBoosts },
  { metric: "Small", avg: avgSmallBoosts },
  { metric: "Total", avg: avgBoostTotal },
];
const boostWinLoss = [
  { metric: "Big", win: winBigBoost, loss: lossBigBoost },
  { metric: "Small", win: winSmallBoost, loss: lossSmallBoost },
];

const avgShotAccuracy = avg("shot_accuracy");
const avgPressure = avg("pressure_index");
const avgScoreShareTeam = avg("score_share_team");
const avgGoalsShareTeam = avg("goals_share_team");
const avgAssistsShareTeam = avg("assists_share_team");
const avgSavesShareTeam = avg("saves_share_team");
const avgScoreVsOpp = avg("score_diff_vs_opponents");
const avgGoalsVsOpp = avg("goals_diff_vs_opponents");
const avgAssistsVsOpp = avg("assists_diff_vs_opponents");
const avgSavesVsOpp = avg("saves_diff_vs_opponents");

const categories = [
  {
    id: "offense",
    label: "Offense",
    metrics: [
      { label: "Avg Goals", value: num(avg("goals")) },
      { label: "Avg Shots", value: num(avg("shots")) },
      { label: "Shot Accuracy", value: pct(avgShotAccuracy) },
      { label: "Goals vs Opp", value: signed(avgGoalsVsOpp) },
    ],
  },
  {
    id: "defense",
    label: "Defense",
    metrics: [
      { label: "Avg Saves", value: num(avg("saves")) },
      { label: "Saves vs Opp", value: signed(avgSavesVsOpp) },
      { label: "Save Share Team", value: pct(avgSavesShareTeam) },
      { label: "Pressure Index", value: num(avgPressure) },
    ],
  },
  {
    id: "teamplay",
    label: "Teamplay",
    metrics: [
      { label: "Avg Assists", value: num(avg("assists")) },
      { label: "Score vs Mate", value: signed(avg("score_diff_vs_mate")) },
      { label: "Score Share Team", value: pct(avgScoreShareTeam) },
      { label: "Assists Share Team", value: pct(avgAssistsShareTeam) },
    ],
  },
  {
    id: "impact",
    label: "Impact",
    metrics: [
      { label: "Avg Score", value: num(avg("score")) },
      { label: "Pressure Index", value: num(avgPressure) },
      { label: "Score vs Opp", value: signed(avgScoreVsOpp) },
      { label: "Score vs Others", value: signed(avg("score_diff_vs_others")) },
    ],
  },
  {
    id: "context",
    label: "Context",
    metrics: [
      { label: "Win Rate", value: pct(matches ? wins / matches : 0) },
      { label: "Goal Share Team", value: pct(avgGoalsShareTeam) },
      { label: "Save Share Team", value: pct(avgSavesShareTeam) },
      { label: "Assist vs Opp", value: signed(avgAssistsVsOpp) },
    ],
  },
];

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
  avgScoreDiff: avg("score_diff_vs_others"),
  avgScoreMateDiff: avg("score_diff_vs_mate"),
  avgGoalsDiff: avg("goals_diff_vs_others"),
  avgAssistsDiff: avg("assists_diff_vs_others"),
  avgSavesDiff: avg("saves_diff_vs_others"),
  trend: trendDay,
  trendByTab: {
    day: trendDay,
    week: trendWeek,
    month: trendMonth,
    hour: trendHour,
    hour_of_day: trendHourOfDay,
  },
  modeBars,
  modeOutcomeBars,
  durationBuckets,
  goalDiffBuckets,
  colorWinBars,
  blueWinRate,
  orangeWinRate,
  mates,
  mateBars,
  uniqueMates: mates.length,
  bestMate,
  miscStats,
  impactStats,
  byType,
  boostBars,
  boostWinLoss,
  avgShotAccuracy,
  avgPressure,
  avgScoreShareTeam,
  categories,
};
}
