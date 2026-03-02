function resolvePlatformCode(platform, explicitCode, isBot) {
  const direct = String(explicitCode || "").trim().toUpperCase();
  if (direct) return direct;
  if (isBot) return "B";
  const value = String(platform || "").toLowerCase();
  if (value.includes("steam")) return "S";
  if (value.includes("epic")) return "E";
  if (value.includes("xbox")) return "X";
  if (value.includes("ps4") || value.includes("ps5") || value.includes("playstation")) return "P";
  if (value.includes("switch") || value.includes("nintendo")) return "N";
  return "?";
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
        return {
          name,
          score: Number(player?.score),
          platform: String(player?.platform || ""),
          code: resolvePlatformCode(player?.platform, player?.platform_code, isBot),
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
  const raw = String(player?.platform || "").trim();
  if (!raw) return "Unknown platform";
  return raw.replace(/^onlineplatform_/i, "").replace(/_/g, " ");
}
