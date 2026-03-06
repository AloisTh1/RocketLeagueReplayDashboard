import { format, getISOWeek, parseISO, startOfWeek } from "date-fns";
import { didPlayerWin, resolvePerspective } from "./playerTracking.js";

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketKeyFor(dateValue, timeTab) {
  const dt = parseISO(dateValue);
  if (timeTab === "timeline_hour") return format(dt, "yyyy-MM-dd HH:00");
  if (timeTab === "hour_of_day") return format(dt, "HH:00");
  if (timeTab === "day_of_week") return format(dt, "EEE");
  if (timeTab === "week_of_year") return `W${String(getISOWeek(dt)).padStart(2, "0")}`;
  if (timeTab === "month_of_year") return format(dt, "MMM");
  if (timeTab === "week") return format(startOfWeek(dt, { weekStartsOn: 1 }), "yyyy-MM-dd");
  if (timeTab === "month") return format(dt, "yyyy-MM");
  return format(dt, "yyyy-MM-dd");
}

function sortBucketRows(rows, timeTab) {
  if (timeTab === "hour_of_day") {
    return rows.sort((a, b) => Number(a.bucket.slice(0, 2)) - Number(b.bucket.slice(0, 2)));
  }
  if (timeTab === "day_of_week") {
    return rows.sort((a, b) => WEEKDAY_ORDER.indexOf(a.bucket) - WEEKDAY_ORDER.indexOf(b.bucket));
  }
  if (timeTab === "week_of_year") {
    return rows.sort((a, b) => Number(a.bucket.slice(1)) - Number(b.bucket.slice(1)));
  }
  if (timeTab === "month_of_year") {
    return rows.sort((a, b) => MONTH_ORDER.indexOf(a.bucket) - MONTH_ORDER.indexOf(b.bucket));
  }
  return rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function buildRegressionSeries(rows, metricKey, regressionKey) {
  const points = [];
  rows.forEach((row, index) => {
    const value = Number(row?.[metricKey]);
    if (!Number.isFinite(value)) return;
    points.push({ index, value });
  });

  if (points.length < 2) {
    return rows.map((row) => ({ ...row, [regressionKey]: null }));
  }

  const count = points.length;
  const sumX = points.reduce((sum, point) => sum + point.index, 0);
  const sumY = points.reduce((sum, point) => sum + point.value, 0);
  const sumXY = points.reduce((sum, point) => sum + point.index * point.value, 0);
  const sumX2 = points.reduce((sum, point) => sum + point.index * point.index, 0);
  const denominator = count * sumX2 - sumX * sumX;
  const slope = denominator ? (count * sumXY - sumX * sumY) / denominator : 0;
  const intercept = count ? (sumY - slope * sumX) / count : 0;

  return rows.map((row, index) => {
    if (!Number.isFinite(Number(row?.[metricKey]))) {
      return { ...row, [regressionKey]: null };
    }
    return {
      ...row,
      [regressionKey]: slope * index + intercept,
    };
  });
}

export function buildPlayerTrend(rows, timeTab, trackedPlayerId, findPlayerMetric) {
  if (timeTab === "hour") {
    return rows
      .map((row) => {
        const dateValue = String(row?.date || "");
        if (!dateValue) return null;
        const playerScore = findPlayerMetric(row, "score", trackedPlayerId);
        const playerGap = findPlayerMetric(row, "score_vs_lobby_avg", trackedPlayerId);
        if (playerScore === null || playerGap === null) return null;
        return {
          bucket: format(parseISO(dateValue), "yyyy-MM-dd HH:mm"),
          games: 1,
          wins: didPlayerWin(row, trackedPlayerId) ? 1 : 0,
          winRate: didPlayerWin(row, trackedPlayerId) ? 1 : 0,
          avgScore: Number(playerScore || 0),
          scoreGap: Number(playerGap || 0),
          dateValue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.dateValue) - new Date(b.dateValue))
      .map(({ dateValue, ...row }) => row);
  }

  const bucketMap = new Map();

  rows.forEach((row) => {
    const dateValue = String(row?.date || "");
    if (!dateValue) return;
    const playerScore = findPlayerMetric(row, "score", trackedPlayerId);
    const playerGap = findPlayerMetric(row, "score_vs_lobby_avg", trackedPlayerId);
    if (playerScore === null || playerGap === null) return;
    const key = bucketKeyFor(dateValue, timeTab);
    const current = bucketMap.get(key) || { bucket: key, games: 0, wins: 0, scoreTotal: 0, gapTotal: 0 };
    current.games += 1;
    current.wins += didPlayerWin(row, trackedPlayerId) ? 1 : 0;
    current.scoreTotal += Number(playerScore || 0);
    current.gapTotal += Number(playerGap || 0);
    bucketMap.set(key, current);
  });

  const toBucketRow = (item) => ({
    bucket: item.bucket,
    games: item.games,
    wins: item.wins,
    winRate: item.games ? item.wins / item.games : null,
    avgScore: item.games ? item.scoreTotal / item.games : null,
    scoreGap: item.games ? item.gapTotal / item.games : null,
  });

  return sortBucketRows(Array.from(bucketMap.values()).map(toBucketRow), timeTab);
}

export function buildPlayerContributionTrend(rows, timeTab, trackedPlayerId, findPlayerMetric) {
  if (timeTab === "hour") {
    return rows
      .map((row) => {
        const dateValue = String(row?.date || "");
        if (!dateValue) return null;
        const goals = findPlayerMetric(row, "goals", trackedPlayerId);
        const assists = findPlayerMetric(row, "assists", trackedPlayerId);
        const saves = findPlayerMetric(row, "saves", trackedPlayerId);
        const shotAccuracy = findPlayerMetric(row, "shot_accuracy", trackedPlayerId);
        if (goals === null && assists === null && saves === null && shotAccuracy === null) return null;
        return {
          bucket: format(parseISO(dateValue), "yyyy-MM-dd HH:mm"),
          goals: Number(goals || 0),
          assists: Number(assists || 0),
          saves: Number(saves || 0),
          shot_accuracy: shotAccuracy === null ? null : Number(shotAccuracy || 0),
          total: Number(goals || 0) + Number(assists || 0) + Number(saves || 0),
          dateValue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.dateValue) - new Date(b.dateValue))
      .map(({ dateValue, ...row }) => row);
  }

  const bucketMap = new Map();

  rows.forEach((row) => {
    const dateValue = String(row?.date || "");
    if (!dateValue) return;
    const goals = findPlayerMetric(row, "goals", trackedPlayerId);
    const assists = findPlayerMetric(row, "assists", trackedPlayerId);
    const saves = findPlayerMetric(row, "saves", trackedPlayerId);
    const shotAccuracy = findPlayerMetric(row, "shot_accuracy", trackedPlayerId);
    if (goals === null && assists === null && saves === null && shotAccuracy === null) return;
    const key = bucketKeyFor(dateValue, timeTab);
    const current = bucketMap.get(key) || { bucket: key, games: 0, goals: 0, assists: 0, saves: 0, shotAccuracyTotal: 0 };
    current.games += 1;
    current.goals += Number(goals || 0);
    current.assists += Number(assists || 0);
    current.saves += Number(saves || 0);
    current.shotAccuracyTotal += Number(shotAccuracy || 0);
    bucketMap.set(key, current);
  });

  return sortBucketRows(Array.from(bucketMap.values()).map((item) => ({
    bucket: item.bucket,
    games: item.games,
    goals: item.games ? item.goals / item.games : 0,
    assists: item.games ? item.assists / item.games : 0,
    saves: item.games ? item.saves / item.games : 0,
    shot_accuracy: item.games ? item.shotAccuracyTotal / item.games : 0,
    total: item.games ? (item.goals + item.assists + item.saves) / item.games : 0,
  })), timeTab);
}

function averageMetric(roster, metricKey) {
  if (!Array.isArray(roster) || !roster.length) return null;
  const values = roster
    .map((player) => Number(player?.[metricKey]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumMetric(roster, metricKey) {
  if (!Array.isArray(roster) || !roster.length) return null;
  const values = roster
    .map((player) => Number(player?.[metricKey]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function teammateRoster(perspective) {
  const selected = perspective?.selectedPlayer;
  const selectedId = String(selected?.player_id || "").trim();
  const selectedOnlineId = String(selected?.online_id || "").trim();
  const selectedName = String(selected?.name || "").trim();
  return (perspective?.teamPlayers || []).filter((player) => {
    if (!player) return false;
    if (selectedId && String(player?.player_id || "").trim() === selectedId) return false;
    if (selectedOnlineId && String(player?.online_id || "").trim() === selectedOnlineId) return false;
    if (selectedName && String(player?.name || "").trim() === selectedName) return false;
    return true;
  });
}

export function buildMateComparisonTrend(rows, timeTab, trackedPlayerId) {
  if (timeTab === "hour") {
    return rows
      .map((row) => {
        const dateValue = String(row?.date || "");
        if (!dateValue) return null;
        const perspective = resolvePerspective(row, trackedPlayerId);
        if (!perspective?.selectedPlayer) return null;
        const mates = teammateRoster(perspective);
        const mateAvgScore = averageMetric(mates, "score");
        const allPlayers = [...(perspective.teamPlayers || []), ...(perspective.opponentPlayers || [])];
        const lobbyAvgScore = averageMetric(allPlayers, "score");
        if (mateAvgScore === null || lobbyAvgScore === null) return null;
        return {
          bucket: format(parseISO(dateValue), "yyyy-MM-dd HH:mm"),
          mateAvgScore,
          mateScoreGap: mateAvgScore - lobbyAvgScore,
          dateValue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.dateValue) - new Date(b.dateValue))
      .map(({ dateValue, ...row }) => row);
  }

  const bucketMap = new Map();
  rows.forEach((row) => {
    const dateValue = String(row?.date || "");
    if (!dateValue) return;
    const perspective = resolvePerspective(row, trackedPlayerId);
    if (!perspective?.selectedPlayer) return;
    const mates = teammateRoster(perspective);
    const mateAvgScore = averageMetric(mates, "score");
    const allPlayers = [...(perspective.teamPlayers || []), ...(perspective.opponentPlayers || [])];
    const lobbyAvgScore = averageMetric(allPlayers, "score");
    if (mateAvgScore === null || lobbyAvgScore === null) return;
    const key = bucketKeyFor(dateValue, timeTab);
    const current = bucketMap.get(key) || { bucket: key, games: 0, mateScoreTotal: 0, mateGapTotal: 0 };
    current.games += 1;
    current.mateScoreTotal += mateAvgScore;
    current.mateGapTotal += mateAvgScore - lobbyAvgScore;
    bucketMap.set(key, current);
  });

  return sortBucketRows(Array.from(bucketMap.values()).map((item) => ({
    bucket: item.bucket,
    mateAvgScore: item.games ? item.mateScoreTotal / item.games : null,
    mateScoreGap: item.games ? item.mateGapTotal / item.games : null,
  })), timeTab);
}

export function buildMateContributionTrend(rows, timeTab, trackedPlayerId) {
  if (timeTab === "hour") {
    return rows
      .map((row) => {
        const dateValue = String(row?.date || "");
        if (!dateValue) return null;
        const perspective = resolvePerspective(row, trackedPlayerId);
        if (!perspective?.selectedPlayer) return null;
        const mates = teammateRoster(perspective);
        const goals = averageMetric(mates, "goals");
        const assists = averageMetric(mates, "assists");
        const saves = averageMetric(mates, "saves");
        if (goals === null && assists === null && saves === null) return null;
        return {
          bucket: format(parseISO(dateValue), "yyyy-MM-dd HH:mm"),
          mateGoals: Number(goals || 0),
          mateAssists: Number(assists || 0),
          mateSaves: Number(saves || 0),
          mateTotal: Number(goals || 0) + Number(assists || 0) + Number(saves || 0),
          dateValue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.dateValue) - new Date(b.dateValue))
      .map(({ dateValue, ...row }) => row);
  }

  const bucketMap = new Map();
  rows.forEach((row) => {
    const dateValue = String(row?.date || "");
    if (!dateValue) return;
    const perspective = resolvePerspective(row, trackedPlayerId);
    if (!perspective?.selectedPlayer) return;
    const mates = teammateRoster(perspective);
    const goals = averageMetric(mates, "goals");
    const assists = averageMetric(mates, "assists");
    const saves = averageMetric(mates, "saves");
    if (goals === null && assists === null && saves === null) return;
    const key = bucketKeyFor(dateValue, timeTab);
    const current = bucketMap.get(key) || { bucket: key, games: 0, goals: 0, assists: 0, saves: 0 };
    current.games += 1;
    current.goals += Number(goals || 0);
    current.assists += Number(assists || 0);
    current.saves += Number(saves || 0);
    bucketMap.set(key, current);
  });

  return sortBucketRows(Array.from(bucketMap.values()).map((item) => ({
    bucket: item.bucket,
    mateGoals: item.games ? item.goals / item.games : 0,
    mateAssists: item.games ? item.assists / item.games : 0,
    mateSaves: item.games ? item.saves / item.games : 0,
    mateTotal: item.games ? (item.goals + item.assists + item.saves) / item.games : 0,
  })), timeTab);
}

function pearsonCorrelation(valuesX, valuesY) {
  const count = Math.min(valuesX.length, valuesY.length);
  if (count < 3) return null;
  const meanX = valuesX.reduce((sum, value) => sum + value, 0) / count;
  const meanY = valuesY.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = valuesX[index] - meanX;
    const dy = valuesY[index] - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  const denominator = Math.sqrt(sumSqX * sumSqY);
  if (!denominator) return null;
  return numerator / denominator;
}

export function buildBucketCorrelations(rows, metricDefs) {
  if (!Array.isArray(rows) || rows.length < 3 || !Array.isArray(metricDefs)) return [];
  const indexedRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row && typeof row === "object");
  return metricDefs
    .map((metric) => {
      const pairs = indexedRows
        .map(({ row, index }) => {
          const value = Number(row?.[metric.key]);
          return Number.isFinite(value) ? { x: index, y: value } : null;
        })
        .filter(Boolean);
      if (pairs.length < 3) return null;
      const correlation = pearsonCorrelation(
        pairs.map((pair) => pair.x),
        pairs.map((pair) => pair.y),
      );
      if (correlation === null) return null;
      return {
        key: metric.key,
        label: metric.label,
        correlation,
        absCorrelation: Math.abs(correlation),
        sampleSize: pairs.length,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.absCorrelation - left.absCorrelation);
}
