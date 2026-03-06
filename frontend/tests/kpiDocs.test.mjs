import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dataFieldsPath = path.resolve(process.cwd(), "..", "docs", "DATA_FIELDS.md");
const markdown = fs.readFileSync(dataFieldsPath, "utf8");

function getWebsiteKpiLine(name) {
  const match = markdown.match(new RegExp(String.raw`- \`${name}\`: (.+)`));
  return match ? match[1].trim() : "";
}

test("website KPI copy keeps display rule separate from per-metric details", () => {
  const replays = getWebsiteKpiLine("Replays");
  const winRate = getWebsiteKpiLine("Win Rate");
  const displayRule = getWebsiteKpiLine("Display rule");

  assert.match(replays, /currently visible after your active filters/i);
  assert.doesNotMatch(replays, /Cards split into `Team \/ Player`/i);

  assert.match(winRate, /tracked player's win rate/i);
  assert.doesNotMatch(winRate, /Cards split into `Team \/ Player`/i);

  assert.match(displayRule, /only when those two values are different/i);
});
