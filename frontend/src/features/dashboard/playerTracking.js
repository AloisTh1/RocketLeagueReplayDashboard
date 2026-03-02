function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function idMatches(candidate, target) {
  if (!candidate || !target) return false;
  return candidate === target || candidate.includes(target) || target.includes(candidate);
}

function ratio(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return num / den;
}

function rowRoster(row) {
  return [
    ...(Array.isArray(row?.team_players) ? row.team_players : []),
    ...(Array.isArray(row?.opponent_players) ? row.opponent_players : []),
  ];
}

function teamRoster(row) {
  return Array.isArray(row?.team_players) ? row.team_players : [];
}

function opponentRoster(row) {
  return Array.isArray(row?.opponent_players) ? row.opponent_players : [];
}

function samePlayer(a, b) {
  if (!a || !b) return false;
  const aPid = normalizeIdentity(a?.player_id);
  const aOid = normalizeIdentity(a?.online_id);
  const bPid = normalizeIdentity(b?.player_id);
  const bOid = normalizeIdentity(b?.online_id);
  if ((aPid && idMatches(aPid, bPid)) || (aPid && idMatches(aPid, bOid))) return true;
  if ((aOid && idMatches(aOid, bPid)) || (aOid && idMatches(aOid, bOid))) return true;
  const aName = normalizeName(a?.name);
  const bName = normalizeName(b?.name);
  return Boolean(aName && bName && aName === bName);
}

function metricFromPlayer(player, metricKey) {
  if (!player) return null;
  if (metricKey === "shot_accuracy") {
    const explicit = toFinite(player?.shot_accuracy);
    if (explicit !== null) return explicit;
    const goals = toFinite(player?.goals);
    const shots = toFinite(player?.shots);
    if (goals !== null && shots !== null && shots > 0) return goals / shots;
    return 0;
  }
  if (metricKey === "boost_total") {
    const explicit = toFinite(player?.boost_total);
    if (explicit !== null) return explicit;
    const big = toFinite(player?.big_boosts);
    const small = toFinite(player?.small_boosts);
    if (big === null && small === null) return null;
    return Number(big ?? 0) + Number(small ?? 0);
  }
  return toFinite(player?.[metricKey]);
}

function sumMetric(roster, metricKey) {
  if (!Array.isArray(roster) || !roster.length) return null;
  let total = 0;
  let seen = false;
  for (const player of roster) {
    const value = metricFromPlayer(player, metricKey);
    if (value === null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function fallbackSelectedPlayerFromRow(row) {
  const fallback = {
    name: String(row?.player_name || ""),
    player_id: String(row?.player_id || ""),
    online_id: String(row?.online_id || ""),
    score: toFinite(row?.player_score),
    goals: toFinite(row?.player_goals),
    assists: toFinite(row?.player_assists),
    saves: toFinite(row?.player_saves),
    shots: toFinite(row?.player_shots),
    demos: toFinite(row?.player_demos),
    big_boosts: toFinite(row?.player_big_boosts),
    small_boosts: toFinite(row?.player_small_boosts),
  };
  const hasStats = [
    fallback.score,
    fallback.goals,
    fallback.assists,
    fallback.saves,
    fallback.shots,
    fallback.demos,
    fallback.big_boosts,
    fallback.small_boosts,
  ].some((value) => value !== null);
  const hasIdentity =
    normalizeIdentity(fallback.player_id) || normalizeIdentity(fallback.online_id) || normalizeName(fallback.name);
  return hasStats || hasIdentity ? fallback : null;
}

function findSelectedPlayerInRow(row) {
  const roster = rowRoster(row);
  if (!roster.length) return null;
  const pid = normalizeIdentity(row?.player_id);
  const oid = normalizeIdentity(row?.online_id);
  if (pid || oid) {
    for (const player of roster) {
      const playerPid = normalizeIdentity(player?.player_id);
      const playerOid = normalizeIdentity(player?.online_id);
      if (
        (pid && (idMatches(playerPid, pid) || idMatches(playerOid, pid))) ||
        (oid && (idMatches(playerPid, oid) || idMatches(playerOid, oid)))
      ) {
        return player;
      }
    }
  }
  const targetName = normalizeName(row?.player_name);
  if (targetName) {
    for (const player of roster) {
      if (normalizeName(player?.name) === targetName) return player;
    }
  }
  return null;
}

export function findTrackedPlayerInRow(row, trackedPlayerId) {
  const target = normalizeIdentity(trackedPlayerId);
  if (!target) return null;
  const roster = rowRoster(row);
  for (const player of roster) {
    const pid = normalizeIdentity(player?.player_id);
    const oid = normalizeIdentity(player?.online_id);
    if (idMatches(pid, target) || idMatches(oid, target)) return player;
  }
  return null;
}

function rowSelectedPlayerMatchesTracked(row, trackedPlayerId) {
  const target = normalizeIdentity(trackedPlayerId);
  if (!target) return false;
  const pid = normalizeIdentity(row?.player_id);
  const oid = normalizeIdentity(row?.online_id);
  return idMatches(pid, target) || idMatches(oid, target);
}

function resolvePlayerForRow(row, trackedPlayerId) {
  const tracked = normalizeIdentity(trackedPlayerId);
  if (tracked) {
    const matched = findTrackedPlayerInRow(row, trackedPlayerId);
    if (matched) return matched;
    if (rowSelectedPlayerMatchesTracked(row, trackedPlayerId)) return fallbackSelectedPlayerFromRow(row);
    return null;
  }
  return findSelectedPlayerInRow(row) || fallbackSelectedPlayerFromRow(row);
}

function teamTotalMetric(row, metricKey) {
  if (metricKey === "boost_total") {
    const big = teamTotalMetric(row, "big_boosts");
    const small = teamTotalMetric(row, "small_boosts");
    if (big === null && small === null) return null;
    return Number(big ?? 0) + Number(small ?? 0);
  }
  const fromRoster = sumMetric(teamRoster(row), metricKey);
  if (fromRoster !== null) return fromRoster;
  const fallbackMap = {
    score: row?.score,
    goals: row?.goals,
    assists: row?.assists,
    saves: row?.saves,
    shots: row?.shots,
    demos: row?.demos,
    big_boosts: row?.team_big_boosts ?? row?.big_boosts,
    small_boosts: row?.team_small_boosts ?? row?.small_boosts,
  };
  return toFinite(fallbackMap[metricKey]);
}

function opponentTotalMetric(row, metricKey) {
  if (metricKey === "boost_total") {
    const big = opponentTotalMetric(row, "big_boosts");
    const small = opponentTotalMetric(row, "small_boosts");
    if (big === null && small === null) return null;
    return Number(big ?? 0) + Number(small ?? 0);
  }
  const fromRoster = sumMetric(opponentRoster(row), metricKey);
  if (fromRoster !== null) return fromRoster;
  if (metricKey === "score") return toFinite(row?.opponent_score);
  const teamTotal = teamTotalMetric(row, metricKey);
  if (teamTotal === null) return null;
  const diffVsOpp = toFinite(row?.[`${metricKey}_diff_vs_opponents`]);
  if (diffVsOpp !== null) return teamTotal - diffVsOpp;
  const diffVsOthers = toFinite(row?.[`${metricKey}_diff_vs_others`]);
  if (diffVsOthers !== null) return teamTotal - diffVsOthers;
  return null;
}

function othersTotalMetric(row, metricKey, selectedPlayer) {
  const roster = rowRoster(row).filter((player) => !samePlayer(player, selectedPlayer));
  const fromRoster = sumMetric(roster, metricKey);
  if (fromRoster !== null) return fromRoster;
  return opponentTotalMetric(row, metricKey);
}

function teammateAverageMetric(row, metricKey, selectedPlayer) {
  const mates = teamRoster(row).filter((player) => !samePlayer(player, selectedPlayer));
  if (mates.length > 0) {
    const total = sumMetric(mates, metricKey);
    if (total !== null) return total / mates.length;
  }
  if (metricKey === "score") return toFinite(row?.teammate_avg_score);
  return null;
}

function computeDerivedPlayerMetric(row, selectedPlayer, metricKey) {
  if (!selectedPlayer) return null;
  if (metricKey === "pressure_index") {
    const score = metricFromPlayer(selectedPlayer, "score") ?? 0;
    const goals = metricFromPlayer(selectedPlayer, "goals") ?? 0;
    const assists = metricFromPlayer(selectedPlayer, "assists") ?? 0;
    const saves = metricFromPlayer(selectedPlayer, "saves") ?? 0;
    const shots = metricFromPlayer(selectedPlayer, "shots") ?? 0;
    const demos = metricFromPlayer(selectedPlayer, "demos") ?? 0;
    return score * 0.01 + goals * 2 + assists * 1.5 + saves * 1.4 + shots * 0.7 + demos * 0.8;
  }
  if (metricKey === "score_diff_vs_mate") {
    const score = metricFromPlayer(selectedPlayer, "score");
    const mateAvgScore = teammateAverageMetric(row, "score", selectedPlayer);
    if (score === null || mateAvgScore === null) return null;
    return score - mateAvgScore;
  }
  if (metricKey.endsWith("_share_team")) {
    const baseMetric = metricKey.replace("_share_team", "");
    const playerValue = metricFromPlayer(selectedPlayer, baseMetric);
    const teamValue = teamTotalMetric(row, baseMetric);
    if (playerValue === null || teamValue === null) return null;
    return ratio(playerValue, teamValue);
  }
  if (metricKey.endsWith("_diff_vs_opponents")) {
    const baseMetric = metricKey.replace("_diff_vs_opponents", "");
    const playerValue = metricFromPlayer(selectedPlayer, baseMetric);
    const opponentsValue = opponentTotalMetric(row, baseMetric);
    if (playerValue === null || opponentsValue === null) return null;
    return playerValue - opponentsValue;
  }
  if (metricKey.endsWith("_diff_vs_others")) {
    const baseMetric = metricKey.replace("_diff_vs_others", "");
    const playerValue = metricFromPlayer(selectedPlayer, baseMetric);
    const othersValue = othersTotalMetric(row, baseMetric, selectedPlayer);
    if (playerValue === null || othersValue === null) return null;
    return playerValue - othersValue;
  }
  return null;
}

export function isTrackedRow(row, trackedPlayerId) {
  if (!normalizeIdentity(trackedPlayerId)) return Boolean(row?.highlighted);
  return Boolean(findTrackedPlayerInRow(row, trackedPlayerId) || rowSelectedPlayerMatchesTracked(row, trackedPlayerId));
}

export function findPlayerMetric(row, metricKey, trackedPlayerId) {
  const selectedPlayer = resolvePlayerForRow(row, trackedPlayerId);
  if (!selectedPlayer) return null;
  const derived = computeDerivedPlayerMetric(row, selectedPlayer, metricKey);
  if (derived !== null) return derived;
  const direct = metricFromPlayer(selectedPlayer, metricKey);
  if (direct !== null) return direct;
  return toFinite(row?.[`player_${metricKey}`]);
}
