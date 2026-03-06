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

test("website KPI copy keeps replay and win-rate descriptions aligned with the fixed cards", () => {
  const replays = getWebsiteKpiLine("Replays");
  const winRate = getWebsiteKpiLine("Win Rate");

  assert.match(replays, /number of replay rows in the current scope after filters/i);
  assert.doesNotMatch(replays, /tracked-player count as a second value/i);
  assert.equal(getWebsiteKpiLine("Display rule"), "");

  assert.match(winRate, /tracked player's win rate/i);
  assert.match(winRate, /actual side in each replay/i);
  assert.doesNotMatch(winRate, /Cards split into `Team \/ Player`/i);
});
