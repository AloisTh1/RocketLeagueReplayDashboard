import dataFieldsMarkdown from "../../../../docs/DATA_FIELDS.md?raw";

function extractSection(markdown, heading) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##+\s/.test(line.trim())) break;
    out.push(line);
  }
  return out;
}

function parseWebsiteKpiCopy(markdown) {
  const lines = extractSection(markdown, "### Website KPI Copy");
  const docs = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^- `([^`]+)`: (.+)$/);
    if (!match) continue;
    docs[match[1]] = match[2];
  }
  return docs;
}

export const KPI_MARKDOWN_DOCS = parseWebsiteKpiCopy(dataFieldsMarkdown);

export function kpiDoc(name) {
  return KPI_MARKDOWN_DOCS[name] || "";
}
