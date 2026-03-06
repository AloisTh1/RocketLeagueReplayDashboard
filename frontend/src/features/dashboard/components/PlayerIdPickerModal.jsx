import { User } from "lucide-react";
import { normalizeIdentity } from "../playerTracking";

function displayId(player) {
  return String(player?.preferredId || player?.playerId || player?.onlineId || "").trim();
}

export function PlayerIdPickerModal({ open, onClose, players, currentPlayerId, onPick }) {
  if (!open) return null;

  return (
    <div
      className="stats-info-overlay player-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Pick your player id"
      onClick={onClose}
    >
      <section className="stats-info-modal panel player-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">
          <User size={18} /> Pick Your Player ID
          <span className="metric-scope-pill player">Player</span>
        </div>
        <p className="status">
          Parsing finished. Pick your player once and the player-based stats, trends, mates, and enemies will use that identity.
        </p>
        <div className="player-picker-list">
          {players.map((player) => {
            const active = normalizeIdentity(currentPlayerId) === normalizeIdentity(displayId(player));
            return (
              <button
                key={`${player.name}-${displayId(player)}`}
                type="button"
                className={`player-picker-item ${active ? "active" : ""}`}
                onClick={() => {
                  onPick(displayId(player));
                  onClose();
                }}
              >
                <div className="player-picker-main">
                  <strong>{player.name}</strong>
                  <span className="platform-pill" title={player.platformLabel || "Unknown platform"}>
                    {player.platformCode || "?"}
                  </span>
                </div>
                <div className="player-picker-id">{displayId(player)}</div>
                <div className="player-picker-meta">
                  Seen in {player.games} replay{player.games > 1 ? "s" : ""}
                </div>
              </button>
            );
          })}
        </div>
        <div className="stats-info-actions">
          <button type="button" className="mini-btn ghost" onClick={onClose}>Later</button>
        </div>
      </section>
    </div>
  );
}
