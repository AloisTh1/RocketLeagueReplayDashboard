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
  if (candidate === target) return true;
  if (candidate.length < 6 || target.length < 6) return false;
  return candidate.includes(target) || target.includes(candidate);
}

function ratio(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return num / den;
}

function rowRoster(row) {
  if (Array.isArray(row?.blue_players) || Array.isArray(row?.orange_players)) {
    return [
      ...(Array.isArray(row?.blue_players) ? row.blue_players : []),
      ...(Array.isArray(row?.orange_players) ? row.orange_players : []),
    ];
  }
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

function colorRosters(row) {
  if (Array.isArray(row?.blue_players) || Array.isArray(row?.orange_players)) {
    return {
      blue: Array.isArray(row?.blue_players) ? row.blue_players : [],
      orange: Array.isArray(row?.orange_players) ? row.orange_players : [],
    };
  }
  const rawTeamColor = String(row?.team_color || "").toLowerCase();
  const rawTeamPlayers = teamRoster(row);
  const rawOpponentPlayers = opponentRoster(row);
  return rawTeamColor === "orange"
    ? { blue: rawOpponentPlayers, orange: rawTeamPlayers }
    : { blue: rawTeamPlayers, orange: rawOpponentPlayers };
}

function colorScores(row) {
  const explicitBlue = toFinite(row?.blue_score);
  const explicitOrange = toFinite(row?.orange_score);
  if (explicitBlue !== null || explicitOrange !== null) {
    return { blueScore: explicitBlue, orangeScore: explicitOrange };
  }
  const rawTeamColor = String(row?.team_color || "").toLowerCase();
  const teamScore = toFinite(row?.team_score);
  const opponentScore = toFinite(row?.opponent_score);
  return rawTeamColor === "orange"
    ? { blueScore: opponentScore, orangeScore: teamScore }
    : { blueScore: teamScore, orangeScore: opponentScore };
}

export function samePlayer(a, b) {
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
    touches: toFinite(row?.player_touches),
    clears: toFinite(row?.player_clears),
    centers: toFinite(row?.player_centers),
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
    fallback.touches,
    fallback.clears,
    fallback.centers,
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

export function resolvePerspective(row, trackedPlayerId) {
  const selectedPlayer = resolvePlayerForRow(row, trackedPlayerId);
  const { blue, orange } = colorRosters(row);
  const { blueScore, orangeScore } = colorScores(row);
  const rawTeamPlayers = teamRoster(row);
  const rawOpponentPlayers = opponentRoster(row);
  const rawTeamColor = String(row?.team_color || "").toLowerCase();
  let teamColor = rawTeamColor === "orange" ? "orange" : "blue";
  let isSwapped = false;
  if (selectedPlayer) {
    const onBlue = blue.some((player) => samePlayer(player, selectedPlayer));
    const onOrange = orange.some((player) => samePlayer(player, selectedPlayer));
    if (onBlue || onOrange) {
      teamColor = onOrange ? "orange" : "blue";
      isSwapped = teamColor !== (rawTeamColor === "orange" ? "orange" : "blue");
    } else {
      const onTeam = rawTeamPlayers.some((player) => samePlayer(player, selectedPlayer));
      const onOpponent = rawOpponentPlayers.some((player) => samePlayer(player, selectedPlayer));
      isSwapped = onOpponent && !onTeam;
      teamColor = isSwapped
        ? (rawTeamColor === "orange" ? "blue" : "orange")
        : (rawTeamColor === "orange" ? "orange" : "blue");
    }
  }
  const teamPlayers = teamColor === "orange" ? orange : blue;
  const opponentPlayers = teamColor === "orange" ? blue : orange;
  const teamScore = teamColor === "orange" ? orangeScore : blueScore;
  const opponentScore = teamColor === "orange" ? blueScore : orangeScore;
  const wonFromScore =
    Number.isFinite(teamScore) && Number.isFinite(opponentScore)
      ? teamScore > opponentScore
      : null;
  const won = wonFromScore ?? (isSwapped ? !Boolean(row?.won) : Boolean(row?.won));
  return {
    selectedPlayer,
    teamPlayers,
    opponentPlayers,
    teamScore,
    opponentScore,
    teamColor,
    won,
    isSwapped,
  };
}

export function didPlayerWin(row, trackedPlayerId) {
  const tracked = normalizeIdentity(trackedPlayerId);
  if (tracked) {
    const trackedPlayer =
      findTrackedPlayerInRow(row, trackedPlayerId) ||
      (rowSelectedPlayerMatchesTracked(row, trackedPlayerId) ? fallbackSelectedPlayerFromRow(row) : null);
    if (trackedPlayer) {
      const { blue, orange } = colorRosters(row);
      const onBlue = blue.some((player) => samePlayer(player, trackedPlayer));
      const onOrange = orange.some((player) => samePlayer(player, trackedPlayer));
      const { blueScore, orangeScore } = colorScores(row);
      if ((onBlue || onOrange) && Number.isFinite(blueScore) && Number.isFinite(orangeScore) && blueScore !== orangeScore) {
        return onBlue ? blueScore > orangeScore : orangeScore > blueScore;
      }
    }
  }
  return resolvePerspective(row, trackedPlayerId)?.won ?? Boolean(row?.won);
}

function teamTotalMetric(row, metricKey, trackedPlayerId) {
  const perspective = resolvePerspective(row, trackedPlayerId);
  if (metricKey === "boost_total") {
    const big = teamTotalMetric(row, "big_boosts", trackedPlayerId);
    const small = teamTotalMetric(row, "small_boosts", trackedPlayerId);
    if (big === null && small === null) return null;
    return Number(big ?? 0) + Number(small ?? 0);
  }
  const fromRoster = sumMetric(perspective?.teamPlayers, metricKey);
  if (fromRoster !== null) return fromRoster;
  const fallbackMap = {
    score: perspective?.teamScore ?? row?.score,
    goals: row?.goals,
    assists: row?.assists,
    saves: row?.saves,
    shots: row?.shots,
    touches: row?.touches,
    clears: row?.clears,
    centers: row?.centers,
    demos: row?.demos,
    big_boosts: row?.team_big_boosts ?? row?.big_boosts,
    small_boosts: row?.team_small_boosts ?? row?.small_boosts,
  };
  return toFinite(fallbackMap[metricKey]);
}

function opponentTotalMetric(row, metricKey, trackedPlayerId) {
  const perspective = resolvePerspective(row, trackedPlayerId);
  if (metricKey === "boost_total") {
    const big = opponentTotalMetric(row, "big_boosts", trackedPlayerId);
    const small = opponentTotalMetric(row, "small_boosts", trackedPlayerId);
    if (big === null && small === null) return null;
    return Number(big ?? 0) + Number(small ?? 0);
  }
  const fromRoster = sumMetric(perspective?.opponentPlayers, metricKey);
  if (fromRoster !== null) return fromRoster;
  if (metricKey === "score") return perspective?.opponentScore ?? toFinite(row?.opponent_score);
  const teamTotal = teamTotalMetric(row, metricKey, trackedPlayerId);
  if (teamTotal === null) return null;
  const diffVsOpp = toFinite(row?.[`${metricKey}_diff_vs_opponents`]);
  if (diffVsOpp !== null) return perspective?.isSwapped ? teamTotal + diffVsOpp : teamTotal - diffVsOpp;
  const diffVsOthers = toFinite(row?.[`${metricKey}_diff_vs_others`]);
  if (diffVsOthers !== null) return perspective?.isSwapped ? teamTotal + diffVsOthers : teamTotal - diffVsOthers;
  return null;
}

function othersTotalMetric(row, metricKey, selectedPlayer, trackedPlayerId) {
  const perspective = resolvePerspective(row, trackedPlayerId);
  const roster = [...(perspective?.teamPlayers || []), ...(perspective?.opponentPlayers || [])].filter((player) => !samePlayer(player, selectedPlayer));
  const fromRoster = sumMetric(roster, metricKey);
  if (fromRoster !== null) return fromRoster;
  return opponentTotalMetric(row, metricKey, trackedPlayerId);
}

function lobbyAverageMetric(row, metricKey, trackedPlayerId) {
  const perspective = resolvePerspective(row, trackedPlayerId);
  const roster = [...(perspective?.teamPlayers || []), ...(perspective?.opponentPlayers || [])];
  if (roster.length > 0) {
    const total = sumMetric(roster, metricKey);
    if (total !== null) return total / roster.length;
  }
  return null;
}

function teammateAverageMetric(row, metricKey, selectedPlayer, trackedPlayerId) {
  const perspective = resolvePerspective(row, trackedPlayerId);
  const mates = (perspective?.teamPlayers || []).filter((player) => !samePlayer(player, selectedPlayer));
  if (mates.length > 0) {
    const total = sumMetric(mates, metricKey);
    if (total !== null) return total / mates.length;
  }
  if (metricKey === "score") return toFinite(row?.teammate_avg_score);
  return null;
}

function computeDerivedPlayerMetric(row, selectedPlayer, metricKey, trackedPlayerId) {
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
    const mateAvgScore = teammateAverageMetric(row, "score", selectedPlayer, trackedPlayerId);
    if (score === null || mateAvgScore === null) return null;
    return score - mateAvgScore;
  }
  if (metricKey === "score_vs_lobby_avg") {
    const score = metricFromPlayer(selectedPlayer, "score");
    const lobbyAvgScore = lobbyAverageMetric(row, "score", trackedPlayerId);
    if (score === null || lobbyAvgScore === null) return null;
    return score - lobbyAvgScore;
  }
  if (metricKey.endsWith("_share_team")) {
    const baseMetric = metricKey.replace("_share_team", "");
    const playerValue = metricFromPlayer(selectedPlayer, baseMetric);
    const teamValue = teamTotalMetric(row, baseMetric, trackedPlayerId);
    if (playerValue === null || teamValue === null) return null;
    return ratio(playerValue, teamValue);
  }
  if (metricKey.endsWith("_diff_vs_opponents")) {
    const baseMetric = metricKey.replace("_diff_vs_opponents", "");
    const playerValue = metricFromPlayer(selectedPlayer, baseMetric);
    const opponentsValue = opponentTotalMetric(row, baseMetric, trackedPlayerId);
    if (playerValue === null || opponentsValue === null) return null;
    return playerValue - opponentsValue;
  }
  if (metricKey.endsWith("_diff_vs_others")) {
    const baseMetric = metricKey.replace("_diff_vs_others", "");
    const playerValue = metricFromPlayer(selectedPlayer, baseMetric);
    const othersValue = othersTotalMetric(row, baseMetric, selectedPlayer, trackedPlayerId);
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
  const derived = computeDerivedPlayerMetric(row, selectedPlayer, metricKey, trackedPlayerId);
  if (derived !== null) return derived;
  const direct = metricFromPlayer(selectedPlayer, metricKey);
  if (direct !== null) return direct;
  return toFinite(row?.[`player_${metricKey}`]);
}
