import { format } from "date-fns";

export function num(v, d = 2) {
  return Number(v || 0).toFixed(d);
}

export function signed(v, d = 2) {
  const n = Number(v || 0);
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
}

export function pct(v) {
  return `${(Number(v || 0) * 100).toFixed(2)}%`;
}

export function pctInt(part, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (Number(part || 0) / Number(total || 1)) * 100));
}

export function toInputDate(value) {
  return format(value, "yyyy-MM-dd");
}

export function inferPlatformLabel(row) {
  const direct = String(row?.platform_kind || row?.platform || "").trim();
  const pid = String(row?.player_id || "").toLowerCase();
  const text = direct.toLowerCase();
  if (text.includes("steam") || pid.startsWith("steam:")) return "Steam";
  if (text.includes("epic") || pid.startsWith("epic:")) return "Epic";
  if (text.includes("xbox") || text.includes("xbl") || pid.startsWith("xbl:") || pid.startsWith("xbox:")) return "Xbox";
  if (text.includes("psn") || text.includes("playstation") || pid.startsWith("psn:")) return "PSN";
  if (text.includes("switch") || text.includes("nintendo") || pid.startsWith("switch:")) return "Switch";
  if (direct) return direct;
  return "";
}

export function toAnchorId(value, prefix = "item") {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${text || "unknown"}`;
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
