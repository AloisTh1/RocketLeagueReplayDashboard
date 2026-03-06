import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dataFieldsPath = path.resolve(process.cwd(), "..", "docs", "DATA_FIELDS.md");
const markdown = fs.readFileSync(dataFieldsPath, "utf8");

test("DATA_FIELDS documents fixed blue/orange replay-side fields emitted by build_row", () => {
  for (const field of [
    "`blue_player_names`",
    "`orange_player_names`",
    "`blue_players[]`",
    "`orange_players[]`",
    "`blue_score`",
    "`orange_score`",
  ]) {
    assert.match(markdown, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("DATA_FIELDS notes the legacy share-team naming mismatch", () => {
  assert.match(markdown, /Fields named `\*_share_team`.*legacy names/i);
  assert.match(markdown, /share of the full lobby total/i);
});

test("DATA_FIELDS points KPI computation at the extracted kpi helper", () => {
  assert.match(markdown, /\[kpis\.js\]\(\.\.\/frontend\/src\/features\/dashboard\/kpis\.js\)/);
});
