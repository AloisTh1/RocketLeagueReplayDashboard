import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appPath = path.resolve(process.cwd(), "src", "App.jsx");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesPath = path.resolve(process.cwd(), "src", "styles.css");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

test("aggregate contribution chart uses ComposedChart so regression lines can render over stacked bars", () => {
  assert.match(appSource, /ComposedChart/);
  assert.match(appSource, /<ComposedChart data=\{overviewContributionTrendDataWithRegression\}/);
  assert.match(appSource, /dataKey="goals"[\s\S]*stackId="contrib"/);
  assert.match(appSource, /dataKey="assists"[\s\S]*stackId="contrib"/);
  assert.match(appSource, /dataKey="saves"[\s\S]*stackId="contrib"/);
  assert.match(appSource, /dataKey="shot_accuracy"[\s\S]*name="Goals \/ Shot"/);
  assert.match(appSource, /<YAxis yAxisId="ratio"[\s\S]*tickFormatter=\{\(value\) => pct\(Number\(value\) \|\| 0\)\}/);
  assert.match(appSource, /goalsRegression/);
  assert.match(appSource, /assistsRegression/);
  assert.match(appSource, /savesRegression/);
  assert.match(appSource, /shotAccuracyRegression/);
  assert.match(appSource, /dataKey="goalsRegression"[\s\S]*stroke="#22c55e"/);
  assert.match(appSource, /dataKey="assistsRegression"[\s\S]*stroke="#38bdf8"/);
  assert.match(appSource, /dataKey="savesRegression"[\s\S]*stroke="#f59e0b"/);
  assert.match(appSource, /dataKey="shotAccuracyRegression"[\s\S]*stroke="#22c55e"/);
  assert.match(appSource, /<YAxis yAxisId="ratio"[\s\S]*orientation="right"/);
  assert.doesNotMatch(appSource, /mateGoals/);
  assert.doesNotMatch(appSource, /mateAssists/);
  assert.doesNotMatch(appSource, /mateSaves/);
  assert.doesNotMatch(appSource, /Mate total contributions/);
});

test("mate overlay color is normalized across comparable charts", () => {
  assert.match(appSource, /const playerCurveColor = "#22c55e"/);
  assert.match(appSource, /const mateOverlayColor = "#38bdf8"/);
  assert.match(appSource, /const enemyCurveColor = "#ef4444"/);
  assert.match(appSource, /showBoostMateOverlay/);
  assert.match(appSource, /showScoreMomentumMateOverlay/);
  assert.match(appSource, /showScoreGapMateOverlay/);
  assert.doesNotMatch(appSource, /showMateComparison/);
  assert.match(appSource, /dataKey="avgScore"[\s\S]*stroke=\{playerCurveColor\}/);
  assert.match(appSource, /dataKey="scoreGap"[\s\S]*stroke=\{playerCurveColor\}/);
  assert.match(appSource, /dataKey="player"[\s\S]*stroke=\{playerCurveColor\}/);
  assert.match(appSource, /dataKey="mateAvgScore"[\s\S]*stroke=\{mateOverlayColor\}/);
  assert.match(appSource, /dataKey="mateScoreGap"[\s\S]*stroke=\{mateOverlayColor\}/);
  assert.match(appSource, /dataKey="enemies"[\s\S]*stroke=\{enemyCurveColor\}/);
});

test("map win-rate chart uses horizontal bars with inline game-count labels", () => {
  assert.match(appSource, /<BarChart data=\{mapWinRateRows\} layout="vertical"/);
  assert.match(appSource, /className="chart map-winrate-chart"/);
  assert.match(appSource, /formatMapCategoryLabel/);
  assert.match(appSource, /dataKey="winRateLabel"/);
});

test("overview graph layout is capped at two columns with larger chart cards", () => {
  assert.match(stylesSource, /\.chart-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(320px, 1fr\)\);/);
  assert.match(stylesSource, /\.overview-chart-panel \.chart \{[\s\S]*height: 290px;[\s\S]*min-width: 0;[\s\S]*overflow: hidden;/);
  assert.match(stylesSource, /\.chart-panel \{[\s\S]*min-width: 0;/);
});

test("overview keeps only the concise impactful stats block and drops category rollups", () => {
  assert.match(appSource, /Impactful Stats \(Concise\)/);
  assert.doesNotMatch(appSource, /id="stats-categories"/);
  assert.doesNotMatch(appSource, /Feature Categories/);
});

test("overview includes a bucket correlation table for the active time filter", () => {
  assert.match(appSource, /id="correlation-table"/);
  assert.match(appSource, /Correlations/);
  assert.match(appSource, /buildBucketCorrelations/);
  assert.match(appSource, /Pearson correlation/);
});

test("processing section includes a live parsing speed chart", () => {
  assert.match(appSource, /const \[parseSpeedHistory, setParseSpeedHistory\] = useState\(\[\]\)/);
  assert.match(appSource, /Current \{num\(latestParseSpeed, 2\)\} replay\/s/);
  assert.match(appSource, /Peak \{num\(peakParseSpeed, 2\)\} replay\/s/);
  assert.match(appSource, /<LineChart data=\{parseSpeedHistory\}>/);
  assert.match(appSource, /dataKey="speed" name="Replay\/s"/);
  assert.match(stylesSource, /\.speed-panel \{/);
});

test("misc section includes a days played heatmap", () => {
  assert.match(appSource, /aria-label="Days played heatmap"/);
  assert.match(appSource, /className="misc-heatmap-grid"/);
  assert.match(appSource, /Days Played Heatmap/);
  assert.match(appSource, /ranked > 0 \? `\$\{ranked\} ranked`/);
  assert.match(appSource, /tournament > 0 \? `\$\{tournament\} tournament`/);
  assert.match(appSource, /casual > 0 \? `\$\{casual\} casual`/);
});
