export function buildQuickLinks(analyticsView) {
  const show = (...groups) => analyticsView === "all" || groups.includes(analyticsView);
  const links = [];
  if (show("overview")) {
    links.push(
      { href: "#stats-categories", label: "Categories" },
      { href: "#win-trend", label: "Trend" },
      { href: "#time-aggregate", label: "Aggregate" },
      { href: "#score-momentum", label: "Momentum" },
      { href: "#score-diff", label: "Score Diff" },
    );
  }
  if (show("other")) {
    links.push(
      { href: "#impactful-stats", label: "Impact" },
      { href: "#grouped-match-type", label: "By Type" },
    );
  }
  if (show("boost")) {
    links.push({ href: "#boost-metrics", label: "Boost" });
  }
  if (show("distribution")) {
    links.push({ href: "#mode-distribution", label: "Modes" });
  }
  if (show("synergy")) {
    links.push(
      { href: "#mates-synergy", label: "Synergy" },
      { href: "#best-mates", label: "Best Mates" },
    );
  }
  links.push({ href: "#recent-matches", label: "Recent" }, { href: "#misc-stats", label: "misc" });
  return links;
}
