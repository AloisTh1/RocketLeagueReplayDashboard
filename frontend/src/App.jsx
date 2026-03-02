import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { Activity, CalendarRange, Download, Filter, Gauge, Github, Info, Moon, Radar, Sun, Trophy } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  cancelDashboardRun,
  clearCache,
  detectReplays,
  getDashboard,
  getDashboardProgress,
  getHealth,
  openCacheDir,
  openRawDir,
  pickBoxcarsExe,
  pickCacheDir,
  pickDemosDir,
  pickRawDir,
} from "./api";
import { exportDashboardPng } from "./utils/exportImage";
import { SETTINGS_KEY, THEME_KEY, defaults, initialTheme } from "./app/config";
import { clampInt, num, pct, pctInt, signed, toAnchorId, toInputDate } from "./app/utils/formatters";
import { exportPdf, saveCsv } from "./app/utils/exporters";
import { useBoostTrail } from "./app/hooks/useBoostTrail";
import { computeDerived } from "./app/derived";
import {
  ANALYTICS_VIEW_DEFS,
  METRIC_DOCS,
  PLATFORM_LEGEND,
  RECENT_COLUMN_DEFS,
  RECENT_COLUMNS_KEY,
  RECENT_TABLE_FULL_COLS_KEY,
  RECENT_TABLE_MAX_ROWS_KEY,
  TAB_META,
} from "./features/dashboard/constants";
import { extractPlayerNames, normalizePlayerRoster, platformTitle } from "./features/dashboard/players";
import { findPlayerMetric, findTrackedPlayerInRow, isTrackedRow, normalizeIdentity } from "./features/dashboard/playerTracking";
import { buildQuickLinks } from "./features/dashboard/quickLinks";
import { filterRecentRows, paginateRecentRows, sortRecentRows } from "./features/dashboard/recentTable";

function Tip({ text }) {
  return (
    <span className="tip" title={text} aria-label={text}>
      ?
    </span>
  );
}

export default function App() {
  const [filters, setFilters] = useState(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  });
  const [typeFilter, setTypeFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [timeTab, setTimeTab] = useState("day");
  const [analysisStartDate, setAnalysisStartDate] = useState("");
  const [analysisEndDate, setAnalysisEndDate] = useState("");
  const [analysisDraftType, setAnalysisDraftType] = useState("all");
  const [analysisDraftMode, setAnalysisDraftMode] = useState("all");
  const [analysisDraftTimeTab, setAnalysisDraftTimeTab] = useState("day");
  const [analysisDraftStartDate, setAnalysisDraftStartDate] = useState("");
  const [analysisDraftEndDate, setAnalysisDraftEndDate] = useState("");
  const [loadQuickPreset, setLoadQuickPreset] = useState(7);
  const [analysisQuickPreset, setAnalysisQuickPreset] = useState(null);
  const [status, setStatus] = useState("Loading backend health...");
  const [showTopStatus, setShowTopStatus] = useState(true);
  const [topStatusPinned, setTopStatusPinned] = useState(false);
  const [topStatusDismissed, setTopStatusDismissed] = useState(false);
  const [statsInfoOpen, setStatsInfoOpen] = useState(false);
  const [replayConfigOpen, setReplayConfigOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [detectedReplays, setDetectedReplays] = useState(0);
  const [runElapsed, setRunElapsed] = useState(0);
  const [currentRunId, setCurrentRunId] = useState("");
  const [progress, setProgress] = useState(null);
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef(null);
  const [theme, setTheme] = useState(initialTheme);
  const { boostTrailEnabled, boostTrail, boostFuel, boostPads, toggleBoostTrail } = useBoostTrail();
  const [dashboard, setDashboard] = useState({ summary: {}, monthly: [], recent: [] });
  const [selectedReplayIds, setSelectedReplayIds] = useState([]);
  const [statsView, setStatsView] = useState("aggregate");
  const [analyticsView, setAnalyticsView] = useState("overview");
  const [metricsScope, setMetricsScope] = useState("team");
  const [focusedReplayId, setFocusedReplayId] = useState("");
  const [recentSort, setRecentSort] = useState({ col: "date", dir: "desc" });
  const [recentFullColumns, setRecentFullColumns] = useState(() => {
    const raw = localStorage.getItem(RECENT_TABLE_FULL_COLS_KEY);
    return raw === "true";
  });
  const [tableSearch, setTableSearch] = useState("");
  const [tableResultFilter, setTableResultFilter] = useState("all");
  const [tablePage, setTablePage] = useState(1);
  const [maxTableRows, setMaxTableRows] = useState(() => {
    try {
      const raw = localStorage.getItem(RECENT_TABLE_MAX_ROWS_KEY);
      return clampInt(raw ?? 5, 1, 5000, 5);
    } catch {
      return 5;
    }
  });
  const [visibleRecentColumns, setVisibleRecentColumns] = useState(() => {
    try {
      const raw = localStorage.getItem(RECENT_COLUMNS_KEY);
      if (!raw) return RECENT_COLUMN_DEFS.map((c) => c.id);
      const parsed = JSON.parse(raw);
      const allowed = new Set(RECENT_COLUMN_DEFS.map((c) => c.id));
      const filtered = Array.isArray(parsed) ? parsed.filter((id) => allowed.has(id)) : [];
      return filtered.length ? filtered : RECENT_COLUMN_DEFS.map((c) => c.id);
    } catch {
      return RECENT_COLUMN_DEFS.map((c) => c.id);
    }
  });
  const stableRecent = dashboard.recent || [];
  const hasLoadedData = stableRecent.length > 0;
  const trackedPlayerId = useMemo(() => normalizeIdentity(filters.playerId), [filters.playerId]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem(RECENT_COLUMNS_KEY, JSON.stringify(visibleRecentColumns));
  }, [visibleRecentColumns]);
  useEffect(() => {
    localStorage.setItem(RECENT_TABLE_FULL_COLS_KEY, String(recentFullColumns));
  }, [recentFullColumns]);
  useEffect(() => {
    localStorage.setItem(RECENT_TABLE_MAX_ROWS_KEY, String(maxTableRows));
  }, [maxTableRows]);
  useEffect(() => {
    if (!topStatusDismissed) setShowTopStatus(Boolean(status));
  }, [status, topStatusDismissed]);
  useEffect(() => {
    setTopStatusDismissed(false);
  }, [status]);
  useEffect(() => {
    const inferred = inferLoadQuickPreset(filters.startDate, filters.endDate);
    setLoadQuickPreset((prev) => (prev === inferred ? prev : inferred));
  }, [filters.startDate, filters.endDate]);
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY || 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!statsInfoOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setStatsInfoOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [statsInfoOpen]);

  const dateScopedRecent = useMemo(() => {
    return stableRecent.filter((r) => {
      const rowDate = String(r?.date || "");
      const rowDay = rowDate ? format(parseISO(rowDate), "yyyy-MM-dd") : "";
      if (analysisDraftStartDate && rowDay && rowDay < analysisDraftStartDate) return false;
      if (analysisDraftEndDate && rowDay && rowDay > analysisDraftEndDate) return false;
      return true;
    });
  }, [stableRecent, analysisDraftStartDate, analysisDraftEndDate]);

  const typeOptions = useMemo(() => {
    const source =
      analysisDraftMode && analysisDraftMode !== "all"
        ? dateScopedRecent.filter((r) => r.game_mode === analysisDraftMode)
        : dateScopedRecent;
    const values = new Set(source.map((r) => r.match_type).filter(Boolean));
    return ["all", ...Array.from(values)];
  }, [dateScopedRecent, analysisDraftMode]);

  const modeOptions = useMemo(() => {
    const source =
      analysisDraftType && analysisDraftType !== "all"
        ? dateScopedRecent.filter((r) => r.match_type === analysisDraftType)
        : dateScopedRecent;
    const values = new Set(source.map((r) => r.game_mode).filter(Boolean));
    return ["all", ...Array.from(values)];
  }, [dateScopedRecent, analysisDraftType]);

  const analysisFilteredRecent = useMemo(() => {
    return stableRecent.filter((r) => {
      const rowDate = String(r?.date || "");
      const rowDay = rowDate ? format(parseISO(rowDate), "yyyy-MM-dd") : "";
      if (analysisStartDate && rowDay && rowDay < analysisStartDate) return false;
      if (analysisEndDate && rowDay && rowDay > analysisEndDate) return false;
      if (typeFilter !== "all" && r.match_type !== typeFilter) return false;
      if (modeFilter !== "all" && r.game_mode !== modeFilter) return false;
      return true;
    });
  }, [stableRecent, typeFilter, modeFilter, analysisStartDate, analysisEndDate]);

  const selectedRecent = useMemo(() => {
    if (!selectedReplayIds.length) return [];
    const selected = new Set(selectedReplayIds);
    return stableRecent.filter((r) => selected.has(r.id));
  }, [stableRecent, selectedReplayIds]);
  const missingRequiredParseFields = useMemo(() => {
    const missing = [];
    if (!String(filters.demosDir || "").trim()) missing.push("Demos directory");
    if (!String(filters.boxcarsExe || "").trim()) missing.push("Boxcars exe");
    if (Boolean(filters.writeCache)) {
      if (!String(filters.cacheDir || "").trim()) missing.push("Cache directory");
      if (!String(filters.rawDir || "").trim()) missing.push("Raw directory");
    }
    return missing;
  }, [filters.demosDir, filters.boxcarsExe, filters.writeCache, filters.cacheDir, filters.rawDir]);
  const canRunParse = missingRequiredParseFields.length === 0;

  const activeRecent = selectedReplayIds.length ? selectedRecent : analysisFilteredRecent;
  const focusedReplay = useMemo(() => {
    if (focusedReplayId) {
      const explicit = stableRecent.find((r) => r.id === focusedReplayId);
      if (explicit) return explicit;
    }
    return selectedRecent[0] || null;
  }, [focusedReplayId, stableRecent, selectedRecent]);
  const derived = useMemo(() => computeDerived(activeRecent), [activeRecent]);
  const singleMatchDerived = useMemo(
    () => computeDerived(focusedReplay ? [focusedReplay] : []),
    [focusedReplay]
  );
  const viewDerived = statsView === "single" ? singleMatchDerived : derived;

  useEffect(() => {
    if (!loading) return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      setRunElapsed((Date.now() - started) / 1000);
    }, 250);
    return () => clearInterval(timer);
  }, [loading]);

  async function runAnalysis() {
    if (!canRunParse) {
      setStatus(`Missing required fields: ${missingRequiredParseFields.join(", ")}.`);
      return;
    }
    return runAnalysisWithFilters(filters);
  }

  function buildDetectParams(activeFilters) {
    const params = {
      demos_dir: activeFilters.demosDir,
      count: 5000,
      use_cache: true,
      load_cached_replays: true,
    };
    if (activeFilters.cacheDir) params.cache_dir = activeFilters.cacheDir;
    if (activeFilters.startDate) params.start_date = activeFilters.startDate;
    if (activeFilters.endDate) params.end_date = activeFilters.endDate;
    return params;
  }

  async function runAnalysisWithFilters(activeFilters) {
    if (activeFilters.startDate && activeFilters.endDate && activeFilters.startDate > activeFilters.endDate) {
      setStatus("Invalid date range: start date must be before or equal to end date.");
      return;
    }

    const normalized = {
      ...activeFilters,
      parseCount: clampInt(activeFilters.parseCount, 0, 2000, 40),
      workers: clampInt(activeFilters.workers, 1, 16, 4),
    };
    const loadAll = Number(normalized.parseCount) <= 0;

    setLoading(true);
    setRunElapsed(0);
    setStatus("Phase 1/4 - Scanning replay files...");

    let detected = 0;
    try {
      const detect = await detectReplays(buildDetectParams(normalized));
      detected = Number(detect?.detected_replays || 0);
      setDetectedReplays(detected);
      const newCount = Number(detect?.new_replays || 0);
      const totalCount = Number(detect?.total_replays || detected);
      const cachedCount = Math.max(0, totalCount - newCount);
      const queuedCount = loadAll ? detected : Math.min(Number(normalized.parseCount) || 0, detected);
      if (newCount > 0) {
        setStatus(
          `Phase 2/4 - Cache scan complete: ${cachedCount} cached, ${newCount} new, ${detected} detected. Current replay count setting will load ${queuedCount}.`
        );
      } else {
        setStatus(
          `Phase 2/4 - Cache scan complete: ${cachedCount} cached, no new replay to parse, ${detected} detected. Current replay count setting will load ${queuedCount}.`
        );
      }
    } catch (err) {
      setLoading(false);
      setStatus(err?.response?.data?.detail || "Scan failed: could not detect replay count.");
      return;
    }

    if (detected <= 0) {
      setLoading(false);
      setStatus("Scan complete: no replay found for current filters.");
      return;
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCurrentRunId(runId);
    setProgress({
      run_id: runId,
      processed: 0,
      queued: loadAll ? detected : Math.min(Number(normalized.parseCount) || 0, detected),
      parsed: 0,
      failed: 0,
      matched: 0,
      cache_hits: 0,
      cache_misses: 0,
      done: false,
      status: "running",
    });
    setStatus("Phase 3/4 - Parsing replays and computing stats...");
    let poller = null;
    let progressEndpointAvailable = true;
    const poll = async () => {
      if (!progressEndpointAvailable) return;
      try {
        const p = await getDashboardProgress(runId);
        if (p?.ok) {
          setProgress((prev) => {
            if (
              prev &&
              prev.run_id === p.run_id &&
              prev.processed === p.processed &&
              prev.queued === p.queued &&
              prev.parsed === p.parsed &&
              prev.failed === p.failed &&
              prev.matched === p.matched &&
              prev.cache_hits === p.cache_hits &&
              prev.cache_misses === p.cache_misses &&
              prev.done === p.done &&
              prev.status === p.status
            ) {
              return prev;
            }
            return p;
          });
        }
      } catch (err) {
        if (err?.response?.status === 404) {
          progressEndpointAvailable = false;
          if (poller) {
            window.clearInterval(poller);
            poller = null;
          }
        }
        // Ignore transient polling failures while run is active.
      }
    };
    poller = window.setInterval(poll, 700);
    await poll();
    try {
      const params = {
        demos_dir: normalized.demosDir,
        player_id: normalized.playerId,
        limit_replays: !loadAll,
        count: loadAll ? 5000 : Number(normalized.parseCount),
        parse_count: Number(normalized.parseCount),
        workers: Number(normalized.workers || 1),
        use_cache: true,
        load_cached_replays: true,
        write_cache: Boolean(normalized.writeCache),
        run_id: runId,
      };
      if (normalized.cacheDir) params.cache_dir = normalized.cacheDir;
      if (normalized.rawDir) params.raw_dir = normalized.rawDir;
      if (normalized.startDate) params.start_date = normalized.startDate;
      if (normalized.endDate) params.end_date = normalized.endDate;
      if (normalized.boxcarsExe) params.boxcars_exe = normalized.boxcarsExe;
      const data = await getDashboard(params);
      setDashboard(data);
      setProgress({
        ok: true,
        run_id: runId,
        processed: Number(data?.summary?.queued_replays || 0),
        queued: Number(data?.summary?.queued_replays || 0),
        parsed: Number(data?.summary?.parsed_replays || 0),
        failed: Number(data?.summary?.failed_replays || 0),
        matched: Number(data?.summary?.matched_replays || 0),
        cache_hits: Number(data?.summary?.cache_hits || 0),
        cache_misses: Number(data?.summary?.cache_misses || 0),
        done: true,
        status: "done",
      });
      const hits = data?.summary?.cache_hits ?? 0;
      const misses = data?.summary?.cache_misses ?? 0;
      const newCount = Number(data?.summary?.new_replays_detected || 0);
      if (data?.summary?.cancelled) {
        setStatus(
          `Run cancelled after ${num(data?.summary?.elapsed_seconds, 2)}s. Parsed ${data?.summary?.parsed_replays || 0}/${data?.summary?.queued_replays || 0
          } replay(s).`
        );
      } else {
        setStatus(
          `Phase 4/4 - Complete in ${num(data?.summary?.elapsed_seconds, 2)}s. Parsed ${data?.summary?.parsed_replays || 0}/${data?.summary?.queued_replays || 0
          } replay(s) with ${data?.summary?.workers || normalized.workers || 1} worker(s). Cache ${hits} hit(s), ${misses} miss(es). ${normalized.writeCache ? "Writing new parses to cache." : "Write-to-cache disabled."
          } New replays detected: ${newCount}.`
        );
      }
      setReplayConfigOpen(false);
    } catch (err) {
      setProgress((prev) => (prev ? { ...prev, done: true, status: "failed" } : prev));
      setStatus(err?.response?.data?.detail || err.message || "Parse failed: analysis run did not complete.");
    } finally {
      if (poller) window.clearInterval(poller);
      setLoading(false);
    }
  }

  async function browseBoxcarsExe() {
    try {
      const path = await pickBoxcarsExe();
      if (path) setFilters((prev) => ({ ...prev, boxcarsExe: path }));
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Could not open file picker.");
    }
  }

  async function browseDemosDir() {
    try {
      const path = await pickDemosDir();
      if (path) setFilters((prev) => ({ ...prev, demosDir: path }));
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Could not open folder picker.");
    }
  }

  async function browseCacheDir() {
    try {
      const path = await pickCacheDir();
      if (path) setFilters((prev) => ({ ...prev, cacheDir: path }));
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Could not open folder picker.");
    }
  }

  async function browseRawDir() {
    try {
      const path = await pickRawDir();
      if (path) setFilters((prev) => ({ ...prev, rawDir: path }));
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Could not open folder picker.");
    }
  }

  async function handleStopParsing(runIdArg) {
    if (!loading) return;
    const targetRunId = String(runIdArg || currentRunId || progress?.run_id || "").trim();
    if (!targetRunId) {
      setStatus("Stop requested, but no active run id is available yet.");
      return;
    }
    setStatus("Cancellation requested. Stopping parse...");
    setProgress((prev) => (prev ? { ...prev, status: "cancelling" } : prev));
    try {
      await cancelDashboardRun(targetRunId);
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Failed to cancel current parse run.");
    }
  }

  async function handleClearCache() {
    try {
      const data = await clearCache({
        ...(filters.cacheDir ? { cache_dir: filters.cacheDir } : {}),
        ...(filters.rawDir ? { raw_dir: filters.rawDir } : {}),
      });
      setStatus(`Cache cleared. Removed ${data?.removed_files || 0} file(s).`);
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Failed to clear cache.");
    }
  }

  async function handleOpenCacheDir() {
    try {
      const data = await openCacheDir({
        ...(filters.cacheDir ? { cache_dir: filters.cacheDir } : {}),
      });
      setStatus(`Opened cache folder: ${data?.path || ""}`);
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Failed to open cache folder.");
    }
  }

  async function handleOpenRawDir() {
    try {
      const data = await openRawDir({
        ...(filters.rawDir ? { raw_dir: filters.rawDir } : {}),
      });
      setStatus(`Opened raw folder: ${data?.path || ""}`);
    } catch (err) {
      setStatus(err?.response?.data?.detail || err.message || "Failed to open raw folder.");
    }
  }

  async function exportPng(copyToClipboard = true) {
    try {
      const result = await exportDashboardPng({ selector: ".page", copyToClipboard, theme });
      if (result.copied) {
        setStatus(`PNG exported (${result.width}x${result.height}) and copied to clipboard.`);
      } else {
        setStatus(`PNG exported (${result.width}x${result.height}). Clipboard copy not available.`);
      }
    } catch (err) {
      setStatus(`PNG export failed (${err?.message || "unknown error"}). Falling back to PDF export.`);
      exportPdf({ theme });
    }
  }

  function quickDateRange(days) {
    if (days <= 0) return { startDate: "", endDate: "" };
    const end = new Date();
    const start = subDays(end, Math.max(0, days - 1));
    return {
      startDate: toInputDate(start),
      endDate: toInputDate(end),
    };
  }
  function inferLoadQuickPreset(startDate, endDate) {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    if (!start && !end) return 7;
    if (!start || !end) return null;
    for (const days of [1, 7, 30, 90]) {
      const r = quickDateRange(days);
      if (start === r.startDate && end === r.endDate) return days;
    }
    return null;
  }

  function applyQuickDaysLoad(days) {
    const range = quickDateRange(days);
    setFilters((prev) => ({
      ...prev,
      startDate: range.startDate,
      endDate: range.endDate,
    }));
    setLoadQuickPreset(days);
  }

  function applyQuickDaysAnalysis(days) {
    const range = quickDateRange(days);
    setAnalysisDraftStartDate(range.startDate);
    setAnalysisDraftEndDate(range.endDate);
    setAnalysisQuickPreset(days);
  }

  function applyAnalysisDatesFromLoad() {
    setAnalysisDraftStartDate(filters.startDate || "");
    setAnalysisDraftEndDate(filters.endDate || "");
    setAnalysisQuickPreset(loadQuickPreset);
  }

  function clearAnalysisDates() {
    setAnalysisDraftStartDate("");
    setAnalysisDraftEndDate("");
    setAnalysisQuickPreset(0);
  }

  function resetAnalysisFilters() {
    setAnalysisDraftStartDate("");
    setAnalysisDraftEndDate("");
    setAnalysisDraftType("all");
    setAnalysisDraftMode("all");
    setAnalysisDraftTimeTab("day");
    setAnalysisQuickPreset(null);
    setStatus("Analysis filters reset.");
  }

  const playerKpis = useMemo(() => {
    const rows = activeRecent || [];
    if (!rows.length) {
      return {
        avgScore: 0,
        avgGoals: 0,
        avgAssists: 0,
        avgSaves: 0,
      };
    }
    const avgOf = (metricKey) => {
      const values = rows
        .map((row) => findPlayerMetric(row, metricKey, trackedPlayerId))
        .filter((v) => v !== null);
      if (!values.length) return 0;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    return {
      avgScore: avgOf("score"),
      avgGoals: avgOf("goals"),
      avgAssists: avgOf("assists"),
      avgSaves: avgOf("saves"),
    };
  }, [activeRecent, trackedPlayerId]);
  const trackedRowsCount = useMemo(() => {
    if (!activeRecent?.length) return 0;
    if (!trackedPlayerId) return activeRecent.length;
    return activeRecent.filter((row) => isTrackedRow(row, trackedPlayerId)).length;
  }, [activeRecent, trackedPlayerId]);
  const trackedPlayerName = useMemo(() => {
    if (!trackedPlayerId || !activeRecent?.length) return "";
    const counts = new Map();
    for (const row of activeRecent) {
      if (!isTrackedRow(row, trackedPlayerId)) continue;
      const matched = findTrackedPlayerInRow(row, trackedPlayerId);
      const name = String(matched?.name || row?.player_name || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    let bestName = "";
    let bestCount = 0;
    for (const [name, count] of counts.entries()) {
      if (count > bestCount) {
        bestName = name;
        bestCount = count;
      }
    }
    return bestName;
  }, [activeRecent, trackedPlayerId]);
  const playerScopedInsights = useMemo(() => {
    const rows = statsView === "single" ? (focusedReplay ? [focusedReplay] : []) : activeRecent;
    const avgOf = (metricKey, sourceRows = rows) => {
      const values = sourceRows
        .map((row) => findPlayerMetric(row, metricKey, trackedPlayerId))
        .filter((v) => v !== null);
      if (!values.length) return 0;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const winsOnly = rows.filter((r) => r.won);
    const lossesOnly = rows.filter((r) => !r.won);
    const categories = [
      {
        id: "offense",
        label: "Offense",
        metrics: [
          { label: "Avg Goals", value: num(avgOf("goals")) },
          { label: "Avg Shots", value: num(avgOf("shots")) },
          { label: "Shot Accuracy", value: pct(avgOf("shot_accuracy")) },
          { label: "Goals vs Opp", value: signed(avgOf("goals_diff_vs_opponents")) },
        ],
      },
      {
        id: "defense",
        label: "Defense",
        metrics: [
          { label: "Avg Saves", value: num(avgOf("saves")) },
          { label: "Saves vs Opp", value: signed(avgOf("saves_diff_vs_opponents")) },
          { label: "Save Share Team", value: pct(avgOf("saves_share_team")) },
          { label: "Pressure Index", value: num(avgOf("pressure_index")) },
        ],
      },
      {
        id: "teamplay",
        label: "Teamplay",
        metrics: [
          { label: "Avg Assists", value: num(avgOf("assists")) },
          { label: "Score vs Mate", value: signed(avgOf("score_diff_vs_mate")) },
          { label: "Score Share Team", value: pct(avgOf("score_share_team")) },
          { label: "Assists Share Team", value: pct(avgOf("assists_share_team")) },
        ],
      },
      {
        id: "impact",
        label: "Impact",
        metrics: [
          { label: "Avg Score", value: num(avgOf("score")) },
          { label: "Pressure Index", value: num(avgOf("pressure_index")) },
          { label: "Score vs Opp", value: signed(avgOf("score_diff_vs_opponents")) },
          { label: "Score vs Others", value: signed(avgOf("score_diff_vs_others")) },
        ],
      },
      {
        id: "context",
        label: "Context",
        metrics: [
          { label: "Win Rate", value: pct(rows.length ? winsOnly.length / rows.length : 0) },
          { label: "Goal Share Team", value: pct(avgOf("goals_share_team")) },
          { label: "Save Share Team", value: pct(avgOf("saves_share_team")) },
          { label: "Assist vs Opp", value: signed(avgOf("assists_diff_vs_opponents")) },
        ],
      },
    ];
    const impactStats = [
      { key: "score", label: "Score" },
      { key: "goals", label: "Goals" },
      { key: "shots", label: "Shots" },
      { key: "saves", label: "Saves" },
      { key: "big_boosts", label: "Big Boosts" },
      { key: "small_boosts", label: "Small Boosts" },
    ]
      .map((m) => {
        const winAvg = avgOf(m.key, winsOnly);
        const lossAvg = avgOf(m.key, lossesOnly);
        return {
          label: m.label,
          winAvg,
          lossAvg,
          delta: winAvg - lossAvg,
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const boostRow = (row) => {
      const big = findPlayerMetric(row, "big_boosts", trackedPlayerId);
      const small = findPlayerMetric(row, "small_boosts", trackedPlayerId);
      if (big === null && small === null) return null;
      const safeBig = Number(big ?? 0);
      const safeSmall = Number(small ?? 0);
      return {
        big: Number.isFinite(safeBig) ? safeBig : 0,
        small: Number.isFinite(safeSmall) ? safeSmall : 0,
      };
    };
    const avgBoostOf = (kind, sourceRows = rows) => {
      const values = sourceRows
        .map((row) => boostRow(row))
        .filter((v) => v !== null)
        .map((v) => {
          if (kind === "big") return v.big;
          if (kind === "small") return v.small;
          return v.big + v.small;
        });
      if (!values.length) return 0;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const boostBars = [
      { metric: "Big", avg: avgBoostOf("big") },
      { metric: "Small", avg: avgBoostOf("small") },
      { metric: "Total", avg: avgBoostOf("total") },
    ];
    const boostWinLoss = [
      { metric: "Big", win: avgBoostOf("big", winsOnly), loss: avgBoostOf("big", lossesOnly) },
      { metric: "Small", win: avgBoostOf("small", winsOnly), loss: avgBoostOf("small", lossesOnly) },
    ];
    return { categories, impactStats, boostBars, boostWinLoss };
  }, [activeRecent, focusedReplay, statsView, trackedPlayerId]);
  const scopedCategories = metricsScope === "player" ? playerScopedInsights.categories : viewDerived.categories;
  const scopedImpactStats = metricsScope === "player" ? playerScopedInsights.impactStats : viewDerived.impactStats;
  const scopedBoostBars = (metricsScope === "player" ? playerScopedInsights.boostBars : viewDerived.boostBars) || [];
  const scopedBoostWinLoss = (metricsScope === "player" ? playerScopedInsights.boostWinLoss : viewDerived.boostWinLoss) || [];

  const cards = [
    { label: "Replays", value: derived.matches, icon: Activity, scope: "team" },
    { label: "Win Rate", value: pct(derived.winRate), icon: Trophy, scope: "team" },
    { label: "Player Avg Score", value: num(playerKpis.avgScore), icon: Gauge, scope: "player", requiresPlayerId: true },
    { label: "Player Avg Goals", value: num(playerKpis.avgGoals), icon: Radar, scope: "player", requiresPlayerId: true },
    { label: "Player Avg Assists", value: num(playerKpis.avgAssists), icon: Activity, scope: "player", requiresPlayerId: true },
    { label: "Player Avg Saves", value: num(playerKpis.avgSaves), icon: Activity, scope: "player", requiresPlayerId: true },
  ];
  const quickLinks = useMemo(() => buildQuickLinks(analyticsView), [analyticsView]);

  const summary = dashboard.summary || {};
  const allRecent = useMemo(() => stableRecent.slice(), [stableRecent]);
  const filteredRecentTableRows = useMemo(
    () => filterRecentRows(allRecent, tableSearch, tableResultFilter),
    [allRecent, tableSearch, tableResultFilter],
  );
  const sortedRecentTableRows = useMemo(
    () => sortRecentRows(filteredRecentTableRows, recentSort),
    [filteredRecentTableRows, recentSort],
  );
  const tablePagination = useMemo(
    () => paginateRecentRows(sortedRecentTableRows, tablePage, maxTableRows),
    [sortedRecentTableRows, tablePage, maxTableRows],
  );
  const pageSize = tablePagination.pageSize;
  const tableTotalPages = tablePagination.totalPages;
  const tablePageSafe = tablePagination.page;
  const visibleRecentTableRows = tablePagination.rows;
  useEffect(() => {
    if (tablePage !== tablePageSafe) setTablePage(tablePageSafe);
  }, [tablePage, tablePageSafe]);
  useEffect(() => {
    setTablePage(1);
  }, [tableSearch, tableResultFilter, maxTableRows]);
  const tabMeta = TAB_META;
  const activeTrend = viewDerived.trendByTab?.[timeTab] || [];
  const trendTickFormatter = (bucket) => {
    if (timeTab === "hour") {
      const text = String(bucket || "");
      return text.length > 11 ? text.slice(5) : text;
    }
    return String(bucket || "");
  };
  const shouldShowAnalytics = (...groups) => analyticsView === "all" || groups.includes(analyticsView);
  const timeAggregate = useMemo(() => {
    const rows = (activeTrend || []).filter((r) => Number(r?.games || 0) > 0);
    if (!rows.length) {
      return {
        buckets: 0,
        gamesPerBucket: 0,
        weightedWinRate: 0,
        weightedScore: 0,
        bestBucket: null,
        worstBucket: null,
        busiestBucket: null,
      };
    }
    const totalGames = rows.reduce((s, r) => s + Number(r.games || 0), 0);
    const totalWins = rows.reduce((s, r) => s + Number(r.wins || 0), 0);
    const weightedScoreSum = rows.reduce((s, r) => s + Number(r.avgScore || 0) * Number(r.games || 0), 0);
    const bestBucket = rows.slice().sort((a, b) => {
      const wr = Number(b.winRate || 0) - Number(a.winRate || 0);
      if (wr !== 0) return wr;
      return Number(b.games || 0) - Number(a.games || 0);
    })[0];
    const worstBucket = rows.slice().sort((a, b) => {
      const wr = Number(a.winRate || 0) - Number(b.winRate || 0);
      if (wr !== 0) return wr;
      return Number(b.games || 0) - Number(a.games || 0);
    })[0];
    const busiestBucket = rows.slice().sort((a, b) => Number(b.games || 0) - Number(a.games || 0))[0];
    return {
      buckets: rows.length,
      gamesPerBucket: totalGames / rows.length,
      weightedWinRate: totalGames ? totalWins / totalGames : 0,
      weightedScore: totalGames ? weightedScoreSum / totalGames : 0,
      bestBucket,
      worstBucket,
      busiestBucket,
    };
  }, [activeTrend]);
  const activeTimeMeta = tabMeta[timeTab] || tabMeta.day;
  const statsInfoSections = [
    {
      title: "Player KPIs (Player scope)",
      scope: "Player",
      items: cards.map((card) => ({
        name: card.label,
        value: String(card.value),
        desc: METRIC_DOCS[card.label] || "Derived metric.",
      })),
    },
    {
      title: `Feature Categories (${metricsScope === "player" ? "Player" : "Team"} scope)`,
      scope: metricsScope === "player" ? "Player" : "Team",
      items: (scopedCategories || []).flatMap((cat) =>
        (cat.metrics || []).map((metric) => ({
          name: `${cat.label} - ${metric.label}`,
          value: String(metric.value || "-"),
          desc: `${METRIC_DOCS[metric.label] || "Category metric derived from scoped replays."} Category: ${cat.label}.`,
        })),
      ),
    },
    {
      title: `Boost Metrics (${metricsScope === "player" ? "Player" : "Team"} scope)`,
      scope: metricsScope === "player" ? "Player" : "Team",
      items: [
        ...(scopedBoostBars || []).map((row) => ({
          name: `Boost Avg - ${row.metric}`,
          value: num(row.avg, 2),
          desc: `${METRIC_DOCS[`Avg ${row.metric} Boosts`] || METRIC_DOCS["Avg Total Boost"]} Uses all scoped matches.`,
        })),
        ...(scopedBoostWinLoss || []).flatMap((row) => ([
          {
            name: `Boost Win Avg - ${row.metric}`,
            value: num(row.win, 2),
            desc: `Average ${row.metric.toLowerCase()} boosts in wins only.`,
          },
          {
            name: `Boost Loss Avg - ${row.metric}`,
            value: num(row.loss, 2),
            desc: `Average ${row.metric.toLowerCase()} boosts in losses only.`,
          },
        ])),
      ],
    },
    {
      title: "Impactful Stats",
      scope: metricsScope === "player" ? "Player" : "Team",
      items: (scopedImpactStats || []).map((row) => ({
        name: `${row.label} Delta`,
        value: signed(row.delta),
        desc: `${METRIC_DOCS[row.label] || "Win/loss split metric."} Delta = win average - loss average (W ${num(row.winAvg)} | L ${num(row.lossAvg)}).`,
      })),
    },
    {
      title: "Time & Trend Metrics",
      scope: "Team",
      items: [
        {
          name: `${activeTimeMeta.short} Win Trend`,
          value: `${activeTrend.length} buckets`,
          desc: `${METRIC_DOCS["Win Trend"]} Bucket format: ${activeTimeMeta.tip}`,
        },
        {
          name: `Latest ${activeTimeMeta.short} Avg Score`,
          value: activeTrend.length ? num(activeTrend[activeTrend.length - 1]?.avgScore || 0) : "-",
          desc: `${METRIC_DOCS["Score Momentum"]} Value shown here is the latest bucket's avgScore.`,
        },
        {
          name: `Latest ${activeTimeMeta.short} Score Diff`,
          value: activeTrend.length ? signed(activeTrend[activeTrend.length - 1]?.scoreDiff || 0) : "-",
          desc: `${METRIC_DOCS["Score Diff Trend"]} Value shown here is the latest bucket's scoreDiff.`,
        },
        {
          name: "Weighted Win Rate",
          value: pct(timeAggregate.weightedWinRate),
          desc: METRIC_DOCS["Weighted Win Rate"],
        },
        {
          name: "Weighted Avg Score",
          value: num(timeAggregate.weightedScore),
          desc: METRIC_DOCS["Weighted Avg Score"],
        },
        {
          name: "Avg Games / Bucket",
          value: num(timeAggregate.gamesPerBucket, 2),
          desc: METRIC_DOCS["Avg Games / Bucket"],
        },
        {
          name: "Best Bucket",
          value: timeAggregate.bestBucket?.bucket || "-",
          desc: METRIC_DOCS["Best Bucket"],
        },
        {
          name: "Worst Bucket",
          value: timeAggregate.worstBucket?.bucket || "-",
          desc: METRIC_DOCS["Worst Bucket"],
        },
        {
          name: "Busiest Bucket",
          value: timeAggregate.busiestBucket?.bucket || "-",
          desc: METRIC_DOCS["Busiest Bucket"],
        },
      ],
    },
    {
      title: "Distribution & Match-Type Metrics",
      scope: "Team",
      items: [
        {
          name: "Mode Distribution",
          value: `${(viewDerived.modeBars || []).length} modes`,
          desc: `${METRIC_DOCS["Mode Distribution"]} (${(viewDerived.modeBars || []).map((m) => `${m.mode}:${m.replays}`).join(" | ") || "no data"}).`,
        },
        {
          name: "Mode Outcomes Split",
          value: `${(viewDerived.modeOutcomeBars || []).length} modes`,
          desc: METRIC_DOCS["Mode Outcomes Split"],
        },
        {
          name: "Win Rate by Team Color",
          value: `${pct(viewDerived.blueWinRate)} Blue | ${pct(viewDerived.orangeWinRate)} Orange`,
          desc: METRIC_DOCS["Win Rate by Team Color"],
        },
        {
          name: "Match Duration Distribution",
          value: `${(viewDerived.durationBuckets || []).reduce((sum, d) => sum + Number(d.games || 0), 0)} games`,
          desc: METRIC_DOCS["Match Duration Distribution"],
        },
        {
          name: "Goal Differential Distribution",
          value: `${(viewDerived.goalDiffBuckets || []).reduce((sum, d) => sum + Number(d.games || 0), 0)} games`,
          desc: METRIC_DOCS["Goal Differential Distribution"],
        },
        {
          name: "Match Type Rows",
          value: `${(viewDerived.byType || []).length} types`,
          desc: "Per type: games, winRate, avgScore, avgBigBoosts, avgSmallBoosts, avgBoostTotal. Computed from scoped matches grouped by `match_type`.",
        },
      ],
    },
    {
      title: "Synergy Metrics",
      scope: "Team",
      items: [
        {
          name: "Mates Synergy",
          value: `${(viewDerived.mateBars || []).length} mates`,
          desc: METRIC_DOCS["Mates Synergy"],
        },
        {
          name: "Best Mates",
          value: `${(viewDerived.mates || []).length} rows`,
          desc: METRIC_DOCS["Best Mates"],
        },
      ],
    },
    {
      title: "misc Metrics",
      scope: "Mixed",
      items: (viewDerived.miscStats || []).map((row) => ({
        name: row.label,
        value: String(row.value),
        desc: String(row.hint || "Derived misc counter."),
      })),
    },
  ].filter((section) => Array.isArray(section.items) && section.items.length > 0);
  const statsInfoTree = useMemo(() => {
    const scopeMap = new Map();
    const ensureScope = (scope) => {
      if (!scopeMap.has(scope)) scopeMap.set(scope, { scope, sections: new Map() });
      return scopeMap.get(scope);
    };
    const ensureSection = (scopeNode, title) => {
      if (!scopeNode.sections.has(title)) scopeNode.sections.set(title, { title, groups: new Map() });
      return scopeNode.sections.get(title);
    };
    const pushMetric = (sectionNode, group, metric) => {
      if (!sectionNode.groups.has(group)) sectionNode.groups.set(group, []);
      sectionNode.groups.get(group).push(metric);
    };

    statsInfoSections.forEach((section) => {
      const scopeNode = ensureScope(section.scope || "Other");
      const sectionNode = ensureSection(scopeNode, section.title);
      section.items.forEach((item) => {
        let group = "General";
        let metricName = item.name;
        if (section.title.startsWith("Feature Categories") && item.name.includes(" - ")) {
          const parts = item.name.split(" - ");
          group = parts[0] || "Category";
          metricName = parts.slice(1).join(" - ") || item.name;
        } else if (section.title.startsWith("Boost Metrics")) {
          if (item.name.startsWith("Boost Avg - ")) group = "Averages";
          else if (item.name.startsWith("Boost Win Avg - ") || item.name.startsWith("Boost Loss Avg - ")) group = "Win/Loss Split";
        } else if (section.title.startsWith("Time & Trend")) {
          if (item.name.includes("Bucket")) group = "Bucket Quality";
          else if (item.name.includes("Trend") || item.name.includes("Latest")) group = "Trend";
          else group = "Aggregate";
        }
        pushMetric(sectionNode, group, { name: metricName, desc: item.desc });
      });
    });

    return Array.from(scopeMap.values()).map((scopeNode) => ({
      scope: scopeNode.scope,
      sections: Array.from(scopeNode.sections.values()).map((sectionNode) => ({
        title: sectionNode.title,
        groups: Array.from(sectionNode.groups.entries()).map(([group, metrics]) => ({ group, metrics })),
      })),
    }));
  }, [statsInfoSections]);
  const live = loading && progress && progress.run_id === currentRunId ? progress : null;
  const queuedReplays = Number(live?.queued ?? summary.queued_replays ?? 0);
  const parsedReplays = Number(live?.parsed ?? summary.parsed_replays ?? 0);
  const failedReplays = Number(live?.failed ?? summary.failed_replays ?? 0);
  const matchedReplays = Number(live?.matched ?? summary.matched_replays ?? 0);
  const cacheHits = Number(live?.cache_hits ?? summary.cache_hits ?? 0);
  const cacheMisses = Number(live?.cache_misses ?? summary.cache_misses ?? 0);
  const processedFromProgress = Number(
    live?.processed ??
    ((summary.parsed_replays ?? 0) + (summary.failed_replays ?? 0))
  );
  const processedReplays = Math.max(
    0,
    Math.min(
      queuedReplays > 0 ? queuedReplays : processedFromProgress,
      processedFromProgress
    )
  );
  const processTotal = queuedReplays > 0 ? queuedReplays : 0;
  const processedPct = pctInt(processedReplays, processTotal);
  const stopRunId = String(currentRunId || progress?.run_id || "").trim();
  const chartGrid = theme === "light" ? "#d3e1f0" : "#233041";
  const chartTick = theme === "light" ? "#4b6078" : "#9db0c8";
  const failedByReason = summary.failed_by_reason || {};
  const failedExamples = summary.failed_examples || [];
  const successExamples = summary.success_examples || [];
  const successExamplesDisplay =
    successExamples.length > 0
      ? successExamples
      : stableRecent.slice(0, 25).map((r) => ({
        replay: r.id,
        from_cache: null,
        matched: true,
        player_name: r.player_name || "",
        result: r.won ? "win" : "loss",
        score: r.score,
      }));
  const failureRows = Object.entries(failedByReason).sort((a, b) => b[1] - a[1]);

  useEffect(() => {
    if (!selectedReplayIds.length) return;
    const available = new Set(stableRecent.map((r) => r.id));
    setSelectedReplayIds((prev) => prev.filter((id) => available.has(id)));
  }, [stableRecent, selectedReplayIds.length]);

  useEffect(() => {
    if (!typeOptions.includes(analysisDraftType)) setAnalysisDraftType("all");
  }, [typeOptions, analysisDraftType]);

  useEffect(() => {
    if (!modeOptions.includes(analysisDraftMode)) setAnalysisDraftMode("all");
  }, [modeOptions, analysisDraftMode]);

  useEffect(() => {
    setAnalysisStartDate(analysisDraftStartDate || "");
    setAnalysisEndDate(analysisDraftEndDate || "");
    setTypeFilter(analysisDraftType || "all");
    setModeFilter(analysisDraftMode || "all");
    setTimeTab(analysisDraftTimeTab || "day");
  }, [
    analysisDraftStartDate,
    analysisDraftEndDate,
    analysisDraftType,
    analysisDraftMode,
    analysisDraftTimeTab,
  ]);

  useEffect(() => {
    (async () => {
      try {
        const health = await getHealth();
        const startupFilters = {
          ...filters,
          demosDir: filters.demosDir || health.default_demos_dir || defaults.demosDir,
          cacheDir: filters.cacheDir || health.local_replay_store || defaults.cacheDir,
          rawDir: filters.rawDir || health.raw_replay_store || defaults.rawDir,
          playerId: filters.playerId || health.default_player_id || defaults.playerId,
          boxcarsExe: filters.boxcarsExe || health.boxcars_resolved || "",
        };
        if (!startupFilters.startDate && !startupFilters.endDate) {
          const range = quickDateRange(7);
          startupFilters.startDate = range.startDate;
          startupFilters.endDate = range.endDate;
        }
        setLoadQuickPreset(inferLoadQuickPreset(startupFilters.startDate, startupFilters.endDate));
        setFilters(startupFilters);

        const detectParams = {
          ...buildDetectParams(startupFilters),
        };

        const detect = await detectReplays(detectParams);
        const detected = Number(detect.detected_replays || 0);
        setDetectedReplays(detected);
        setAnalysisDraftStartDate("");
        setAnalysisDraftEndDate("");
        setAnalysisDraftType("all");
        setAnalysisDraftMode("all");
        setAnalysisDraftTimeTab("day");
        const newCount = Number(detect?.new_replays || 0);
        const totalCount = Number(detect?.total_replays || detected);
        const cachedCount = Math.max(0, totalCount - newCount);
        if (newCount > 0) {
          setStatus(`Startup scan complete: ${cachedCount} cached replay(s), ${newCount} new replay(s) to parse. Ready to parse.`);
        } else {
          setStatus(`Startup scan complete: ${cachedCount} cached replay(s), no new replay to parse. Ready to parse.`);
        }
      } catch (err) {
        setStatus(err?.response?.data?.detail || "Backend not reachable.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderRecentCell(r, colId) {
    const duration = Number(r.duration_seconds || 0);
    const mm = Math.floor(duration / 60);
    const ss = duration % 60;
    const renderPlayers = (detailPlayers, fallbackNames) => {
      const roster = normalizePlayerRoster(detailPlayers, fallbackNames);
      if (!roster.length) return "-";
      const nodes = [];
      roster.forEach((player, idx) => {
        const points = Number(player?.score);
        const hasPoints = Number.isFinite(points);
        nodes.push(
          <span key={`${player.name}-${idx}`} className="player-cell">
            <span>{hasPoints ? `${player.name} (${num(points, 0)})` : player.name}</span>
            <span className="platform-pill" title={platformTitle(player)}>
              {player.code}
            </span>
          </span>,
        );
        if (idx < roster.length - 1) {
          nodes.push(<span key={`sep-${idx}`}>, </span>);
        }
      });
      return <span>{nodes}</span>;
    };
    switch (colId) {
      case "date":
        return format(parseISO(r.date), "yyyy-MM-dd");
      case "map":
        return r.map_name || "-";
      case "type":
        return r.match_type || "-";
      case "mode":
        return r.game_mode || "-";
      case "result":
        return <span className={`pill ${r.won ? "win" : "loss"}`}>{r.won ? "Win" : "Loss"}</span>;
      case "scoreline":
        return `${num(r.team_score, 0)} - ${num(r.opponent_score, 0)}`;
      case "duration":
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      case "team_players":
        return renderPlayers(r.team_players, r.team_player_names);
      case "opponents":
        return renderPlayers(r.opponent_players, r.opponent_player_names);
      case "replay":
        return <span className="mono">{r.id}</span>;
      default:
        return "-";
    }
  }

  function handleRecentRowClick(replayId) {
    const id = String(replayId || "").trim();
    if (!id) return;
    const exists = selectedReplayIds.includes(id);
    const next = exists
      ? selectedReplayIds.filter((rid) => rid !== id)
      : [...selectedReplayIds, id];
    setSelectedReplayIds(next);
    if (!exists) {
      setFocusedReplayId(id);
      setStatsView("single");
      return;
    }
    if (focusedReplayId === id) {
      setFocusedReplayId(next[0] || "");
      if (!next.length && statsView === "single") {
        setStatsView("aggregate");
      }
    }
  }

  const statusPinned = topStatusPinned || scrollY <= 8;
  const heroBottom = heroRef.current?.getBoundingClientRect?.().bottom ?? 84;
  const topStatusTop = statusPinned ? 10 : Math.max(8, Math.round(heroBottom + 8));

  return (
    <div className="page">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <main className={`shell ${hasLoadedData ? "with-side-panels" : "loading-only"}`}>
        <header className="hero" ref={heroRef}>
          <div className="hero-top">
            {showTopStatus && statusPinned && (
              <div className="top-status top-status-inline" role="status" aria-live="polite">
                <span className="top-status-text">{status}</span>
                <span className="top-status-actions">
                  <button
                    type="button"
                    className="top-status-btn"
                    onClick={() => setTopStatusPinned((v) => !v)}
                    title={topStatusPinned ? "Unpin banner from top" : "Pin banner to top"}
                  >
                    {topStatusPinned ? "Unpin" : "Pin to top"}
                  </button>
                </span>
              </div>
            )}
            <div className="hero-actions">
              <button
                type="button"
                className="hero-btn ghost"
                onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </button>
              <button
                type="button"
                className="hero-btn ghost"
                onClick={toggleBoostTrail}
                title={boostTrailEnabled ? "Disable boost cursor trail" : "Enable boost cursor trail"}
              >
                <Activity size={14} />
                {boostTrailEnabled ? "Trail On" : "Trail Off"}
              </button>
              <button
                type="button"
                className="hero-btn ghost"
                onClick={() => setStatsInfoOpen(true)}
                title="Open full documentation for all dashboard stats."
              >
                <Info size={14} />
                Stats Info
              </button>
              <a
                className="hero-btn ghost"
                href="https://github.com/AloisTh1/RocketLeagueReplayDashboard"
                target="_blank"
                rel="noreferrer"
                title="Open GitHub repository"
              >
                <Github size={14} />
                GitHub
              </a>
            </div>
          </div>
          <p className="eyebrow">Rocket League Command Center</p>
          <h1>Replay Intelligence</h1>
          <p>Custom paths, username highlight, me-vs-others metrics, and export-ready analytics.</p>
        </header>
        {showTopStatus && !statusPinned && (
          <div
            className="top-status"
            role="status"
            aria-live="polite"
            style={{
              top: `${topStatusTop}px`,
              opacity: scrollY > 80 ? 0.94 : 1,
            }}
          >
            <span className="top-status-text">{status}</span>
            <span className="top-status-actions">
              <button
                type="button"
                className="top-status-btn"
                onClick={() => setTopStatusPinned((v) => !v)}
                title={topStatusPinned ? "Unpin banner from top" : "Pin banner to top"}
              >
                {topStatusPinned ? "Unpin" : "Pin to top"}
              </button>
            </span>
          </div>
        )}

        <section className="top-zone">
          <section className="cards panel cards-panel floating-global">
            {cards.map((c) => (
              <article className="card" key={c.label}>
                <div className="card-top">
                  <c.icon size={16} />
                  <span>{c.label}</span>
                  <span
                    className={`metric-scope-pill ${c.scope === "player" ? "player" : "team"}`}
                    title={
                      c.scope === "player"
                        ? "Player metric: uses selected player stats only."
                        : "Team metric: uses current replay selection aggregate."
                    }
                  >
                    {c.scope === "player" ? "Player" : "Team"}
                  </span>
                </div>
                <strong>{c.requiresPlayerId && !trackedPlayerId ? "" : c.value}</strong>
              </article>
            ))}
            <p className="scope-note">KPI cards include team overview + player metrics (player metrics require a Player ID).</p>
            <section className="global-nav">
              <div className="global-nav-title">Player</div>
              <label className="global-player-id">
                <span>Player ID <Tip text={"Your platform/player identifier used to select your row from each replay.\nHow to find it:\n1) Open Rocket League and load any recent replay in this dashboard.\n2) Open the generated replay JSON from the cache folder.\n3) Search your in-game name in PlayerStats.\n4) Copy OnlineID (or PlayerID.fields.Uid) and paste it here."} /></span>
                <input value={filters.playerId} onChange={(e) => setFilters({ ...filters, playerId: e.target.value })} />
              </label>
              {trackedPlayerId && (
                <p className="scope-note">
                  {`Tracking player ID: ${filters.playerId || "-"}${trackedPlayerName ? ` -> ${trackedPlayerName}` : ""} (${trackedRowsCount}/${activeRecent.length || 0} replay rows matched).`}
                </p>
              )}
              <div className="global-nav-title">Quick Access</div>
              <div className="global-nav-links">
                {quickLinks.map((item) => (
                  <a key={item.href} href={item.href}>{item.label}</a>
                ))}
              </div>
              <button
                type="button"
                className="mini-btn return-top-btn"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                Return To Top
              </button>
            </section>
          </section>

          <section className="panel controls">
            <details
              className="replay-config-dropdown"
              open={replayConfigOpen}
              onToggle={(e) => setReplayConfigOpen(e.currentTarget.open)}
            >
              <summary className="panel-title replay-config-summary"><Filter size={18} /> Replay Config <Tip text="Main data-source setup and parsing controls. Configure replay paths, parser options, and run ingestion." /></summary>
              <section className="config-section">
                <div className="analysis-grid replay-config-grid">
                  <div className="quick-row analysis-quick-row field-run-controls">
                    <button
                      className={`load-replays-btn ${loading ? "running" : ""}`}
                      onClick={loading ? () => handleStopParsing(stopRunId) : runAnalysis}
                      disabled={loading ? false : !canRunParse}
                      title={loading ? "Request graceful stop for the active parsing run." : (!canRunParse ? `Missing: ${missingRequiredParseFields.join(", ")}` : "Scan and parse replays, then refresh dashboard data.")}
                    >
                      {loading ? "Stop parsing" : "Load replays"}
                    </button>
                  </div>
                  <div className="quick-row analysis-quick-row field-quick-dates">
                    <span>Quick load dates</span>
                    <div className="quick-date-buttons">
                      {[1, 7, 30, 90, 0].map((days) => (
                        <button
                          key={`load-q-${days}`}
                          type="button"
                          className={`mini-btn ghost ${loadQuickPreset === days ? "active" : ""}`}
                          onClick={() => applyQuickDaysLoad(days)}
                        >
                          {days === 0 ? "All" : `${days}D`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="field-load-start">Load start date <Tip text="Replay scan lower bound used when loading/parsing from disk." /><input type="date" value={filters.startDate} onChange={(e) => { setFilters({ ...filters, startDate: e.target.value }); }} /></label>
                  <label className="field-load-end">Load end date <Tip text="Replay scan upper bound used when loading/parsing from disk." /><input type="date" value={filters.endDate} onChange={(e) => { setFilters({ ...filters, endDate: e.target.value }); }} /></label>
                  <label className="field-workers">Parse workers <Tip text="Number of parallel replay parsers. Higher is faster but uses more CPU/RAM." /><input type="number" min="1" max="16" value={filters.workers} onChange={(e) => setFilters({ ...filters, workers: clampInt(e.target.value, 1, 16, 4) })} /></label>
                  <label className="field-replay-count">Replay count <Tip text="If > 0, parse only the newest N replays. If 0, parse all detected replays." /><input type="number" min="0" max="2000" value={filters.parseCount} onChange={(e) => setFilters({ ...filters, parseCount: clampInt(e.target.value, 0, 2000, 40) })} /></label>
                  <label className="path-field field-demos">Demos directory <span className="required-mark">*</span>
                    <div className="input-row">
                      <input required aria-required="true" value={filters.demosDir} onChange={(e) => setFilters({ ...filters, demosDir: e.target.value })} />
                      <button type="button" className="mini-btn" onClick={browseDemosDir}>Browse</button>
                    </div>
                  </label>
                  <label className="path-field field-boxcars">Boxcars exe <span className="required-mark">*</span>
                    <div className="input-row">
                      <input required aria-required="true" value={filters.boxcarsExe} onChange={(e) => setFilters({ ...filters, boxcarsExe: e.target.value })} />
                      <button type="button" className="mini-btn" onClick={browseBoxcarsExe}>Browse</button>
                    </div>
                  </label>
                  {Boolean(filters.writeCache) && (
                    <label className="path-field field-cache">Cache directory <span className="required-mark">*</span>
                      <div className="input-row">
                        <input value={filters.cacheDir} onChange={(e) => setFilters({ ...filters, cacheDir: e.target.value })} />
                        <button type="button" className="mini-btn" onClick={browseCacheDir}>Browse</button>
                      </div>
                    </label>
                  )}
                  {Boolean(filters.writeCache) && (
                    <label className="path-field field-raw">Raw directory <span className="required-mark">*</span>
                      <div className="input-row">
                        <input value={filters.rawDir} onChange={(e) => setFilters({ ...filters, rawDir: e.target.value })} />
                        <button type="button" className="mini-btn" onClick={browseRawDir}>Browse</button>
                      </div>
                    </label>
                  )}
                  <div className="field-cache-controls">
                    <label className="cache-field field-write-cache">
                      <span>Write to cache <Tip text="When enabled, newly parsed replays are saved to cache. Cached replays are always read automatically. Cache and Raw directories become required." /></span>
                      <button
                        type="button"
                        className={`mini-btn cache-btn ${filters.writeCache ? "active" : ""}`}
                        onClick={() => setFilters({ ...filters, writeCache: !filters.writeCache })}
                        title="Toggle cache writing on/off."
                      >
                        {filters.writeCache ? "Enabled" : "Disabled"}
                      </button>
                    </label>
                    {Boolean(filters.writeCache) && (
                      <div className="config-actions-row field-cache-actions">
                        <button className="ghost" onClick={handleOpenCacheDir} disabled={loading} title="Open parsed replay cache folder on your machine.">Open cache folder</button>
                        <button className="ghost" onClick={handleOpenRawDir} disabled={loading} title="Open raw boxcars JSON output folder.">Open raw folder</button>
                        <button className="ghost" onClick={handleClearCache} disabled={loading} title="Delete cached parsed/raw replay data for a clean reparse.">Clear cache</button>
                      </div>
                    )}
                  </div>
                  {!canRunParse && (
                    <div className="required-note">Required to run parse: {missingRequiredParseFields.join(", ")}.</div>
                  )}
                </div>
              </section>
              <section className="run-indicators">
                <div className="indicator-head">
                  <div className="indicator-title">
                    <Activity size={16} /> Parse Indicators
                  </div>
                  {loading ? (
                    <div className="running-pill">
                      <span className="wheel" />
                      Running {num(runElapsed, 2)}s
                    </div>
                  ) : (
                    <div className="running-pill idle">Idle</div>
                  )}
                </div>

                <div className="indicator-stats">
                  <div><span>Processed</span><strong>{processedReplays}/{queuedReplays || "-"}</strong></div>
                  <div><span>Parsed</span><strong>{parsedReplays}</strong></div>
                  <div><span>Failed</span><strong>{failedReplays}</strong></div>
                  <div><span>Matched</span><strong>{matchedReplays}</strong></div>
                  <div><span>Cache Hits</span><strong>{cacheHits}</strong></div>
                  <div><span>Cache Misses</span><strong>{cacheMisses}</strong></div>
                </div>
                <div className="cache-mode-banner">
                  Cache write mode for this run:
                  <strong className={filters.writeCache ? "on" : "off"}>
                    {filters.writeCache ? " ENABLED (store new parses)" : " DISABLED (read-only cache)"}
                  </strong>
                </div>

                <div className="bar-block">
                  <div className="bar-label">Replay processing</div>
                  <div className={`progress-bar progress-primary ${loading ? "indeterminate" : ""}`}>
                    <span className="bar processed" style={{ width: `${processedPct}%` }} />
                  </div>
                  <div className="bar-legend">
                    <span><i className="dot parsed" />Parsed {parsedReplays}</span>
                    <span><i className="dot failed" />Failed {failedReplays}</span>
                    <span><i className="dot processed" />Processed {processedPct.toFixed(2)}%</span>
                    <span><i className="dot remaining" />Remaining {Math.max(0, queuedReplays - processedReplays)}</span>
                  </div>
                </div>

                <div className="failure-box">
                  <div className="bar-label">Parse outcomes</div>
                  <div className="failure-summary">
                    <span className="ok-pill">OK: {parsedReplays}</span>
                    <span className="fail-pill">Failed: {failedReplays}</span>
                  </div>
                  <details className="failure-details success-details">
                    <summary>
                      {parsedReplays > 0
                        ? `Show success details (${parsedReplays})`
                        : "Show success details"}
                    </summary>
                    {successExamplesDisplay.length > 0 ? (
                      <div className="failure-examples">
                        {successExamplesDisplay.slice(0, 12).map((item) => (
                          <div key={`${item.replay}-ok`} className="failure-item success-item">
                            <div className="mono">{item.replay}</div>
                            <div className="failure-item-meta">
                              {item.matched ? `matched ${item.player_name || ""}` : "parsed but not matched"}
                              {item.from_cache === null ? "" : ` | ${item.from_cache ? "cache" : "fresh"}`}
                              {item.result ? ` | ${item.result}` : ""}
                            </div>
                            {item.matched && <div className="failure-item-error">score: {num(item.score)}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="failure-empty">No success details recorded yet.</p>
                    )}
                  </details>
                  <details className="failure-details">
                    <summary>
                      {failedReplays > 0
                        ? `Show failure details (${failedReplays})`
                        : "Show failure details"}
                    </summary>
                    {failureRows.length > 0 ? (
                      <ul className="failure-reasons">
                        {failureRows.map(([reason, count]) => (
                          <li key={reason}>
                            <strong>{reason}</strong>
                            <span>{count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="failure-empty">No failure reason recorded yet.</p>
                    )}
                    {failedExamples.length > 0 && (
                      <div className="failure-examples">
                        {failedExamples.slice(0, 12).map((item) => (
                          <div key={`${item.replay}-${item.reason}`} className="failure-item">
                            <div className="mono">{item.replay}</div>
                            <div className="failure-item-meta">{item.reason}</div>
                            <div className="failure-item-error">{item.error}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>
                </div>
              </section>
            </details>
            <p className="status">{status}</p>
          </section>
        </section>

        <section id="recent-matches" className="panel">
          <div className="panel-title"><Activity size={18} /> Recent Matches <Tip text="Replay table used for search, sorting, and selecting matches for single-match analysis." /></div>
          <div className="quick-row">
            <button type="button" className="mini-btn ghost" onClick={() => setRecentFullColumns((v) => !v)} title="Toggle between compact truncated cells and full multi-line table cells.">
              {recentFullColumns ? "Truncate columns" : "Full column text"}
            </button>
            <button
              type="button"
              className="mini-btn ghost"
              title="Clear selected rows and return to aggregate stats view."
              onClick={() => {
                setSelectedReplayIds([]);
                setFocusedReplayId("");
                setStatsView("aggregate");
              }}
              disabled={!selectedReplayIds.length}
            >
              Clear selection
            </button>
            <span>Selected for analysis: {selectedReplayIds.length ? selectedReplayIds.length : "All"}</span>
            <span>Click a row to open single match analysis.</span>
          </div>
          <div className="recent-table-filters">
            <label className="recent-search">
              <span>Search matches</span>
              <input
                placeholder="Replay id, map, players..."
                value={tableSearch}
                title="Filter rows by replay id, map, mode, and player names."
                onChange={(e) => setTableSearch(e.target.value)}
              />
            </label>
            <select value={tableResultFilter} title="Filter table rows by result outcome." onChange={(e) => setTableResultFilter(e.target.value)}>
              <option value="all">All results</option>
              <option value="win">Wins</option>
              <option value="loss">Losses</option>
            </select>
            <button
              type="button"
              className="mini-btn ghost"
              title="Reset search text and result filter."
              onClick={() => {
                setTableSearch("");
                setTableResultFilter("all");
              }}
            >
              Reset table filters
            </button>
          </div>
          <div className="platform-legend" aria-label="Platform legend">
            {PLATFORM_LEGEND.map((entry) => (
              <span key={`legend-${entry.code}`} className="platform-legend-item">
                <span className="platform-pill" title={entry.label}>{entry.code}</span>
                <span>{entry.label}</span>
              </span>
            ))}
          </div>
          <details className="failure-details" style={{ marginTop: 8 }}>
            <summary>Choose columns</summary>
            <div className="impact-chips">
              {RECENT_COLUMN_DEFS.map((col) => {
                const checked = visibleRecentColumns.includes(col.id);
                return (
                  <label key={col.id} className="impact-chip">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setVisibleRecentColumns((prev) => {
                            if (checked) {
                              const next = prev.filter((id) => id !== col.id);
                              return next.length ? next : prev;
                            }
                            return [...prev, col.id];
                          })
                        }
                      />
                      <span>{col.label}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </details>
          <div className={`table-wrap ${recentFullColumns ? "table-full-cols" : ""}`}>
            <table>
              <thead>
                <tr>
                  {RECENT_COLUMN_DEFS.filter((c) => visibleRecentColumns.includes(c.id)).map((c) => (
                    <th key={`h-${c.id}`}>
                      <button
                        type="button"
                        className={`table-sort-btn ${recentSort.col === c.id ? "active" : ""}`}
                        aria-label={`Sort by ${c.label} (${recentSort.col === c.id && recentSort.dir === "asc" ? "descending" : "ascending"})`}
                        onClick={() =>
                          setRecentSort((prev) => {
                            if (prev.col === c.id) {
                              return { col: c.id, dir: prev.dir === "asc" ? "desc" : "asc" };
                            }
                            return { col: c.id, dir: c.id === "date" ? "desc" : "asc" };
                          })
                        }
                      >
                        <span className="table-sort-label">{c.label}</span>
                        <span className={`table-sort-arrow ${recentSort.col === c.id ? "active" : ""}`}>
                          {recentSort.col === c.id ? (recentSort.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRecentTableRows.map((r) => {
                  const selected = selectedReplayIds.includes(r.id);
                  const rowTracked = isTrackedRow(r, trackedPlayerId);
                  return (
                    <tr
                      key={r.id}
                      className={`${rowTracked ? "row-highlight " : ""}${selected ? "row-selected" : ""}`}
                      onClick={() => handleRecentRowClick(r.id)}
                    >
                      {RECENT_COLUMN_DEFS.filter((c) => visibleRecentColumns.includes(c.id)).map((c) => (
                        <td key={`${r.id}-${c.id}`}>{renderRecentCell(r, c.id)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="recent-table-footer">
            <span>Rows shown: {visibleRecentTableRows.length}/{sortedRecentTableRows.length}</span>
            <label className="recent-table-max-rows">
              <span>Max table rows</span>
              <input
                type="number"
                min="1"
                max="5000"
                value={maxTableRows}
                title="Maximum number of rows rendered in the table."
                onChange={(e) => setMaxTableRows(clampInt(e.target.value, 1, 5000, 5))}
              />
            </label>
            <div className="recent-pagination">
              <button
                type="button"
                className="mini-btn ghost"
                disabled={tablePageSafe <= 1}
                onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span>Page {tablePageSafe}/{tableTotalPages}</span>
              <button
                type="button"
                className="mini-btn ghost"
                disabled={tablePageSafe >= tableTotalPages}
                onClick={() => setTablePage((p) => Math.min(tableTotalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title"><Filter size={18} /> Stats View <Tip text="Switch between aggregate analytics and a focused single-match breakdown from selected table rows." /></div>
          <div className="tabs-row">
            <button
              type="button"
              className={`tab-btn ${statsView === "aggregate" ? "active" : ""}`}
              title="Aggregate across the current analysis filter scope."
              onClick={() => setStatsView("aggregate")}
            >
              Aggregate stats
            </button>
            <button
              type="button"
              className={`tab-btn ${statsView === "single" ? "active" : ""}`}
              title="Focus analytics on one selected replay."
              onClick={() => setStatsView("single")}
            >
              Single match analysis
            </button>
          </div>
          <p className="status">
            {statsView === "single"
              ? (focusedReplay
                  ? `Single replay selected: ${focusedReplay.id} (${focusedReplay.player_name || "Unknown player"}).`
                  : "Select a replay row in Recent Matches to analyze one match.")
              : "Aggregate stats use current analysis filters and selected replay scope."}
          </p>
        </section>

        {statsView === "aggregate" && (
        <section className="panel analysis-panel floating-analysis">
          <div className="panel-title"><Filter size={18} /> Analysis Filters <Tip text="Client-side filters that reshape charts and tables without re-parsing replay files." /></div>
          <div className="analysis-grid">
            <label>Analysis start date <Tip text="Client-side date filter for charts/tables only (does not rescan disk)." /><input type="date" value={analysisDraftStartDate} onChange={(e) => { setAnalysisDraftStartDate(e.target.value); setAnalysisQuickPreset(null); }} /></label>
            <label>Analysis end date <Tip text="Client-side date filter for charts/tables only (does not rescan disk)." /><input type="date" value={analysisDraftEndDate} onChange={(e) => { setAnalysisDraftEndDate(e.target.value); setAnalysisQuickPreset(null); }} /></label>
          </div>
          <div className="filter-menu-block">
            <div className="filter-menu-label">Match type</div>
            <div className="filter-btn-row">
              {typeOptions.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`filter-btn ${analysisDraftType === v ? "active" : ""}`}
                  onClick={() => setAnalysisDraftType(v)}
                >
                  {v === "all" ? "All" : v}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-menu-block">
            <div className="filter-menu-label">Game mode</div>
            <div className="filter-btn-row">
              {modeOptions.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`filter-btn ${analysisDraftMode === v ? "active" : ""}`}
                  onClick={() => setAnalysisDraftMode(v)}
                >
                  {v === "all" ? "All" : v}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-menu-block">
            <div className="filter-menu-label">Time view</div>
            <div className="tabs-row">
              {Object.entries(tabMeta).map(([key, meta]) => (
                <button
                  type="button"
                  key={key}
                  className={`tab-btn ${analysisDraftTimeTab === key ? "active" : ""}`}
                  title={meta.tip}
                  aria-label={`${meta.label}. ${meta.tip}`}
                  onClick={() => setAnalysisDraftTimeTab(key)}
                >
                  {meta.short}
                </button>
              ))}
            </div>
          </div>
          <div className="quick-row analysis-quick-row">
            <button type="button" className="mini-btn ghost" onClick={resetAnalysisFilters} disabled={loading}>Reset filters</button>
            <span>Quick dates</span>
            <div className="quick-date-buttons">
              {[1, 7, 30, 90, 0].map((days) => (
                <button
                  key={`analysis-q-${days}`}
                  type="button"
                  className={`mini-btn ghost ${analysisQuickPreset === days ? "active" : ""}`}
                  onClick={() => applyQuickDaysAnalysis(days)}
                >
                  {days === 0 ? "All" : `${days}D`}
                </button>
              ))}
            </div>
            <button type="button" className="mini-btn ghost" onClick={applyAnalysisDatesFromLoad}>Use load range</button>
            <button type="button" className="mini-btn ghost" onClick={clearAnalysisDates}>Clear</button>
          </div>
          <div className="analysis-export-row">
            <button className="ghost" onClick={() => saveCsv(activeRecent)} title="Export currently visible match rows to CSV."><Download size={15} /> Export CSV</button>
            <button className="ghost" onClick={() => exportPng(true)} disabled={loading} title="Capture the dashboard as a PNG screenshot."><Download size={15} /> Export PNG</button>
            <button className="ghost" onClick={() => exportPdf({ theme })} title="Export key dashboard content to PDF."><Download size={15} /> Export PDF</button>
          </div>
        </section>
        )}
        <section className="panel analytics-layout-panel">
          <div className="panel-title"><Filter size={18} /> Graph Layout <Tip text="Choose which analytics group to display so you can focus on one part of the dashboard." /></div>
          <div className="tabs-row analytics-view-tabs">
            {ANALYTICS_VIEW_DEFS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`tab-btn ${analyticsView === entry.id ? "active" : ""}`}
                title={entry.tip}
                onClick={() => setAnalyticsView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="status">
            {analyticsView === "all"
              ? "All graph groups are visible."
              : `Focused view: ${ANALYTICS_VIEW_DEFS.find((entry) => entry.id === analyticsView)?.label || "Overview"}.`}
            {" "}Most charts below use team metrics unless marked otherwise.
          </p>
        </section>
        <section className="chart-grid">
          {shouldShowAnalytics("overview") && (
          <article id="stats-categories" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Filter size={18} /> Feature Categories <span className={`metric-scope-pill ${metricsScope === "player" ? "player" : "team"}`} title={metricsScope === "player" ? "Player metric: values are computed from the selected player fields per replay." : "Team metric: values are computed from team stats in each replay."}>{metricsScope === "player" ? "Player" : "Team"}</span> <Tip text="Category rollup of offense, defense, teamplay, impact, and context metrics." /></div>
            <div className="scope-switch-row">
              <button type="button" className={`mini-btn ghost ${metricsScope === "team" ? "active" : ""}`} onClick={() => setMetricsScope("team")}>Team</button>
              <button type="button" className={`mini-btn ghost ${metricsScope === "player" ? "active" : ""}`} onClick={() => setMetricsScope("player")}>Player</button>
            </div>
            <div className="impact-chips">
              {(scopedCategories || []).map((cat) => (
                <div key={cat.id} className="impact-chip">
                  <div>{cat.label}</div>
                  <strong>{cat.metrics?.[0]?.value || "-"}</strong>
                  <span>
                    {(cat.metrics || [])
                      .slice(1)
                      .map((m) => `${m.label}: ${m.value}`)
                      .join(" | ")}
                  </span>
                </div>
              ))}
            </div>
          </article>
          )}
          {shouldShowAnalytics("boost") && (
          <article id="boost-metrics" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Gauge size={18} /> Boost Metrics <span className={`metric-scope-pill ${metricsScope === "player" ? "player" : "team"}`} title={metricsScope === "player" ? "Player metric: boost stats for the tracked player in each replay." : "Team metric: totals/averages across the selected team in each replay."}>{metricsScope === "player" ? "Player" : "Team"}</span> <Tip text="Compares average big/small/total boost and win-vs-loss boost behavior." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={scopedBoostBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="metric" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip formatter={(value) => num(value, 2)} />
                  <Bar dataKey="avg" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={scopedBoostWinLoss}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="metric" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip formatter={(value) => num(value, 2)} />
                  <Bar dataKey="win" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="loss" fill="#fb7185" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="win-trend" className="panel chart-panel">
            <div className="panel-title"><CalendarRange size={18} /> {tabMeta[timeTab].label} Win Trend <Tip text="Win-rate trajectory for the currently selected time bucket granularity." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={activeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} domain={[0, 1]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="winRate" stroke="#4ade80" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="time-aggregate" className="panel chart-panel">
            <div className="panel-title"><Gauge size={18} /> {tabMeta[timeTab].label} Aggregate Insights <Tip text="Weighted summary cards for best/worst/busiest periods and overall weighted performance." /></div>
            <div className="impact-chips">
              <div className="impact-chip">
                <div>Weighted Win Rate</div>
                <strong>{pct(timeAggregate.weightedWinRate)}</strong>
                <span>Across {timeAggregate.buckets} {tabMeta[timeTab].short.toLowerCase()} buckets</span>
              </div>
              <div className="impact-chip">
                <div>Weighted Avg Score</div>
                <strong>{num(timeAggregate.weightedScore)}</strong>
                <span>Uses games-per-bucket weighting</span>
              </div>
              <div className="impact-chip">
                <div>Avg Games / Bucket</div>
                <strong>{num(timeAggregate.gamesPerBucket, 2)}</strong>
                <span>Current filters + date range only</span>
              </div>
              <div className="impact-chip">
                <div>Best {tabMeta[timeTab].short}</div>
                <strong>{timeAggregate.bestBucket?.bucket || "-"}</strong>
                <span>{timeAggregate.bestBucket ? `${pct(timeAggregate.bestBucket.winRate)} | ${timeAggregate.bestBucket.games} games` : "No data"}</span>
              </div>
              <div className="impact-chip">
                <div>Worst {tabMeta[timeTab].short}</div>
                <strong>{timeAggregate.worstBucket?.bucket || "-"}</strong>
                <span>{timeAggregate.worstBucket ? `${pct(timeAggregate.worstBucket.winRate)} | ${timeAggregate.worstBucket.games} games` : "No data"}</span>
              </div>
              <div className="impact-chip">
                <div>Busiest {tabMeta[timeTab].short}</div>
                <strong>{timeAggregate.busiestBucket?.bucket || "-"}</strong>
                <span>{timeAggregate.busiestBucket ? `${timeAggregate.busiestBucket.games} games | score ${num(timeAggregate.busiestBucket.avgScore)}` : "No data"}</span>
              </div>
            </div>
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="score-momentum" className="panel chart-panel">
            <div className="panel-title"><Gauge size={18} /> {tabMeta[timeTab].label} Score Momentum <Tip text="Average score over time, showing upward/downward momentum by the selected time view." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={activeTrend}>
                  <defs>
                    <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="avgScore" stroke="#f59e0b" fill="url(#scoreFill)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="score-diff" className="panel chart-panel">
            <div className="panel-title"><Radar size={18} /> {tabMeta[timeTab].label} Score Diff vs Others <Tip text="How far above or below the lobby average your score is in each period." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={activeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="scoreDiff" stroke="#38bdf8" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("other") && (
          <article id="impactful-stats" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Gauge size={18} /> Impactful Stats (Concise) <span className={`metric-scope-pill ${metricsScope === "player" ? "player" : "team"}`} title={metricsScope === "player" ? "Player metric: compares selected player averages in wins versus losses." : "Team metric: compares team averages in wins versus losses."}>{metricsScope === "player" ? "Player" : "Team"}</span> <Tip text="Top metrics with the largest average difference between wins and losses." /></div>
            <div className="impact-chips">
              {scopedImpactStats.slice(0, 6).map((m) => (
                <div key={m.label} className="impact-chip">
                  <div>{m.label}</div>
                  <strong>{signed(m.delta)}</strong>
                  <span>W {num(m.winAvg)} | L {num(m.lossAvg)}</span>
                </div>
              ))}
            </div>
          </article>
          )}
          {shouldShowAnalytics("other") && (
          <article id="grouped-match-type" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Filter size={18} /> Grouped by Match Type <span className="metric-scope-pill team" title="Team metric: grouped averages are computed from team stats in each replay.">Team</span> <Tip text="Table view summarizing performance per match type with win rate, score, and boost averages." /></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Games</th>
                    <th>Win Rate</th>
                    <th>Avg Score</th>
                    <th>Avg Big Boosts</th>
                    <th>Avg Small Boosts</th>
                    <th>Avg Total Boost</th>
                  </tr>
                </thead>
                <tbody>
                  {viewDerived.byType.slice(0, 20).map((r) => (
                    <tr key={r.type}>
                      <td>{r.type}</td>
                      <td>{r.games}</td>
                      <td>{pct(r.winRate)}</td>
                      <td>{num(r.avgScore)}</td>
                      <td>{num(r.avgBigBoosts)}</td>
                      <td>{num(r.avgSmallBoosts)}</td>
                      <td>{num(r.avgBoostTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          )}
          {shouldShowAnalytics("distribution") && (
          <article id="mode-distribution" className="panel chart-panel">
            <div className="panel-title"><Radar size={18} /> Mode Distribution <Tip text="Distribution of games played by mode under current analysis filters." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={viewDerived.modeBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="mode" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="replays" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("distribution") && (
          <article className="panel chart-panel">
            <div className="panel-title"><Radar size={18} /> Mode Outcomes Split <Tip text="Per mode, split games into wins and losses to compare consistency by queue/mode." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={viewDerived.modeOutcomeBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="mode" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="wins" stackId="outcomes" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="losses" stackId="outcomes" fill="#fb7185" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("distribution") && (
          <article className="panel chart-panel">
            <div className="panel-title"><Trophy size={18} /> Win Rate by Team Color <Tip text="Win-rate comparison when spawning on blue versus orange side." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={viewDerived.colorWinBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="color" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="winRatePct" radius={[6, 6, 0, 0]}>
                    {viewDerived.colorWinBars.map((entry) => (
                      <Cell key={`color-${entry.color}`} fill={entry.color === "Orange" ? "#f97316" : "#38bdf8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("distribution") && (
          <article className="panel chart-panel">
            <div className="panel-title"><CalendarRange size={18} /> Match Duration Distribution <Tip text="Bucketed match-duration distribution based on replay elapsed time." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={viewDerived.durationBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === "Win %") return `${num(value, 2)}%`;
                      return value;
                    }}
                  />
                  <Bar yAxisId="left" dataKey="games" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="winRatePct"
                    name="Win %"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("distribution") && (
          <article className="panel chart-panel">
            <div className="panel-title"><Gauge size={18} /> Goal Differential Distribution <Tip text="Distribution of score margins (team score minus opponent score), clamped from <=-5 to >=5." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={viewDerived.goalDiffBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis dataKey="diff" tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="games" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
          )}
          {shouldShowAnalytics("synergy") && (
          <article id="mates-synergy" className="panel chart-panel">
            <div className="panel-title"><Activity size={18} /> Mates Synergy (Top 10) <Tip text="Top teammates by games, with paired win rate to highlight chemistry." /></div>
            {viewDerived.mateBars.length > 0 ? (
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={viewDerived.mateBars}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="mate" tick={{ fill: chartTick, fontSize: 11 }} interval={0} angle={-22} textAnchor="end" height={70} />
                    <YAxis yAxisId="left" tick={{ fill: chartTick, fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTick, fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip />
                    <Bar yAxisId="left" dataKey="games" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                    <Bar yAxisId="right" dataKey="winRate" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="failure-empty">Mate synergy needs at least 2 games with the same teammate.</p>
            )}
          </article>
          )}
          {shouldShowAnalytics("synergy") && (
          <article id="best-mates" className="panel chart-panel wide-table-panel">
            <div className="panel-title"><Trophy size={18} /> Best Mates <Tip text="Expanded teammate leaderboard with volume, wins, rate, and score deltas." /></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mate</th>
                    <th>Games</th>
                    <th>Wins</th>
                    <th>Win Rate</th>
                    <th>Avg Score</th>
                    <th>Score vs Mate</th>
                  </tr>
                </thead>
                <tbody>
                  {viewDerived.mates.slice(0, 40).map((m) => (
                    <tr key={m.name} id={toAnchorId(m.name, "mate")}>
                      <td>{m.name}</td>
                      <td>{m.games}</td>
                      <td>{m.wins}</td>
                      <td>{pct(m.winRate)}</td>
                      <td>{num(m.avgScore)}</td>
                      <td>{signed(m.avgScoreDiffVsMate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          )}
        </section>

        <details id="misc-stats" className="panel wtf-dropdown">
          <summary className="panel-title wtf-summary"><Radar size={18} /> misc ({viewDerived.miscStats.length}) <Tip text="Fun/quirky derived counters from your filtered replay set." /></summary>
          <div className="wtf-grid">
            {viewDerived.miscStats.map((s) => (
              <article key={s.label} className="wtf-item" title={s.hint}>
                <div className="wtf-label">{s.label}</div>
                <strong>{s.value}</strong>
                <div className="wtf-hint">{s.hint}</div>
              </article>
            ))}
          </div>
        </details>
      </main>
      {statsInfoOpen && (
        <div
          className="stats-info-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Stats info"
          onClick={() => setStatsInfoOpen(false)}
        >
          <section className="stats-info-modal panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">
              <Info size={18} /> Stats Info
              <span className="metric-scope-pill team" title="Documentation scope of each section.">Glossary</span>
            </div>
            <p className="status">
              Live glossary for the current view. Each row shows metric name and exact formula/source fields with a sample data extract.
            </p>
            <div className="stats-info-tree">
              {statsInfoTree.map((scopeNode) => (
                <details key={scopeNode.scope} className="stats-tree-scope" open>
                  <summary>{scopeNode.scope}</summary>
                  <div className="stats-tree-body">
                    {scopeNode.sections.map((section) => (
                      <details key={`${scopeNode.scope}-${section.title}`} className="stats-tree-section">
                        <summary>{section.title}</summary>
                        <div className="stats-tree-body">
                          {section.groups.map((groupNode) => (
                            <details key={`${section.title}-${groupNode.group}`} className="stats-tree-group">
                              <summary>{groupNode.group}</summary>
                              <div className="stats-info-rows">
                                {groupNode.metrics.map((metric) => (
                                  <div key={`${section.title}-${groupNode.group}-${metric.name}`} className="stats-info-row">
                                    <div className="stats-info-name">{metric.name}</div>
                                    <div className="stats-info-desc">{metric.desc}</div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <div className="stats-info-actions">
              <button type="button" className="mini-btn" onClick={() => setStatsInfoOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      {boostTrailEnabled && (
        <div className="boost-trail-layer" aria-hidden="true">
          <div className="boost-fuel-hud">
            <div className="boost-fuel-label">Alpha Boost</div>
            <div className="boost-fuel-bar">
              <span className="boost-fuel-fill" style={{ width: `${Math.max(0, Math.min(100, boostFuel))}%` }} />
            </div>
            <strong>{Math.round(boostFuel)}</strong>
          </div>
          {boostPads.map((pad) => (
            <span
              key={`pad-${pad.id}`}
              className={`boost-pad ${pad.active ? "active" : "cooldown"} ${pad.value >= 30 ? "big" : "small"}`}
              style={{
                left: `${pad.x}px`,
                top: `${pad.y}px`,
                width: `${pad.size}px`,
                height: `${pad.size}px`,
              }}
            />
          ))}
          {boostTrail.map((p) => (
            <span
              key={p.id}
              className="boost-trail-dot"
              style={{
                left: `${p.x}px`,
                top: `${p.y}px`,
                "--dx": `${p.dx}px`,
                "--dy": `${p.dy}px`,
              }}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        className="scroll-top-fab"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Return to top"
        title="Return to top"
      >
        Top
      </button>
    </div>
  );
}
