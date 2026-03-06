import { format, parseISO } from "date-fns";
import { Activity } from "lucide-react";
import { num } from "../../../app/utils/formatters";
import { RECENT_COLUMN_DEFS } from "../constants";
import { normalizePlayerRoster, platformTitle } from "../players";
import { Tip } from "./Tip";

export function RecentMatchesSection({
  selectedReplayIds,
  setSelectedReplayIds,
  setFocusedReplayId,
  setStatsView,
  tableSearch,
  setTableSearch,
  tableResultFilter,
  setTableResultFilter,
  visibleRecentColumns,
  setVisibleRecentColumns,
  recentSort,
  setRecentSort,
  visibleRecentTableRows,
  trackedPlayerId,
  isTrackedRow,
  handleRecentRowClick,
  maxTableRows,
  setMaxTableRows,
  clampInt,
  sortedRecentTableRows,
  tablePageSafe,
  tableTotalPages,
  setTablePage,
  PLATFORM_LEGEND,
}) {
  function renderRecentCell(r, colId) {
    const duration = Number(r.duration_seconds || 0);
    const mm = Math.floor(duration / 60);
    const ss = duration % 60;
    const allPlayers = [
      ...normalizePlayerRoster(r.blue_players || r.team_players, r.blue_player_names || r.team_player_names),
      ...normalizePlayerRoster(r.orange_players || r.opponent_players, r.orange_player_names || r.opponent_player_names),
    ];
    const mvpScore = allPlayers.reduce((best, player) => {
      const points = Number(player?.score);
      return Number.isFinite(points) ? Math.max(best, points) : best;
    }, Number.NEGATIVE_INFINITY);
    const renderPlayers = (detailPlayers, fallbackNames, sideColor) => {
      const roster = normalizePlayerRoster(detailPlayers, fallbackNames);
      if (!roster.length) return "-";
      const nodes = [];
      roster.forEach((player, idx) => {
        const points = Number(player?.score);
        const hasPoints = Number.isFinite(points);
        const isMvp = hasPoints && points === mvpScore;
        nodes.push(
          <span key={`${player.name}-${idx}`} className="player-cell">
            <span className={`player-name player-name-${sideColor}`}>
              {hasPoints ? `${player.name} (${num(points, 0)})` : player.name}
              {isMvp ? <span className="mvp-star" title="MVP: highest score in this replay"> ★</span> : null}
            </span>
            <span className="platform-pill" title={platformTitle(player)}>
              {player.code}
            </span>
          </span>,
        );
        if (idx < roster.length - 1) {
          nodes.push(<span key={`sep-${idx}`}>, </span>);
        }
      });
      return <span>{nodes}</span>;
    };
    const rawTeamColor = String(r?.team_color || "").toLowerCase();
    const teamScore = Number(r?.team_score || 0);
    const opponentScore = Number(r?.opponent_score || 0);
    const blueScore = Number.isFinite(Number(r?.blue_score)) ? Number(r.blue_score) : (rawTeamColor === "orange" ? opponentScore : teamScore);
    const orangeScore = Number.isFinite(Number(r?.orange_score)) ? Number(r.orange_score) : (rawTeamColor === "orange" ? teamScore : opponentScore);
    const colorWinner = blueScore === orangeScore ? "Tie" : (blueScore > orangeScore ? "Blue Win" : "Orange Win");
    const bluePlayers = renderPlayers(r.blue_players || (rawTeamColor === "orange" ? r.opponent_players : r.team_players), r.blue_player_names || (rawTeamColor === "orange" ? r.opponent_player_names : r.team_player_names), "blue");
    const orangePlayers = renderPlayers(r.orange_players || (rawTeamColor === "orange" ? r.team_players : r.opponent_players), r.orange_player_names || (rawTeamColor === "orange" ? r.team_player_names : r.opponent_player_names), "orange");
    switch (colId) {
      case "date":
        return format(parseISO(r.date), "yyyy-MM-dd HH:mm");
      case "map":
        return r.map_name || "-";
      case "type":
        return r.match_type || "-";
      case "mode":
        return r.game_mode || "-";
      case "result":
        return (
          <span className={`pill ${colorWinner === "Blue Win" ? "team-blue" : colorWinner === "Orange Win" ? "team-orange" : ""}`}>
            {colorWinner}
          </span>
        );
      case "scoreline":
        return `Blue ${num(blueScore, 0)} - Orange ${num(orangeScore, 0)}`;
      case "duration":
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      case "team_players":
        return bluePlayers;
      case "opponents":
        return orangePlayers;
      case "replay":
        return <span className="mono">{r.id}</span>;
      default:
        return "-";
    }
  }

  return (
    <section id="recent-matches" className="panel">
      <div className="panel-title"><Activity size={18} /> Recent Matches <Tip text="Replay table used for search, sorting, and selecting matches for single-match analysis." /></div>
      <div className="quick-row">
        <button
          type="button"
          className="mini-btn ghost"
          title="Clear selected rows and return to aggregate stats view."
          onClick={() => {
            setSelectedReplayIds([]);
            setFocusedReplayId("");
            setStatsView("aggregate");
          }}
          disabled={!selectedReplayIds.length}
        >
          Clear selection
        </button>
        <span>Selected for analysis: {selectedReplayIds.length ? selectedReplayIds.length : "All"}</span>
        <span>1 selected row = single match analysis. Multiple selected rows = aggregate analysis.</span>
      </div>
      <div className="recent-table-filters">
        <label className="recent-search">
          <span>Search matches</span>
          <input
            placeholder="Replay id, map, players..."
            value={tableSearch}
            title="Filter rows by replay id, map, mode, and player names."
            onChange={(e) => setTableSearch(e.target.value)}
          />
        </label>
        <select value={tableResultFilter} title="Filter table rows by result outcome." onChange={(e) => setTableResultFilter(e.target.value)}>
          <option value="all">All results</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
        </select>
        <button
          type="button"
          className="mini-btn ghost"
          title="Reset search text and result filter."
          onClick={() => {
            setTableSearch("");
            setTableResultFilter("all");
          }}
        >
          Reset table filters
        </button>
      </div>
      <div className="platform-legend" aria-label="Platform legend">
        {PLATFORM_LEGEND.map((entry) => (
          <span key={`legend-${entry.code}`} className="platform-legend-item">
            <span className="platform-pill" title={entry.label}>{entry.code}</span>
            <span>{entry.label}</span>
          </span>
        ))}
      </div>
      <details className="failure-details" style={{ marginTop: 8 }}>
        <summary>Choose columns</summary>
        <div className="impact-chips">
          {RECENT_COLUMN_DEFS.map((col) => {
            const checked = visibleRecentColumns.includes(col.id);
            return (
              <label key={col.id} className="impact-chip">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setVisibleRecentColumns((prev) => {
                        if (checked) {
                          const next = prev.filter((id) => id !== col.id);
                          return next.length ? next : prev;
                        }
                        return [...prev, col.id];
                      })
                    }
                  />
                  <span>{col.label}</span>
                </div>
              </label>
            );
          })}
        </div>
      </details>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {RECENT_COLUMN_DEFS.filter((c) => visibleRecentColumns.includes(c.id)).map((c) => (
                <th key={`h-${c.id}`}>
                  <button
                    type="button"
                    className={`table-sort-btn ${recentSort.col === c.id ? "active" : ""}`}
                    aria-label={`Sort by ${c.label} (${recentSort.col === c.id && recentSort.dir === "asc" ? "descending" : "ascending"})`}
                    onClick={() =>
                      setRecentSort((prev) => {
                        if (prev.col === c.id) {
                          return { col: c.id, dir: prev.dir === "asc" ? "desc" : "asc" };
                        }
                        return { col: c.id, dir: c.id === "date" ? "desc" : "asc" };
                      })
                    }
                  >
                    <span className="table-sort-label">{c.label}</span>
                    <span className={`table-sort-arrow ${recentSort.col === c.id ? "active" : ""}`}>
                      {recentSort.col === c.id ? (recentSort.dir === "asc" ? "^" : "v") : "<>"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRecentTableRows.map((r) => {
              const selected = selectedReplayIds.includes(r.id);
              const rowTracked = isTrackedRow(r, trackedPlayerId);
              return (
                <tr
                  key={r.id}
                  className={`${rowTracked ? "row-highlight " : ""}${selected ? "row-selected" : ""}`}
                  onClick={() => handleRecentRowClick(r.id)}
                >
                  {RECENT_COLUMN_DEFS.filter((c) => visibleRecentColumns.includes(c.id)).map((c) => (
                    <td key={`${r.id}-${c.id}`}>{renderRecentCell(r, c.id)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="recent-table-footer">
        <span>Rows shown: {visibleRecentTableRows.length}/{sortedRecentTableRows.length}</span>
        <label className="recent-table-max-rows">
          <span>Max table rows</span>
          <input
            type="number"
            min="1"
            max="5000"
            value={maxTableRows}
            title="Maximum number of rows rendered in the table."
            onChange={(e) => setMaxTableRows(clampInt(e.target.value, 1, 5000, 5))}
          />
        </label>
        <div className="recent-pagination">
          <button
            type="button"
            className="mini-btn ghost"
            disabled={tablePageSafe <= 1}
            onClick={() => setTablePage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span>Page {tablePageSafe}/{tableTotalPages}</span>
          <button
            type="button"
            className="mini-btn ghost"
            disabled={tablePageSafe >= tableTotalPages}
            onClick={() => setTablePage((p) => Math.min(tableTotalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

