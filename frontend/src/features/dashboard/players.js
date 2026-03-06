function resolvePlatformMeta(platform, platformKind, platformLabel, explicitCode, isBot) {
  const direct = String(explicitCode || "").trim().toUpperCase();
  const label = String(platformLabel || "").trim();
  if (isBot) return { code: "B", label: "Bot" };
  if (direct && label) return { code: direct, label };
  const value = `${String(platform || "")} ${String(platformKind || "")}`.toLowerCase();
  if (direct === "S" || value.includes("steam")) return { code: "S", label: "Steam" };
  if (direct === "E" || value.includes("epic")) return { code: "E", label: "Epic" };
  if (direct === "X" || value.includes("xbox") || value.includes("xbl") || value.includes("microsoft")) return { code: "X", label: "Xbox" };
  if (direct === "P" || value.includes("ps4") || value.includes("ps5") || value.includes("psn") || value.includes("playstation") || value.includes("sony")) {
    return { code: "P", label: "PlayStation" };
  }
  if (direct === "N" || value.includes("switch") || value.includes("nintendo")) return { code: "N", label: "Nintendo Switch" };
  if (direct) return { code: direct, label: label || "Unknown platform" };
  return { code: "?", label: label || "Unknown platform" };
}

export function extractPlayerNames(detailPlayers, fallbackNames) {
  if (Array.isArray(detailPlayers) && detailPlayers.length) {
    const names = detailPlayers
      .map((p) => String(p?.name || "").trim())
      .filter(Boolean);
    if (names.length) return names;
  }
  if (!Array.isArray(fallbackNames)) return [];
  return fallbackNames
    .map((name) => String(name || "").trim())
    .filter(Boolean);
}

export function normalizePlayerRoster(detailPlayers, fallbackNames) {
  if (Array.isArray(detailPlayers) && detailPlayers.length) {
    const mapped = detailPlayers
      .map((player) => {
        const name = String(player?.name || "").trim();
        if (!name) return null;
        const isBot = Boolean(player?.is_bot);
        const platformMeta = resolvePlatformMeta(
          player?.platform,
          player?.platform_kind,
          player?.platform_label,
          player?.platform_code,
          isBot,
        );
        return {
          name,
          score: Number(player?.score),
          platform: String(player?.platform || ""),
          platformKind: String(player?.platform_kind || ""),
          platformLabel: platformMeta.label,
          code: platformMeta.code,
        };
      })
      .filter(Boolean);
    if (mapped.length) return mapped;
  }
  return extractPlayerNames([], fallbackNames).map((name) => ({ name, platform: "", code: "?" }));
}

export function platformTitle(player) {
  const code = String(player?.code || "").toUpperCase();
  if (code === "B") return "Bot";
  const label = String(player?.platformLabel || "").trim();
  if (label) return label;
  const raw = `${String(player?.platformKind || "").trim()} ${String(player?.platform || "").trim()}`.trim();
  if (!raw) return "Unknown platform";
  return raw.replace(/^onlineplatform_/i, "").replace(/_/g, " ");
}
