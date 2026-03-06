import { didPlayerWin } from "./playerTracking";
import { extractPlayerNames } from "./players";

function fixedBlueOrangeRosters(row) {
  const rawTeamColor = String(row?.team_color || "").toLowerCase();
  return {
    blue: extractPlayerNames(
      row?.blue_players || (rawTeamColor === "orange" ? row?.opponent_players : row?.team_players),
      row?.blue_player_names || (rawTeamColor === "orange" ? row?.opponent_player_names : row?.team_player_names),
    ),
    orange: extractPlayerNames(
      row?.orange_players || (rawTeamColor === "orange" ? row?.team_players : row?.opponent_players),
      row?.orange_player_names || (rawTeamColor === "orange" ? row?.team_player_names : row?.opponent_player_names),
    ),
  };
}

function fixedColorResult(row) {
  const rawTeamColor = String(row?.team_color || "").toLowerCase();
  const teamScore = Number(row?.team_score || 0);
  const opponentScore = Number(row?.opponent_score || 0);
  const blueScore = Number.isFinite(Number(row?.blue_score)) ? Number(row.blue_score) : (rawTeamColor === "orange" ? opponentScore : teamScore);
  const orangeScore = Number.isFinite(Number(row?.orange_score)) ? Number(row.orange_score) : (rawTeamColor === "orange" ? teamScore : opponentScore);
  if (blueScore === orangeScore) return 0;
  return blueScore > orangeScore ? 1 : -1;
}

export function filterRecentRows(rows, tableSearch, tableResultFilter, trackedPlayerId = "") {
  const q = String(tableSearch || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    const playerWon = didPlayerWin(r, trackedPlayerId);
    if (tableResultFilter === "win" && !playerWon) return false;
    if (tableResultFilter === "loss" && playerWon) return false;
    if (!q) return true;
    const rosters = fixedBlueOrangeRosters(r);
    const haystack = [
      r?.id,
      r?.replay_name,
      r?.map_name,
      r?.match_type,
      r?.game_mode,
      ...rosters.blue,
      ...rosters.orange,
    ]
      .map((v) => String(v || "").toLowerCase())
      .join(" | ");
    return haystack.includes(q);
  });
}

export function getRecentSortValue(row, colId) {
  switch (colId) {
    case "date":
      return String(row?.date || "");
    case "map":
      return String(row?.map_name || "").toLowerCase();
    case "type":
      return String(row?.match_type || "").toLowerCase();
    case "mode":
      return String(row?.game_mode || "").toLowerCase();
    case "result":
      return fixedColorResult(row);
    case "scoreline":
      return Number(row?.team_score || 0) - Number(row?.opponent_score || 0);
    case "duration":
      return Number(row?.duration_seconds || 0);
    case "team_players":
      return String(fixedBlueOrangeRosters(row).blue.join(",")).toLowerCase();
    case "opponents":
      return String(fixedBlueOrangeRosters(row).orange.join(",")).toLowerCase();
    case "replay":
      return String(row?.id || "").toLowerCase();
    default:
      return "";
  }
}

export function sortRecentRows(rows, recentSort) {
  const out = [...(rows || [])];
  const factor = recentSort?.dir === "asc" ? 1 : -1;
  const col = recentSort?.col || "date";
  out.sort((a, b) => {
    const av = getRecentSortValue(a, col);
    const bv = getRecentSortValue(b, col);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
  return out;
}

export function paginateRecentRows(rows, tablePage, pageSize) {
  const safeSize = Math.max(1, Number(pageSize) || 5);
  const totalPages = Math.max(1, Math.ceil((rows || []).length / safeSize));
  const page = Math.min(Math.max(1, Number(tablePage) || 1), totalPages);
  const start = (page - 1) * safeSize;
  return {
    pageSize: safeSize,
    totalPages,
    page,
    start,
    rows: (rows || []).slice(start, start + safeSize),
  };
}
