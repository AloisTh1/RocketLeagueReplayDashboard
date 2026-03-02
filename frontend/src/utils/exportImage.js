function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeTheme(value) {
  const t = String(value || "").trim().toLowerCase();
  return t === "light" || t === "dark" ? t : "";
}

function resolveTheme(themeOverride) {
  const explicit = normalizeTheme(themeOverride);
  if (explicit) return explicit;
  const domTheme = normalizeTheme(document?.documentElement?.getAttribute("data-theme"));
  if (domTheme) return domTheme;
  if (window?.matchMedia?.("(prefers-color-scheme: light)")?.matches) return "light";
  return "dark";
}

function collectCssText() {
  const chunks = [];
  for (const sheet of Array.from(document.styleSheets || [])) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      if (!rules.length) continue;
      chunks.push(rules.map((r) => r.cssText).join("\n"));
    } catch {
      // Cross-origin stylesheets can be unreadable; ignore and continue.
    }
  }
  return chunks.join("\n");
}

function makeSvgDataUrl(node, width, height, themeOverride) {
  const activeTheme = resolveTheme(themeOverride);
  const cloned = node.cloneNode(true);
  if (activeTheme && cloned?.setAttribute) cloned.setAttribute("data-theme", activeTheme);
  const serialized = new XMLSerializer().serializeToString(cloned);
  const cssText = collectCssText();
  const themeAttr = activeTheme ? ` data-theme="${escapeXml(activeTheme)}"` : "";
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml"${themeAttr} style="width:${width}px;height:${height}px;overflow:hidden;color-scheme:${activeTheme};">
      <style>${escapeXml(cssText)}</style>
      ${serialized}
    </div>
  </foreignObject>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function blobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create PNG blob."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function drawSvgToCanvas(svgUrl, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable."));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Failed to render SVG into image."));
    img.src = svgUrl;
  });
}

export async function exportDashboardPng({ selector = ".page", copyToClipboard = false, theme = "" } = {}) {
  const node = document.querySelector(selector);
  if (!node) throw new Error("Dashboard root not found.");

  const width = Math.max(node.scrollWidth, node.clientWidth, document.documentElement.clientWidth);
  const height = Math.max(node.scrollHeight, node.clientHeight, document.documentElement.clientHeight);
  const maxDim = 16000;
  if (width > maxDim || height > maxDim) {
    throw new Error(`Dashboard is too large for PNG export (${width}x${height}).`);
  }

  const svgUrl = makeSvgDataUrl(node, width, height, theme);
  const canvas = await drawSvgToCanvas(svgUrl, width, height);
  const blob = await blobFromCanvas(canvas);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rl-dashboard-${Date.now()}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);

  let copied = false;
  if (copyToClipboard && navigator?.clipboard?.write && window?.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      copied = true;
    } catch {
      copied = false;
    }
  }

  return { copied, width, height };
}
