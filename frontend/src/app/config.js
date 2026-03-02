export const SETTINGS_KEY = "rl_dashboard_settings_v1";
export const THEME_KEY = "rl_dashboard_theme_v1";

export const defaults = {
  demosDir: "",
  cacheDir: "",
  rawDir: "",
  playerId: "",
  parseCount: 40,
  workers: 4,
  writeCache: true,
  startDate: "",
  endDate: "",
  boxcarsExe: "",
};

export function initialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
