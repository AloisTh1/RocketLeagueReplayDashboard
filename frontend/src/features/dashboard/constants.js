export const RECENT_COLUMNS_KEY = "rl_recent_columns_v1";
export const RECENT_TABLE_FULL_COLS_KEY = "rl_recent_table_full_cols_v1";
export const RECENT_TABLE_MAX_ROWS_KEY = "rl_recent_table_max_rows_v1";

export const RECENT_COLUMN_DEFS = [
  { id: "date", label: "Date" },
  { id: "map", label: "Map" },
  { id: "type", label: "Type" },
  { id: "mode", label: "Mode" },
  { id: "result", label: "Result" },
  { id: "scoreline", label: "Score" },
  { id: "duration", label: "Duration" },
  { id: "team_players", label: "Team players" },
  { id: "opponents", label: "Opponents" },
  { id: "replay", label: "Replay" },
];

export const PLATFORM_LEGEND = [
  { code: "S", label: "Steam" },
  { code: "E", label: "Epic" },
  { code: "X", label: "Xbox" },
  { code: "P", label: "PlayStation" },
  { code: "N", label: "Nintendo" },
  { code: "B", label: "Bot" },
  { code: "?", label: "Unknown" },
];

export const ANALYTICS_VIEW_DEFS = [
  { id: "overview", label: "Overview", tip: "Core performance graphs: trends, momentum, score deltas, and category summaries." },
  { id: "other", label: "Other stats", tip: "Secondary stat views: impactful deltas and grouped match-type summaries." },
  { id: "boost", label: "Boost", tip: "Boost-focused charts: pickup volume and win/loss boost comparison." },
  { id: "distribution", label: "Distribution", tip: "Distribution views: mode mix, team-color win rates, duration and score differential." },
  { id: "synergy", label: "Synergy", tip: "Teammate chemistry views: who you play with most and how outcomes shift." },
  { id: "all", label: "All charts", tip: "Show every analytics block at once." },
];

export const METRIC_DOCS = {
  Replays: "Formula: matches = scopedRows.length. Extract: row={id:'abc123', date:'2026-03-02T11:30:00Z'}.",
  "Win Rate": "Formula: wins / matches. Extract: wins=32, matches=57 -> 56.14%.",
  "Player Avg Score": "Formula: mean(trackedPlayer.score). Extract: player={score:420, goals:2, assists:1}.",
  "Player Avg Goals": "Formula: mean(trackedPlayer.goals). Extract: player={goals:2, shots:6}.",
  "Player Avg Assists": "Formula: mean(trackedPlayer.assists). Extract: player={assists:1}.",
  "Player Avg Saves": "Formula: mean(trackedPlayer.saves). Extract: player={saves:3}.",
  "Avg Goals": "Formula: mean(goals). Team scope -> mean(row.goals). Player scope -> mean(trackedPlayer.goals). Extract: row.goals=7, player.goals=2.",
  "Avg Shots": "Formula: mean(shots). Team scope -> row.shots. Player scope -> trackedPlayer.shots. Extract: row.shots=15, player.shots=6.",
  "Shot Accuracy": "Formula: mean(goals / shots). Team scope -> row.shot_accuracy. Player scope -> trackedPlayer.goals/trackedPlayer.shots. Extract: goals=3, shots=8 -> 37.50%.",
  "Goals vs Opp": "Formula: mean(goals - opponentGoals). Team scope -> row.goals_diff_vs_opponents. Player scope -> trackedPlayer.goals - sum(opponent.goals). Extract: player.goals=2, oppGoals=4 -> -2.",
  "Avg Saves": "Formula: mean(saves). Team scope -> row.saves. Player scope -> trackedPlayer.saves. Extract: row.saves=5, player.saves=2.",
  "Saves vs Opp": "Formula: mean(saves - opponentSaves). Team scope -> row.saves_diff_vs_opponents. Player scope -> trackedPlayer.saves - sum(opponent.saves). Extract: player.saves=3, oppSaves=2 -> +1.",
  "Save Share Team": "Formula: mean(saves/teamSaves). Team scope uses row.saves_share_team. Player scope uses trackedPlayer.saves / sum(team.saves). Extract: player.saves=2, team.saves=5 -> 40.00%.",
  "Pressure Index": "Formula: score*0.01 + goals*2 + assists*1.5 + saves*1.4 + shots*0.7 + demos*0.8. Extract: score=500, goals=2, assists=1, saves=3, shots=7, demos=1.",
  "Avg Assists": "Formula: mean(assists). Team scope -> row.assists. Player scope -> trackedPlayer.assists. Extract: row.assists=3, player.assists=1.",
  "Score vs Mate": "Formula: mean(score - mateAvgScore). Team scope -> row.score_diff_vs_mate. Player scope -> trackedPlayer.score - avg(teammate.score). Extract: player.score=480, mateAvg=410 -> +70.",
  "Score Share Team": "Formula: mean(score/teamScore). Team scope uses row.score_share_team. Player scope uses trackedPlayer.score / sum(team.score). Extract: player.score=430, team.score=980 -> 43.88%.",
  "Assists Share Team": "Formula: mean(assists/teamAssists). Team scope uses row.assists_share_team. Player scope uses trackedPlayer.assists / sum(team.assists). Extract: player.assists=2, team.assists=5 -> 40.00%.",
  "Avg Big Boosts": "Formula: mean(big boosts). Team scope -> row.team_big_boosts (fallback row.big_boosts). Player scope -> trackedPlayer.big_boosts. Extract: team_big_boosts=28, player.big_boosts=11.",
  "Avg Small Boosts": "Formula: mean(small boosts). Team scope -> row.team_small_boosts (fallback row.small_boosts). Player scope -> trackedPlayer.small_boosts. Extract: team_small_boosts=95, player.small_boosts=39.",
  "Avg Total Boost": "Formula: mean(big + small). Team scope uses team totals; player scope uses tracked player totals. Extract: big=11, small=39 -> total=50.",
  "Big Boost Share": "Formula: Avg Big Boosts / Avg Total Boost. Extract: avgBig=28.2, avgTotal=129.5 -> 21.77%.",
  "Avg Score": "Formula: mean(score). Team scope -> row.score. Player scope -> trackedPlayer.score. Extract: row.score=1010, player.score=430.",
  "Score vs Opp": "Formula: mean(score - opponentScore). Team scope -> row.score_diff_vs_opponents. Player scope -> trackedPlayer.score - sum(opponent.score). Extract: player.score=430, oppScore=980 -> -550.",
  "Score vs Others": "Formula: mean(score - othersScore). Team scope -> row.score_diff_vs_others. Player scope -> trackedPlayer.score - sum(otherPlayers.score). Extract: player.score=430, others=1430 -> -1000.",
  "Goal Share Team": "Formula: mean(goals/teamGoals). Team scope uses row.goals_share_team. Player scope uses trackedPlayer.goals / sum(team.goals). Extract: player.goals=2, team.goals=5 -> 40.00%.",
  "Assist vs Opp": "Formula: mean(assists - opponentAssists). Team scope -> row.assists_diff_vs_opponents. Player scope -> trackedPlayer.assists - sum(opponent.assists). Extract: player.assists=1, oppAssists=2 -> -1.",
  Score: "Formula: delta = mean(score in wins) - mean(score in losses). Team scope uses team score; player scope uses trackedPlayer.score. Extract: W=1040, L=860 -> +180.",
  Goals: "Formula: delta = mean(goals in wins) - mean(goals in losses). Extract: W=4.2, L=2.7 -> +1.5.",
  Shots: "Formula: delta = mean(shots in wins) - mean(shots in losses). Extract: W=11.3, L=8.9 -> +2.4.",
  Saves: "Formula: delta = mean(saves in wins) - mean(saves in losses). Extract: W=4.1, L=3.4 -> +0.7.",
  "Big Boosts": "Formula: delta = mean(big_boosts in wins) - mean(big_boosts in losses). Extract: W=31.0, L=27.2 -> +3.8.",
  "Small Boosts": "Formula: delta = mean(small_boosts in wins) - mean(small_boosts in losses). Extract: W=101.5, L=92.4 -> +9.1.",
  "Weighted Win Rate": "Formula: sum(bucket.wins) / sum(bucket.games). Extract: buckets=[{wins:8,games:12},{wins:5,games:10}].",
  "Weighted Avg Score": "Formula: sum(bucket.avgScore * bucket.games) / sum(bucket.games). Extract: [{avgScore:900,games:12},{avgScore:1040,games:10}].",
  "Avg Games / Bucket": "Formula: sum(bucket.games) / nonEmptyBucketCount. Extract: totalGames=57, buckets=12 -> 4.75.",
  "Best Bucket": "Formula: max bucket by winRate (tie-break: games). Extract: {bucket:'2026-02-28', winRate:0.80, games:5}.",
  "Worst Bucket": "Formula: min bucket by winRate (tie-break: games). Extract: {bucket:'2026-02-25', winRate:0.20, games:5}.",
  "Busiest Bucket": "Formula: bucket with max games. Extract: {bucket:'2026-02-27', games:9}.",
  "Win Trend": "Formula: per bucket -> winRate = wins/games. Extract: bucket='2026-03-01', wins=6, games=10 -> 60.00%.",
  "Score Momentum": "Formula: per bucket -> avgScore. Extract: bucket='2026-03-01', scoreTotal=9800, games=10 -> 980.",
  "Score Diff Trend": "Formula: per bucket -> avg(score_diff_vs_others). Extract: bucket='2026-03-01', values=[+40,+15,-20,...].",
  "Mode Distribution": "Formula: count rows by game_mode. Extract: rows game_mode=['2v2','2v2','3v3'].",
  "Mode Outcomes Split": "Formula: for each mode, count wins and losses. Extract: mode='2v2' -> wins=14, losses=9.",
  "Win Rate by Team Color": "Formula: wins(color) / games(color) for Blue and Orange. Extract: Blue {wins:11,games:18}.",
  "Match Duration Distribution": "Formula: bucket by duration_seconds into <=3m,3-4m,4-5m,5-6m,>=6m; compute games and win%. Extract: duration_seconds=302 -> '5-6m'.",
  "Goal Differential Distribution": "Formula: diff = team_score - opponent_score, clamped to <=-5 .. >=5. Extract: team_score=4, opponent_score=1 -> diff=3.",
  "Mates Synergy": "Formula: per teammate (>=2 games): games and winRate. Extract: teammate='foo', games=7, wins=5 -> 71.43%.",
  "Best Mates": "Formula: teammate table sorted by winRate/games with avg score and avg score-vs-mate. Extract: {name:'foo', games:7, wins:5, avgScore:910}.",
};

export const TAB_META = {
  day: {
    label: "Day by Day",
    short: "Day",
    tip: "Chronological daily buckets over your selected date range.",
  },
  hour: {
    label: "Hourly Timeline",
    short: "Hour TL",
    tip: "Continuous timeline grouped by actual hour timestamps (date + hour).",
  },
  hour_of_day: {
    label: "Hour of Day (Aggregate)",
    short: "Hour OD",
    tip: "Aggregated by clock hour (00-23) across all selected days.",
  },
  week: {
    label: "Week by Week",
    short: "Week",
    tip: "Chronological weekly buckets over your selected date range.",
  },
  month: {
    label: "Month by Month",
    short: "Month",
    tip: "Chronological monthly buckets over your selected date range.",
  },
};
