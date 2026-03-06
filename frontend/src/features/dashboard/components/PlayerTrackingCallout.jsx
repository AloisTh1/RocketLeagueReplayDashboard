import { useMemo } from "react";
import { findTrackedPlayerInRow, isTrackedRow } from "../playerTracking";

export function PlayerTrackingCallout({ activeRecent, trackedPlayerId, playerIdValue }) {
  const trackedRowsCount = useMemo(() => {
    if (!activeRecent?.length) return 0;
    if (!trackedPlayerId) return activeRecent.length;
    return activeRecent.filter((row) => isTrackedRow(row, trackedPlayerId)).length;
  }, [activeRecent, trackedPlayerId]);

  const trackedPlayerName = useMemo(() => {
    if (!trackedPlayerId || !activeRecent?.length) return "";
    const counts = new Map();
    for (const row of activeRecent) {
      if (!isTrackedRow(row, trackedPlayerId)) continue;
      const matched = findTrackedPlayerInRow(row, trackedPlayerId);
      const name = String(matched?.name || row?.player_name || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    let bestName = "";
    let bestCount = 0;
    for (const [name, count] of counts.entries()) {
      if (count > bestCount) {
        bestName = name;
        bestCount = count;
      }
    }
    return bestName;
  }, [activeRecent, trackedPlayerId]);

  if (!trackedPlayerId) return null;
  const hasMatches = trackedRowsCount > 0;

  return (
    <div className="player-tracking-callout" role="status" aria-live="polite">
      <div className="player-tracking-eyebrow">Tracked Player</div>
      <div className="player-tracking-name">{trackedPlayerName || "Player ID not found"}</div>
      <div className="player-tracking-meta">ID {playerIdValue || "-"}</div>
      <div className="player-tracking-match-count">
        {hasMatches
          ? `${trackedRowsCount}/${activeRecent.length || 0} replay rows matched`
          : `0/${activeRecent.length || 0} replay rows matched`}
      </div>
    </div>
  );
}
