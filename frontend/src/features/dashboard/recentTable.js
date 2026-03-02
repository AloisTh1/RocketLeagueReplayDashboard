import { extractPlayerNames } from "./players";

export function filterRecentRows(rows, tableSearch, tableResultFilter) {
  const q = String(tableSearch || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (tableResultFilter === "win" && !r?.won) return false;
    if (tableResultFilter === "loss" && r?.won) return false;
    if (!q) return true;
    const haystack = [
      r?.id,
      r?.replay_name,
      r?.map_name,
      r?.match_type,
      r?.game_mode,
      ...extractPlayerNames(r?.team_players, r?.team_player_names),
      ...extractPlayerNames(r?.opponent_players, r?.opponent_player_names),
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
      return row?.won ? 1 : 0;
    case "scoreline":
      return Number(row?.team_score || 0) - Number(row?.opponent_score || 0);
    case "duration":
      return Number(row?.duration_seconds || 0);
    case "team_players":
      return String(extractPlayerNames(row?.team_players, row?.team_player_names).join(",")).toLowerCase();
    case "opponents":
      return String(extractPlayerNames(row?.opponent_players, row?.opponent_player_names).join(",")).toLowerCase();
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
