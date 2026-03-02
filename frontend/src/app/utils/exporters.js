export function saveCsv(rows) {
  if (!rows.length) return;
  const seen = new Set();
  const headers = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  const toCell = (value) => {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };
  const esc = (v) => `"${toCell(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(",")].concat(rows.map((r) => headers.map((h) => esc(r?.[h])).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rl-dashboard-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function resolveTheme(themeOverride) {
  const t = String(themeOverride || "").trim().toLowerCase();
  if (t === "light" || t === "dark") return t;
  const dom = String(document?.documentElement?.getAttribute("data-theme") || "").trim().toLowerCase();
  if (dom === "light" || dom === "dark") return dom;
  if (window?.matchMedia?.("(prefers-color-scheme: light)")?.matches) return "light";
  return "dark";
}

export function exportPdf({ theme = "" } = {}) {
  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) return;
  const activeTheme = resolveTheme(theme);
  const themeAttr = activeTheme ? ` data-theme="${activeTheme}"` : "";
  const content = document.querySelector(".page")?.outerHTML || document.body.innerHTML;
  const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((el) => el.outerHTML)
    .join("\n");
  w.document.write(`<!doctype html><html${themeAttr}><head><title>RL Dashboard Export</title>
    ${styleTags}
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      body { margin: 0 !important; }
      .hero-actions, .analysis-run-row button, .mini-btn, button, .ghost { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .floating-analysis, .floating-global { position: static !important; width: auto !important; max-height: none !important; box-shadow: none !important; }
      .shell.with-side-panels { padding: 0 !important; }
      .top-zone, .chart-grid { grid-template-columns: 1fr !important; }
      :root { color-scheme: ${activeTheme}; }
    </style>
  </head><body${themeAttr}>${content}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
    w.close();
  }, 350);
}
