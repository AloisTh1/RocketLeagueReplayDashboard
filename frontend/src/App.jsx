import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Activity, CalendarRange, Download, Filter, Gauge, Github, Info, Moon, Radar as RadarIcon, Sun, Trophy } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar as RadarSeries,
  RadarChart,
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
import { clampInt, num, pct, pctInt, signed, toAnchorId } from "./app/utils/formatters";
import { exportPdf, saveCsv } from "./app/utils/exporters";
import { useBoostTrail } from "./app/hooks/useBoostTrail";
import { computeDerived } from "./app/derived";
import {
  ANALYTICS_VIEW_DEFS,
  CATEGORY_DOCS,
  METRIC_DOCS,
  PLATFORM_LEGEND,
  RECENT_COLUMN_DEFS,
  RECENT_COLUMNS_KEY,
  RECENT_TABLE_MAX_ROWS_KEY,
  TAB_META,
} from "./features/dashboard/constants";
import { didPlayerWin, findPlayerMetric, isTrackedRow, normalizeIdentity, resolvePerspective } from "./features/dashboard/playerTracking";
import { buildQuickLinks } from "./features/dashboard/quickLinks";
import { filterRecentRows, paginateRecentRows, sortRecentRows } from "./features/dashboard/recentTable";
import { inferQuickPreset, quickDateRange } from "./features/dashboard/dateRanges";
import { MAP_WINRATE_PRIMARY_KEY, MAP_WINRATE_SECONDARY_KEY, formatMapAxisLabel, selectMapWinRateChartRows } from "./features/dashboard/distribution";
import { Tip } from "./features/dashboard/components/Tip";
import { PlayerTrackingCallout } from "./features/dashboard/components/PlayerTrackingCallout";
import { PlayerIdPickerModal } from "./features/dashboard/components/PlayerIdPickerModal";
import { RecentMatchesSection } from "./features/dashboard/components/RecentMatchesSection";
import { StatsInfoModal } from "./features/dashboard/components/StatsInfoModal";
import { KPI_MARKDOWN_DOCS, kpiDoc } from "./features/dashboard/kpiDocs";
import { buildTopKpiCards, computeTrackedPlayerOverview } from "./features/dashboard/kpis";
import {
  buildPlayerContributionTrend,
  buildPlayerTrend,
  buildRegressionSeries,
  buildMateComparisonTrend,
  buildMateContributionTrend,
} from "./features/dashboard/trends";

export default function App() {
  const slurpIndicator = (big, small) => {
    const safeBig = Number(big);
    const safeSmall = Number(small);
    if (!Number.isFinite(safeBig) || safeBig <= 0) return null;
    if (!Number.isFinite(safeSmall) || safeSmall < 0) return null;
    return safeSmall / safeBig;
  };
  const sortTableRows = (rows, sortState) => {
    const direction = sortState?.dir === "desc" ? -1 : 1;
    const column = sortState?.col || "";
    return [...rows].sort((left, right) => {
      const leftValue = left?.[column];
      const rightValue = right?.[column];
      if (typeof leftValue === "string" || typeof rightValue === "string") {
        return String(leftValue || "").localeCompare(String(rightValue || "")) * direction;
      }
      return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * direction;
    });
  };
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
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
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
  const [showMateComparison, setShowMateComparison] = useState(false);
  const [focusedReplayId, setFocusedReplayId] = useState("");
  const [recentSort, setRecentSort] = useState({ col: "date", dir: "desc" });
  const [groupedTypeSort, setGroupedTypeSort] = useState({ col: "games", dir: "desc" });
  const [matesSort, setMatesSort] = useState({ col: "games", dir: "desc" });
  const [enemiesSort, setEnemiesSort] = useState({ col: "games", dir: "desc" });
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
  const playerPickerCandidates = useMemo(() => {
    const byId = new Map();
    for (const row of stableRecent) {
      const seenInRow = new Set();
      const roster = [
        ...(Array.isArray(row?.blue_players) ? row.blue_players : []),
        ...(Array.isArray(row?.orange_players) ? row.orange_players : []),
        ...(Array.isArray(row?.team_players) ? row.team_players : []),
        ...(Array.isArray(row?.opponent_players) ? row.opponent_players : []),
      ];
      for (const player of roster) {
        const name = String(player?.name || "").trim();
        const playerId = String(player?.player_id || "").trim();
        const onlineId = String(player?.online_id || "").trim();
        const preferredId = playerId && playerId !== "0" ? playerId : onlineId;
        const normalized = normalizeIdentity(preferredId);
        if (!name || !normalized || normalized === "0") continue;
        if (seenInRow.has(normalized)) continue;
        seenInRow.add(normalized);
        const existing = byId.get(normalized) || {
          name,
          playerId,
          onlineId,
          preferredId,
          platformCode: String(player?.platform_code || "?"),
          platformLabel: String(player?.platform_label || ""),
          games: 0,
        };
        existing.games += 1;
        byId.set(normalized, existing);
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      if (b.games !== a.games) return b.games - a.games;
      return a.name.localeCompare(b.name);
    });
  }, [stableRecent]);

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
    localStorage.setItem(RECENT_TABLE_MAX_ROWS_KEY, String(maxTableRows));
  }, [maxTableRows]);
  useEffect(() => {
    if (!topStatusDismissed) setShowTopStatus(Boolean(status));
  }, [status, topStatusDismissed]);
  useEffect(() => {
    setTopStatusDismissed(false);
  }, [status]);
  useEffect(() => {
    const inferred = inferQuickPreset(filters.startDate, filters.endDate);
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
  const derived = useMemo(() => computeDerived(activeRecent, trackedPlayerId), [activeRecent, trackedPlayerId]);
  const singleMatchDerived = useMemo(
    () => computeDerived(focusedReplay ? [focusedReplay] : [], trackedPlayerId),
    [focusedReplay, trackedPlayerId]
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

  const hasTrackedPlayerId = Boolean(normalizeIdentity(trackedPlayerId));
  const playerIdPrompt = "please fill player id";
  const playerIdNotFoundPrompt = "player id not found";
  const trackedPlayerOverview = useMemo(
    () => computeTrackedPlayerOverview(activeRecent, trackedPlayerId),
    [activeRecent, trackedPlayerId]
  );
  const hasTrackedPlayerMatch = hasTrackedPlayerId && trackedPlayerOverview.matches > 0;
  const hasUsablePlayerContext = hasLoadedData && hasTrackedPlayerMatch;
  const playerMetricPrompt = !hasTrackedPlayerId ? playerIdPrompt : (hasTrackedPlayerMatch ? "" : playerIdNotFoundPrompt);
  useEffect(() => {
    if (loading) return;
    if (!stableRecent.length) return;
    if (hasTrackedPlayerMatch) return;
    if (!playerPickerCandidates.length) return;
    setPlayerPickerOpen(true);
  }, [loading, stableRecent.length, hasTrackedPlayerMatch, playerPickerCandidates.length]);
  const playerScopedInsights = useMemo(() => {
    if (!hasTrackedPlayerMatch) {
      return {
        categories: [],
        impactStats: [],
        boostBars: [],
        boostWinLoss: [],
        byType: [],
      };
    }
    const rows = statsView === "single" ? (focusedReplay ? [focusedReplay] : []) : activeRecent;
    const avgOf = (metricKey, sourceRows = rows) => {
      const values = sourceRows
        .map((row) => findPlayerMetric(row, metricKey, trackedPlayerId))
        .filter((v) => v !== null);
      if (!values.length) return 0;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const winsOnly = rows.filter((r) => didPlayerWin(r, trackedPlayerId));
    const lossesOnly = rows.filter((r) => !didPlayerWin(r, trackedPlayerId));
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
          { label: "Tracked Avg Score", value: num(avgOf("score")) },
          { label: "Pressure Index", value: num(avgOf("pressure_index")) },
          { label: "Score vs Opp", value: signed(avgOf("score_diff_vs_opponents")) },
          { label: "Score vs Lobby Avg", value: signed(avgOf("score_vs_lobby_avg")) },
        ],
      },
      {
        id: "context",
        label: "Context",
        metrics: [
          { label: "Goal Share Team", value: pct(avgOf("goals_share_team")) },
          { label: "Assist vs Opp", value: signed(avgOf("assists_diff_vs_opponents")) },
        ],
      },
    ];
    const impactStats = [
      { key: "score", label: "Score" },
      { key: "goals", label: "Goals" },
      { key: "shots", label: "Shots" },
      { key: "saves", label: "Saves" },
      { key: "touches", label: "Touches" },
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
    ];
    const boostWinLoss = [
      { metric: "Big", win: avgBoostOf("big", winsOnly), loss: avgBoostOf("big", lossesOnly) },
      { metric: "Small", win: avgBoostOf("small", winsOnly), loss: avgBoostOf("small", lossesOnly) },
    ];
    const byTypeMap = new Map();
    rows.forEach((row) => {
      const type = row.match_type || "Unknown";
      const prev = byTypeMap.get(type) || {
        type,
        games: 0,
        wins: 0,
        scoreTotal: 0,
        bigBoostsTotal: 0,
        smallBoostsTotal: 0,
      };
      const score = findPlayerMetric(row, "score", trackedPlayerId);
      const bigBoosts = findPlayerMetric(row, "big_boosts", trackedPlayerId);
      const smallBoosts = findPlayerMetric(row, "small_boosts", trackedPlayerId);
      prev.games += 1;
      prev.wins += didPlayerWin(row, trackedPlayerId) ? 1 : 0;
      prev.scoreTotal += Number(score || 0);
      prev.bigBoostsTotal += Number(bigBoosts || 0);
      prev.smallBoostsTotal += Number(smallBoosts || 0);
      byTypeMap.set(type, prev);
    });
    const byType = Array.from(byTypeMap.values())
      .map((v) => ({
        type: v.type,
        games: v.games,
        winRate: v.games ? v.wins / v.games : 0,
        avgScore: v.games ? v.scoreTotal / v.games : 0,
        avgBigBoosts: v.games ? v.bigBoostsTotal / v.games : 0,
        avgSmallBoosts: v.games ? v.smallBoostsTotal / v.games : 0,
        avgBoostTotal: v.games ? (v.bigBoostsTotal + v.smallBoostsTotal) / v.games : 0,
      }))
      .sort((a, b) => b.games - a.games);
    return { categories, impactStats, boostBars, boostWinLoss, byType };
  }, [activeRecent, focusedReplay, hasTrackedPlayerMatch, statsView, trackedPlayerId]);
  const scopedCategories = playerScopedInsights.categories || [];
  const scopedImpactStats = playerScopedInsights.impactStats || [];
  const scopedBoostBars = playerScopedInsights.boostBars || [];
  const scopedBoostWinLoss = playerScopedInsights.boostWinLoss || [];
  const scopedByType = playerScopedInsights.byType || [];
  const orderedMates = useMemo(() => sortTableRows(viewDerived.mates || [], matesSort), [matesSort, viewDerived.mates]);
  const orderedEnemies = useMemo(() => sortTableRows(viewDerived.enemies || [], enemiesSort), [enemiesSort, viewDerived.enemies]);
  const orderedByType = useMemo(() => sortTableRows(scopedByType || [], groupedTypeSort), [groupedTypeSort, scopedByType]);
  const renderSortableHeader = (label, col, sortState, setSortState, defaultDir = "asc") => (
    <th key={col}>
      <button
        type="button"
        className={`table-sort-btn ${sortState.col === col ? "active" : ""}`}
        aria-label={`Sort by ${label} (${sortState.col === col && sortState.dir === "asc" ? "descending" : "ascending"})`}
        onClick={() =>
          setSortState((prev) => {
            if (prev.col === col) return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
            return { col, dir: defaultDir };
          })
        }
      >
        <span className="table-sort-label">{label}</span>
        <span className={`table-sort-arrow ${sortState.col === col ? "active" : ""}`}>
          {sortState.col === col ? (sortState.dir === "asc" ? "^" : "v") : "<>"}
        </span>
      </button>
    </th>
  );

  const cards = buildTopKpiCards({
    totalMatches: derived.matches,
    trackedPlayerOverview: {
      ...trackedPlayerOverview,
      winRate: trackedPlayerOverview.winRate,
    },
    hasTrackedPlayerMatch,
    playerMetricPrompt,
    playerIdPrompt,
  }).map((card) => ({
    ...card,
    icon: card.label === "Win Rate" ? Trophy : Activity,
    playerValue: card.label === "Win Rate" && trackedPlayerOverview.winRate !== null ? pct(trackedPlayerOverview.winRate) : card.playerValue,
    primaryValue: card.label === "Win Rate" && trackedPlayerOverview.winRate !== null
      ? pct(trackedPlayerOverview.winRate)
      : card.primaryValue,
  }));
  const quickLinks = useMemo(() => buildQuickLinks(analyticsView), [analyticsView]);
  const mapWinRateRows = useMemo(() => selectMapWinRateChartRows(viewDerived.mapWinBars, 12), [viewDerived.mapWinBars]);

  const summary = dashboard.summary || {};
  const allRecent = useMemo(() => analysisFilteredRecent.slice(), [analysisFilteredRecent]);
  const filteredRecentTableRows = useMemo(
    () => filterRecentRows(allRecent, tableSearch, tableResultFilter, trackedPlayerId),
    [allRecent, tableSearch, tableResultFilter, trackedPlayerId],
  );
  const sortedRecentTableRows = useMemo(
    () => sortRecentRows(filteredRecentTableRows, recentSort),
    [filteredRecentTableRows, recentSort],
  );
  const tablePagination = useMemo(
    () => paginateRecentRows(sortedRecentTableRows, tablePage, maxTableRows),
    [sortedRecentTableRows, tablePage, maxTableRows],
  );
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
  const activeTrend = useMemo(
    () => (hasTrackedPlayerId
      ? buildPlayerTrend(
        statsView === "single" ? (focusedReplay ? [focusedReplay] : []) : activeRecent,
        timeTab,
        trackedPlayerId,
        findPlayerMetric,
      )
      : []),
    [activeRecent, focusedReplay, hasTrackedPlayerId, statsView, timeTab, trackedPlayerId]
  );
  const activeContributionTrend = useMemo(
    () => (hasTrackedPlayerId
      ? buildPlayerContributionTrend(
        statsView === "single" && focusedReplay ? [focusedReplay] : activeRecent,
        timeTab,
        trackedPlayerId,
        findPlayerMetric,
      )
      : []),
    [activeRecent, focusedReplay, hasTrackedPlayerId, statsView, timeTab, trackedPlayerId]
  );
  const activeMateTrend = useMemo(
    () => (hasTrackedPlayerId
      ? buildMateComparisonTrend(
        statsView === "single" ? (focusedReplay ? [focusedReplay] : []) : activeRecent,
        timeTab,
        trackedPlayerId,
      )
      : []),
    [activeRecent, focusedReplay, hasTrackedPlayerId, statsView, timeTab, trackedPlayerId]
  );
  const activeMateContributionTrend = useMemo(
    () => (hasTrackedPlayerId
      ? buildMateContributionTrend(
        statsView === "single" && focusedReplay ? [focusedReplay] : activeRecent,
        timeTab,
        trackedPlayerId,
      )
      : []),
    [activeRecent, focusedReplay, hasTrackedPlayerId, statsView, timeTab, trackedPlayerId]
  );
  const activeTrendWithRegression = useMemo(() => {
    const winRateTrend = buildRegressionSeries(activeTrend, "winRate", "winRateRegression");
    const scoreTrend = buildRegressionSeries(winRateTrend, "avgScore", "avgScoreRegression");
    return buildRegressionSeries(scoreTrend, "scoreGap", "scoreGapRegression");
  }, [activeTrend]);
  const overviewScoreTrendData = useMemo(() => {
    const mateMap = new Map((activeMateTrend || []).map((row) => [row.bucket, row]));
    return (activeTrendWithRegression || []).map((row) => ({
      ...row,
      mateAvgScore: mateMap.get(row.bucket)?.mateAvgScore ?? null,
      mateScoreGap: mateMap.get(row.bucket)?.mateScoreGap ?? null,
    }));
  }, [activeMateTrend, activeTrendWithRegression]);
  const overviewContributionTrendData = useMemo(() => {
    const mateMap = new Map((activeMateContributionTrend || []).map((row) => [row.bucket, row]));
    return (activeContributionTrend || []).map((row) => ({
      ...row,
      mateTotal: mateMap.get(row.bucket)?.mateTotal ?? null,
    }));
  }, [activeContributionTrend, activeMateContributionTrend]);
  const mateMetricAverage = (sourceRows, metricKey) => {
    const values = (sourceRows || [])
      .map((row) => {
        const perspective = resolvePerspective(row, trackedPlayerId);
        if (!perspective?.selectedPlayer) return null;
        const selectedPid = String(perspective.selectedPlayer?.player_id || "").trim();
        const selectedOid = String(perspective.selectedPlayer?.online_id || "").trim();
        const selectedName = String(perspective.selectedPlayer?.name || "").trim();
        const mates = (perspective.teamPlayers || []).filter((player) => {
          if (!player) return false;
          if (selectedPid && String(player?.player_id || "").trim() === selectedPid) return false;
          if (selectedOid && String(player?.online_id || "").trim() === selectedOid) return false;
          if (selectedName && String(player?.name || "").trim() === selectedName) return false;
          return true;
        });
        if (!mates.length) return null;
        const numbers = mates.map((mate) => Number(mate?.[metricKey])).filter((value) => Number.isFinite(value));
        if (!numbers.length) return null;
        return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      })
      .filter((value) => value !== null);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
  };
  const mateBoostBars = useMemo(() => ([
    { metric: "Big", avg: mateMetricAverage(statsView === "single" ? [] : activeRecent, "big_boosts") },
    { metric: "Small", avg: mateMetricAverage(statsView === "single" ? [] : activeRecent, "small_boosts") },
  ]), [activeRecent, statsView, trackedPlayerId]);
  const boostBarsData = useMemo(() => {
    const mateMap = new Map((mateBoostBars || []).map((row) => [row.metric, row.avg]));
    return (scopedBoostBars || []).map((row) => ({
      ...row,
      mateAvg: mateMap.get(row.metric) ?? null,
    }));
  }, [mateBoostBars, scopedBoostBars]);
  const mateBoostWinLoss = useMemo(() => ([
    {
      metric: "Big",
      win: mateMetricAverage((statsView === "single" ? [] : activeRecent).filter((row) => didPlayerWin(row, trackedPlayerId)), "big_boosts"),
      loss: mateMetricAverage((statsView === "single" ? [] : activeRecent).filter((row) => !didPlayerWin(row, trackedPlayerId)), "big_boosts"),
    },
    {
      metric: "Small",
      win: mateMetricAverage((statsView === "single" ? [] : activeRecent).filter((row) => didPlayerWin(row, trackedPlayerId)), "small_boosts"),
      loss: mateMetricAverage((statsView === "single" ? [] : activeRecent).filter((row) => !didPlayerWin(row, trackedPlayerId)), "small_boosts"),
    },
  ]), [activeRecent, statsView, trackedPlayerId]);
  const boostWinLossData = useMemo(() => {
    const mateMap = new Map((mateBoostWinLoss || []).map((row) => [row.metric, row]));
    return (scopedBoostWinLoss || []).map((row) => ({
      ...row,
      mateWin: mateMap.get(row.metric)?.win ?? null,
      mateLoss: mateMap.get(row.metric)?.loss ?? null,
    }));
  }, [mateBoostWinLoss, scopedBoostWinLoss]);
  const boostSummary = useMemo(() => {
    const playerBig = scopedBoostBars.find((row) => row.metric === "Big")?.avg ?? null;
    const playerSmall = scopedBoostBars.find((row) => row.metric === "Small")?.avg ?? null;
    const mateBig = mateBoostBars.find((row) => row.metric === "Big")?.avg ?? null;
    const mateSmall = mateBoostBars.find((row) => row.metric === "Small")?.avg ?? null;
    return {
      playerSlurp: slurpIndicator(playerBig, playerSmall),
      mateSlurp: slurpIndicator(mateBig, mateSmall),
      playerBigShare:
        Number.isFinite(Number(playerBig)) && Number.isFinite(Number(playerSmall)) && Number(playerBig) + Number(playerSmall) > 0
          ? Number(playerBig) / (Number(playerBig) + Number(playerSmall))
          : null,
    };
  }, [mateBoostBars, scopedBoostBars]);
  const comparisonMetricAverage = (sourceRows, metricKey, side) => {
    const values = (sourceRows || [])
      .map((row) => {
        const perspective = resolvePerspective(row, trackedPlayerId);
        if (!perspective?.selectedPlayer) return null;
        const selectedPid = String(perspective.selectedPlayer?.player_id || "").trim();
        const selectedOid = String(perspective.selectedPlayer?.online_id || "").trim();
        const selectedName = String(perspective.selectedPlayer?.name || "").trim();
        const roster = side === "mates"
          ? (perspective.teamPlayers || []).filter((player) => {
              if (!player) return false;
              if (selectedPid && String(player?.player_id || "").trim() === selectedPid) return false;
              if (selectedOid && String(player?.online_id || "").trim() === selectedOid) return false;
              if (selectedName && String(player?.name || "").trim() === selectedName) return false;
              return true;
            })
          : (perspective.opponentPlayers || []);
        if (!roster.length) return null;
        const numbers = roster.map((player) => Number(player?.[metricKey])).filter((value) => Number.isFinite(value));
        if (!numbers.length) return null;
        return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
      })
      .filter((value) => value !== null);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
  };
  const spiderChartData = useMemo(() => {
    if (!hasTrackedPlayerMatch) return [];
    const rows = statsView === "single" ? (focusedReplay ? [focusedReplay] : []) : activeRecent;
    const metrics = [
      { axis: "Score", key: "score" },
      { axis: "Goals", key: "goals" },
      { axis: "Assists", key: "assists" },
      { axis: "Saves", key: "saves" },
      { axis: "Shots", key: "shots" },
      { axis: "Big Boosts", key: "big_boosts" },
    ];
    return metrics.map((metric) => {
      const playerRaw = rows
        .map((row) => findPlayerMetric(row, metric.key, trackedPlayerId))
        .filter((value) => value !== null);
      const playerAvg = playerRaw.length
        ? playerRaw.reduce((sum, value) => sum + Number(value), 0) / playerRaw.length
        : null;
      const mateAvg = comparisonMetricAverage(rows, metric.key, "mates");
      const enemyAvg = comparisonMetricAverage(rows, metric.key, "enemies");
      const maxValue = Math.max(
        Number(playerAvg || 0),
        Number(mateAvg || 0),
        Number(enemyAvg || 0),
        1,
      );
      return {
        axis: metric.axis,
        player: playerAvg === null ? 0 : (Number(playerAvg) / maxValue) * 100,
        mates: mateAvg === null ? 0 : (Number(mateAvg) / maxValue) * 100,
        enemies: enemyAvg === null ? 0 : (Number(enemyAvg) / maxValue) * 100,
        playerRaw: playerAvg,
        matesRaw: mateAvg,
        enemiesRaw: enemyAvg,
      };
    });
  }, [activeRecent, focusedReplay, hasTrackedPlayerMatch, statsView, trackedPlayerId]);
  const singleMatchPlayers = useMemo(() => {
    if (statsView !== "single" || !focusedReplay) return [];
    const bluePlayers = Array.isArray(focusedReplay?.blue_players) ? focusedReplay.blue_players : [];
    const orangePlayers = Array.isArray(focusedReplay?.orange_players) ? focusedReplay.orange_players : [];
    const blueScore = Number(focusedReplay?.blue_score);
    const orangeScore = Number(focusedReplay?.orange_score);
    const roster = [
      ...bluePlayers.map((player) => ({ ...player, teamColor: "blue" })),
      ...orangePlayers.map((player) => ({ ...player, teamColor: "orange" })),
    ];
    const withIdentity = roster.filter((player) => String(player?.name || "").trim());
    if (!withIdentity.length) return [];
    const lobbyAvgScore = withIdentity.reduce((sum, player) => sum + Number(player?.score || 0), 0) / withIdentity.length;
    return withIdentity
      .map((player) => {
        const score = Number(player?.score || 0);
        const goals = Number(player?.goals || 0);
        const assists = Number(player?.assists || 0);
        const saves = Number(player?.saves || 0);
        const shots = Number(player?.shots || 0);
        const bigBoosts = Number(player?.big_boosts || 0);
        const smallBoosts = Number(player?.small_boosts || 0);
        const teamWon = player.teamColor === "blue" ? blueScore > orangeScore : orangeScore > blueScore;
        return {
          name: player.name,
          teamColor: player.teamColor,
          score,
          goals,
          assists,
          saves,
          shots,
          bigBoosts,
          smallBoosts,
          boostTotal: bigBoosts + smallBoosts,
          slurpIndicator: slurpIndicator(bigBoosts, smallBoosts),
          scoreGap: score - lobbyAvgScore,
          contributionTotal: goals + assists + saves,
          won: teamWon ? 1 : 0,
        };
      })
      .sort((a, b) => {
        if (a.teamColor !== b.teamColor) return a.teamColor === "blue" ? -1 : 1;
        return b.score - a.score;
      });
  }, [focusedReplay, statsView]);
  const trendTickFormatter = (bucket) => {
    if (timeTab === "hour") {
      const text = String(bucket || "");
      return text.length > 11 ? text.slice(5) : text;
    }
    return String(bucket || "");
  };
  const singleMatchTickFormatter = (name) => {
    const text = String(name || "");
    return text.length > 14 ? `${text.slice(0, 12)}..` : text;
  };
  const shouldShowAnalytics = (...groups) => analyticsView === "all" || groups.includes(analyticsView);
  const supportsMateOverlay = statsView !== "single" && ["overview", "boost", "all"].includes(analyticsView);
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
  const overviewChartHeight = timeTab === "hour" ? 150 : 260;
  const boostChartSyncId = "boost-sync";
  const overviewChartSyncId = "overview-sync";
  const orderedTimeTabs = ["hour", "hour_of_day", "day", "week", "month"];
  const statsInfoSections = [
    {
      title: "Top KPI Cards",
      scope: "Dynamic",
      items: cards.map((card) => ({
        name: card.label,
        value: card.showDual
          ? `Team: ${card.teamValue} | Player: ${card.playerValue || card.playerEmpty || "-"}`
          : card.primaryValue,
        desc: kpiDoc(card.label) || METRIC_DOCS[card.label] || "Derived metric.",
      })),
    },
    {
      title: "Feature Categories (Player scope)",
      scope: "Player",
      items: (scopedCategories || []).flatMap((cat) =>
        (cat.metrics || []).map((metric) => ({
          name: `${cat.label} - ${metric.label}`,
          value: String(metric.value || "-"),
          desc: `${CATEGORY_DOCS[cat.label] || `Category: ${cat.label}.`} ${METRIC_DOCS[metric.label] || "Category metric derived from scoped replays."}`,
        })),
      ),
    },
    {
      title: "Boost Metrics (Player scope)",
      scope: "Player",
      items: [
        ...(scopedBoostBars || []).map((row) => ({
          name: `Boost Avg - ${row.metric}`,
          value: num(row.avg, 2),
          desc: `${METRIC_DOCS[`Avg ${row.metric} Boosts`] || "Boost average."} Uses all scoped matches.`,
        })),
        {
          name: "Slurping Indicator",
          value: boostSummary.playerSlurp === null ? "-" : num(boostSummary.playerSlurp, 2),
          desc: METRIC_DOCS["Slurping Indicator"] || "Avg Small Boosts / Avg Big Boosts. Higher means more small-pad heavy boost routing.",
        },
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
      scope: "Player",
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
          desc: `${METRIC_DOCS["Win Trend"]} Bucket format: ${activeTimeMeta.tip} Uses tracked-player replay rows for the time series.`,
        },
        {
          name: `Latest ${activeTimeMeta.short} Tracked Avg Score`,
          value: activeTrend.length ? num(activeTrend[activeTrend.length - 1]?.avgScore || 0) : "-",
          desc: `${METRIC_DOCS["Score Momentum"]} Value shown here is the latest bucket's tracked-player avgScore.`,
        },
        {
          name: `Latest ${activeTimeMeta.short} Score vs Lobby Avg`,
          value: activeTrend.length ? signed(activeTrend[activeTrend.length - 1]?.scoreGap || 0) : "-",
          desc: `${METRIC_DOCS["Score vs Lobby Avg Trend"]} Value shown here is the latest bucket's tracked-player score gap versus lobby average.`,
        },
        {
          name: "Weighted Win Rate",
          value: pct(timeAggregate.weightedWinRate),
          desc: METRIC_DOCS["Weighted Win Rate"],
        },
        {
          name: "Weighted Tracked Avg Score",
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
          name: "Win Rate by Map",
          value: `${(viewDerived.mapWinBars || []).length} maps`,
          desc: `${METRIC_DOCS["Win Rate by Map"]} (${(viewDerived.mapWinBars || []).slice(0, 5).map((m) => `${m.map}:${pct(m.winRate)}`).join(" | ") || "no data"}).`,
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
      title: "Players Comparison Metrics",
      scope: "Team",
      items: [
        {
          name: "Best Mates",
          value: `${(viewDerived.mates || []).length} rows`,
          desc: METRIC_DOCS["Best Mates"],
        },
        {
          name: "Enemies",
          value: `${(viewDerived.enemies || []).length} rows`,
          desc: METRIC_DOCS["Enemies"],
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
      setLoadQuickPreset(inferQuickPreset(startupFilters.startDate, startupFilters.endDate));
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

  function handleRecentRowClick(replayId) {
    const id = String(replayId || "").trim();
    if (!id) return;
    const exists = selectedReplayIds.includes(id);
    const next = exists
      ? selectedReplayIds.filter((rid) => rid !== id)
      : [...selectedReplayIds, id];
    setSelectedReplayIds(next);
    if (next.length === 1) {
      setFocusedReplayId(next[0]);
      setStatsView("single");
      return;
    }
    setFocusedReplayId(next[0] || "");
    setStatsView("aggregate");
  }

  const statusPinned = topStatusPinned || scrollY <= 8;
  const heroBottom = heroRef.current?.getBoundingClientRect?.().bottom ?? 84;
  const topStatusTop = statusPinned ? 10 : Math.max(8, Math.round(heroBottom + 8));

  return (
    <div className="page">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <main className={`shell ${hasUsablePlayerContext ? "with-side-panels" : "loading-only"}`}>
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
              <a
                className="hero-btn ghost"
                href="https://buymeacoffee.com/alois_devlp"
                target="_blank"
                rel="noreferrer"
                title="Tip if you like it"
              >
                ☕ Tip if you like it!
              </a>
            </div>
          </div>
          <p className="eyebrow">Rocket League Command Center</p>
          <h1>Replay Intelligence</h1>
          <p>Custom paths, username highlight, player-benchmark metrics, and export-ready analytics.</p>
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
                  <span title={kpiDoc(c.label) || undefined}>{c.label}</span>
                </div>
                {c.showDual ? (
                  <div className="card-scope-grid">
                    <div className="card-scope-row">
                      <span className="metric-scope-pill team" title="Team metric: aggregated from the active replay selection.">Team</span>
                      <strong>{c.teamValue}</strong>
                    </div>
                    <div className="card-scope-row">
                      <span className="metric-scope-pill player" title="Player metric: tracked-player value using the current Player ID.">Player</span>
                      <strong>{c.playerValue || c.playerEmpty || "-"}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="card-single-value">
                    <strong>{c.primaryValue}</strong>
                  </div>
                )}
              </article>
            ))}
            <p className="scope-note">{KPI_MARKDOWN_DOCS["Display rule"] || "KPI cards only split into team/player when the tracked-player value actually differs."}</p>
            <section className="global-nav">
              <div className="global-nav-title">Player</div>
              <label className="global-player-id">
                <span>Player ID <Tip text={"Your platform/player identifier used to select your row from each replay.\nHow to find it:\n1) Open Rocket League and load any recent replay in this dashboard.\n2) Open the generated replay JSON from the cache folder.\n3) Search your in-game name in PlayerStats.\n4) Copy OnlineID (or PlayerID.fields.Uid) and paste it here."} /></span>
                <input value={filters.playerId} onChange={(e) => setFilters({ ...filters, playerId: e.target.value })} />
              </label>
              <PlayerTrackingCallout activeRecent={activeRecent} trackedPlayerId={trackedPlayerId} playerIdValue={filters.playerId} />
              <button
                type="button"
                className="mini-btn ghost player-picker-launch"
                onClick={() => setPlayerPickerOpen(true)}
                disabled={!playerPickerCandidates.length}
                title="Pick your player id from detected players in the loaded replay set."
              >
                Pick your player ID
              </button>
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
                  <label className="field-replay-count">Replay count <Tip text="If this is greater than 0, only the newest N replays are parsed. Set it to 0 to parse every detected replay in the date range." /><input type="number" min="0" max="2000" placeholder="0 = all" title="0 means parse all detected replays." value={filters.parseCount} onChange={(e) => setFilters({ ...filters, parseCount: clampInt(e.target.value, 0, 2000, 40) })} /></label>
                  <label className="path-field field-demos">Demos directory <Tip text="Rocket League replay folder. The backend auto-detects both the normal Documents path and common OneDrive-redirected Documents paths, but you can override it here." /> <span className="required-mark">*</span>
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

        {hasLoadedData && !hasTrackedPlayerMatch && (
          <section className="panel player-id-gate">
            <div className="panel-title">
              <Info size={18} /> Player ID Required
            </div>
            <p className="status">
              {!hasTrackedPlayerId
                ? "Analytics stay locked until you fill a player ID."
                : "Analytics stay locked until the current player ID matches at least one loaded replay row."}
            </p>
            <div className="config-actions-row">
              <button
                type="button"
                className="mini-btn"
                onClick={() => setPlayerPickerOpen(true)}
                disabled={!playerPickerCandidates.length}
                title="Pick your player id from detected players in the loaded replay set."
              >
                Pick your player ID
              </button>
            </div>
          </section>
        )}

        <RecentMatchesSection
              selectedReplayIds={selectedReplayIds}
          setSelectedReplayIds={setSelectedReplayIds}
          setFocusedReplayId={setFocusedReplayId}
          setStatsView={setStatsView}
          tableSearch={tableSearch}
          setTableSearch={setTableSearch}
          tableResultFilter={tableResultFilter}
          setTableResultFilter={setTableResultFilter}
          visibleRecentColumns={visibleRecentColumns}
          setVisibleRecentColumns={setVisibleRecentColumns}
          recentSort={recentSort}
          setRecentSort={setRecentSort}
          visibleRecentTableRows={visibleRecentTableRows}
          trackedPlayerId={trackedPlayerId}
          isTrackedRow={isTrackedRow}
          handleRecentRowClick={handleRecentRowClick}
          maxTableRows={maxTableRows}
          setMaxTableRows={setMaxTableRows}
          clampInt={clampInt}
          sortedRecentTableRows={sortedRecentTableRows}
          tablePageSafe={tablePageSafe}
          tableTotalPages={tableTotalPages}
          setTablePage={setTablePage}
          PLATFORM_LEGEND={PLATFORM_LEGEND}
        />

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
              {orderedTimeTabs.map((key) => {
                const meta = tabMeta[key];
                if (!meta) return null;
                return (
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
                );
              })}
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
            {statsView === "single"
              ? " Single-match view compares all players in the selected replay."
              : " Player metrics are the default. Mates overlay only appears on comparable charts."}
          </p>
          {supportsMateOverlay && (
            <div className="analysis-overlay-row">
              <div className="analysis-overlay-copy">
                <div className="filter-menu-label">Comparison overlay</div>
                <p>Draw teammate averages on comparable player charts.</p>
              </div>
              <button
                type="button"
                className={`mini-btn ghost analysis-overlay-toggle ${showMateComparison ? "active" : ""}`}
                onClick={() => setShowMateComparison((value) => !value)}
                aria-pressed={showMateComparison}
                title="Toggle teammate average overlays on supported charts."
              >
                {showMateComparison ? "Hide mates overlay" : "Show mates overlay"}
              </button>
            </div>
          )}
        </section>
        <section className={`chart-grid ${timeTab === "hour" ? "timeline-expanded" : ""}`}>
          {shouldShowAnalytics("boost") && (
          <article id="boost-metrics" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Gauge size={18} /> {statsView === "single" ? "Single Match Boost Metrics" : "Boost Metrics"} <span className="metric-scope-pill player" title={statsView === "single" ? "Single match view: each bar is one player from the selected replay." : "Player metric: boost stats for the tracked player in each replay."}>{statsView === "single" ? "All players" : "Player"}</span> <Tip text={statsView === "single" ? "Selected replay only. Compares every player's big/small boost usage and slurping ratio." : "Compares player boost usage. Turn on `Show mates overlay` to compare against teammate averages."} /></div>
            {statsView === "single" ? (!focusedReplay || !singleMatchPlayers.length ? (
              <p className="failure-empty">Select a replay row to compare every player in one match.</p>
            ) : (
              <>
                <div className="chart">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={singleMatchPlayers} syncId={boostChartSyncId} syncMethod="index" margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="name" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={singleMatchTickFormatter} interval={0} angle={-18} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                      <Tooltip formatter={(value) => num(value, 2)} />
                      <Bar dataKey="bigBoosts" name="Big boosts" stackId="boost" radius={[6, 6, 0, 0]}>
                        {singleMatchPlayers.map((row) => <Cell key={`${row.name}-big`} fill={row.teamColor === "blue" ? "#38bdf8" : "#f97316"} />)}
                      </Bar>
                      <Bar dataKey="smallBoosts" name="Small boosts" stackId="boost" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={singleMatchPlayers} syncId={boostChartSyncId} syncMethod="index" margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="name" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={singleMatchTickFormatter} interval={0} angle={-18} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                      <Tooltip formatter={(value) => num(value, 2)} />
                      <Bar dataKey="slurpIndicator" name="Slurping indicator" radius={[6, 6, 0, 0]}>
                        {singleMatchPlayers.map((row) => <Cell key={`${row.name}-slurp`} fill={row.teamColor === "blue" ? "#38bdf8" : "#f97316"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )) : !hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <>
                <div className="chart">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={boostBarsData} syncId={boostChartSyncId} syncMethod="index">
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="metric" tick={{ fill: chartTick, fontSize: 11 }} />
                      <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                      <Tooltip formatter={(value) => num(value, 2)} />
                      <Bar dataKey="avg" name="Player avg" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                      {showMateComparison && <Bar dataKey="mateAvg" name="Mate avg" fill="#38bdf8" radius={[6, 6, 0, 0]} />}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={boostWinLossData} syncId={boostChartSyncId} syncMethod="index">
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="metric" tick={{ fill: chartTick, fontSize: 11 }} />
                      <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                      <Tooltip formatter={(value) => num(value, 2)} />
                      <Bar dataKey="win" name="Player win avg" fill="#22c55e" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="loss" name="Player loss avg" fill="#fb7185" radius={[6, 6, 0, 0]} />
                      {showMateComparison && <Bar dataKey="mateWin" name="Mate win avg" fill="#67e8f9" radius={[6, 6, 0, 0]} />}
                      {showMateComparison && <Bar dataKey="mateLoss" name="Mate loss avg" fill="#fda4af" radius={[6, 6, 0, 0]} />}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="impact-chips">
                  <div className="impact-chip">
                    <div>Slurping Indicator</div>
                    <strong>{boostSummary.playerSlurp === null ? "-" : num(boostSummary.playerSlurp, 2)}</strong>
                    <span>{boostSummary.playerBigShare === null ? "No boost ratio data" : `Big boost share: ${pct(boostSummary.playerBigShare)}`}</span>
                  </div>
                  {showMateComparison && (
                    <div className="impact-chip">
                      <div>Mates Slurping Indicator</div>
                      <strong>{boostSummary.mateSlurp === null ? "-" : num(boostSummary.mateSlurp, 2)}</strong>
                      <span>Average teammate small/big boost ratio.</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="win-trend" className="panel chart-panel overview-chart-panel">
            <div className="panel-title"><CalendarRange size={18} /> {statsView === "single" ? "Single Match Scoreboard" : `${tabMeta[timeTab].label} Win Trend`} <span className="metric-scope-pill player" title={statsView === "single" ? "Single match view: compares every player in the selected replay." : "Player metric: trend uses tracked-player replay rows."}>{statsView === "single" ? "All players" : "Player"}</span> <Tip text={statsView === "single" ? "Selected replay only. Shows each player's score in the chosen match." : "Tracked-player win-rate trajectory for the selected time bucket granularity."} /></div>
            {statsView === "single" ? (!focusedReplay || !singleMatchPlayers.length ? (
              <p className="failure-empty">Select a replay row to compare every player in one match.</p>
            ) : (
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={singleMatchPlayers} syncId={overviewChartSyncId} syncMethod="index" margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="name" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={singleMatchTickFormatter} interval={0} angle={-18} textAnchor="end" height={56} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                    <Tooltip formatter={(value) => num(value, 2)} />
                    <Bar dataKey="score" name="Score" radius={[6, 6, 0, 0]}>
                      {singleMatchPlayers.map((row) => <Cell key={`${row.name}-score`} fill={row.teamColor === "blue" ? "#38bdf8" : "#f97316"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )) : !hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className={`chart ${timeTab === "hour" ? "timeline-chart" : ""}`}>
                <ResponsiveContainer width="100%" height={overviewChartHeight}>
                  <LineChart data={activeTrendWithRegression} syncId={overviewChartSyncId} syncMethod="index">
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} domain={[0, 1]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="winRate" stroke="#4ade80" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="winRateRegression" name="Win-rate regression" stroke="#86efac" strokeWidth={2} strokeDasharray="7 5" dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="score-momentum" className="panel chart-panel overview-chart-panel">
            <div className="panel-title"><Gauge size={18} /> {statsView === "single" ? "Single Match Score vs Lobby Avg" : `${tabMeta[timeTab].label} Score Momentum`} <span className="metric-scope-pill player" title={statsView === "single" ? "Single match view: compares every player in the selected replay." : "Player metric: score momentum uses tracked-player score per replay."}>{statsView === "single" ? "All players" : "Player"}</span> {statsView !== "single" && showMateComparison && <span className="metric-scope-pill team" title="Mate comparison overlay: average score of the tracked player's teammates in each bucket.">Mates overlay</span>} <Tip text={statsView === "single" ? "Selected replay only. Shows how far above or below lobby average each player scored." : "Tracked-player average score over time. Turn on `Show mates overlay` to compare against teammate average score."} /></div>
            {statsView === "single" ? (!focusedReplay || !singleMatchPlayers.length ? (
              <p className="failure-empty">Select a replay row to compare every player in one match.</p>
            ) : (
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={singleMatchPlayers} syncId={overviewChartSyncId} syncMethod="index" margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="name" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={singleMatchTickFormatter} interval={0} angle={-18} textAnchor="end" height={56} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                    <Tooltip formatter={(value) => signed(value)} />
                    <Bar dataKey="scoreGap" name="Score vs lobby avg" radius={[6, 6, 0, 0]}>
                      {singleMatchPlayers.map((row) => <Cell key={`${row.name}-gap`} fill={row.teamColor === "blue" ? "#38bdf8" : "#f97316"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )) : !hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className={`chart ${timeTab === "hour" ? "timeline-chart" : ""}`}>
                <ResponsiveContainer width="100%" height={overviewChartHeight}>
                  <LineChart data={overviewScoreTrendData} syncId={overviewChartSyncId} syncMethod="index">
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avgScore" stroke="#f59e0b" strokeWidth={3} dot={false} connectNulls />
                    <Line type="monotone" dataKey="avgScoreRegression" name="Score regression" stroke="#fde68a" strokeWidth={2} strokeDasharray="7 5" dot={false} connectNulls />
                    {showMateComparison && <Line type="monotone" dataKey="mateAvgScore" name="Mate avg score" stroke="#38bdf8" strokeWidth={2.5} dot={false} connectNulls />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="score-diff" className="panel chart-panel overview-chart-panel">
            <div className="panel-title"><RadarIcon size={18} /> {statsView === "single" ? "Single Match Win / Loss by Player" : `${tabMeta[timeTab].label} Score vs Lobby Avg`} <span className="metric-scope-pill player" title={statsView === "single" ? "Single match view: compares every player in the selected replay." : "Player metric: compares tracked-player score against the average score of the full lobby in each replay."}>{statsView === "single" ? "All players" : "Player"}</span> {statsView !== "single" && showMateComparison && <span className="metric-scope-pill team" title="Mate comparison overlay: teammate average score versus lobby average.">Mates overlay</span>} <Tip text={statsView === "single" ? "Selected replay only. Shows which players were on the winning side." : "How far above or below the average lobby score the tracked player is in each period. Turn on `Show mates overlay` to compare against teammate average versus lobby average."} /></div>
            {statsView === "single" ? (!focusedReplay || !singleMatchPlayers.length ? (
              <p className="failure-empty">Select a replay row to compare every player in one match.</p>
            ) : (
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={singleMatchPlayers} syncId={overviewChartSyncId} syncMethod="index" margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="name" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={singleMatchTickFormatter} interval={0} angle={-18} textAnchor="end" height={56} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} domain={[0, 1]} />
                    <Tooltip formatter={(value) => (Number(value) > 0 ? "Win" : "Loss")} />
                    <Bar dataKey="won" name="Result" radius={[6, 6, 0, 0]}>
                      {singleMatchPlayers.map((row) => <Cell key={`${row.name}-won`} fill={row.won ? "#22c55e" : "#ef4444"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )) : !hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className={`chart ${timeTab === "hour" ? "timeline-chart" : ""}`}>
                <ResponsiveContainer width="100%" height={overviewChartHeight}>
                  <LineChart data={overviewScoreTrendData} syncId={overviewChartSyncId} syncMethod="index">
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="scoreGap" stroke="#38bdf8" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="scoreGapRegression" name="Score-gap regression" stroke="#93c5fd" strokeWidth={2} strokeDasharray="7 5" dot={false} connectNulls />
                    {showMateComparison && <Line type="monotone" dataKey="mateScoreGap" name="Mate score vs lobby avg" stroke="#f97316" strokeWidth={2.5} dot={false} connectNulls />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="contribution-stack" className="panel chart-panel overview-chart-panel">
            <div className="panel-title"><Activity size={18} /> {statsView === "single" ? "Single Match Goals / Assists / Saves" : `${tabMeta[timeTab].label} Goals / Assists / Saves`} <span className="metric-scope-pill player" title={statsView === "single" ? "Single match view: compares every player in the selected replay." : "Player metric: tracked-player goals, assists, and saves over the selected time view."}>{statsView === "single" ? "All players" : "Player"}</span> {statsView !== "single" && showMateComparison && <span className="metric-scope-pill team" title="Mate comparison overlay: average teammate goals + assists + saves in each bucket.">Mates overlay</span>} <Tip text={statsView === "single" ? "Selected replay only. Stacked bars compare each player's contributions in the chosen match." : "Stacked contribution chart for the tracked player. Turn on `Show mates overlay` to add average teammate contributions."} /></div>
            {statsView === "single" ? (!focusedReplay || !singleMatchPlayers.length ? (
              <p className="failure-empty">Select a replay row to compare every player in one match.</p>
            ) : (
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={singleMatchPlayers} syncId={overviewChartSyncId} syncMethod="index" margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="name" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={singleMatchTickFormatter} interval={0} angle={-18} textAnchor="end" height={56} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                    <Tooltip formatter={(value) => num(value, 2)} />
                    <Bar dataKey="goals" stackId="contrib" fill="#22c55e" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="assists" stackId="contrib" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="saves" stackId="contrib" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )) : !hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className={`chart ${timeTab === "hour" ? "timeline-chart" : ""}`}>
                <ResponsiveContainer width="100%" height={overviewChartHeight}>
                  <BarChart data={overviewContributionTrendData} syncId={overviewChartSyncId} syncMethod="index">
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="bucket" tick={{ fill: chartTick, fontSize: 11 }} tickFormatter={trendTickFormatter} />
                    <YAxis tick={{ fill: chartTick, fontSize: 11 }} />
                    <Tooltip formatter={(value) => num(value, 2)} />
                    <Bar dataKey="goals" stackId="contrib" fill="#22c55e" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="assists" stackId="contrib" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="saves" stackId="contrib" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    {showMateComparison && <Line type="monotone" dataKey="mateTotal" name="Mate total contributions" stroke="#f97316" strokeWidth={2.5} dot={false} connectNulls />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </article>
          )}
          {shouldShowAnalytics("synergy") && (
          <article id="player-comparison-radar" className="panel chart-panel wide-table-panel">
            <div className="panel-title"><RadarIcon size={18} /> {statsView === "single" ? "Single Match Player / Mates / Enemies" : "Player / Mates / Enemies Radar"} <span className="metric-scope-pill player" title="Comparison view: tracked player vs teammate average vs opponent average.">Compare</span> <Tip text={statsView === "single" ? "Selected replay only. Normalized spider chart comparing the tracked player against teammate and opponent averages in the chosen match." : "Normalized spider chart comparing the tracked player against teammate and opponent averages over the current analysis scope."} /></div>
            {!hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className="chart radar-chart">
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={spiderChartData}>
                    <PolarGrid stroke={chartGrid} />
                    <PolarAngleAxis dataKey="axis" tick={{ fill: chartTick, fontSize: 10 }} />
                    <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip
                      formatter={(value, _name, item) => {
                        const key = item?.dataKey;
                        const payload = item?.payload || {};
                        if (key === "player") return [num(payload.playerRaw, 2), "Player"];
                        if (key === "mates") return [num(payload.matesRaw, 2), "Mates"];
                        if (key === "enemies") return [num(payload.enemiesRaw, 2), "Enemies"];
                        return [num(value, 2), String(key || "")];
                      }}
                    />
                    <Legend verticalAlign="bottom" height={30} />
                    <RadarSeries name="Player" dataKey="player" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.18} strokeWidth={2.5} />
                    <RadarSeries name="Mates" dataKey="mates" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.14} strokeWidth={2.5} />
                    <RadarSeries name="Enemies" dataKey="enemies" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={2.5} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="stats-categories" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Filter size={18} /> Feature Categories <span className="metric-scope-pill player" title="Player metric: values are computed from the tracked player's fields per replay.">Player</span> <Tip text="Category rollup of offense, defense, teamplay, impact, and context metrics for the tracked player." /></div>
            {!hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className="impact-chips">
                {(scopedCategories || []).map((cat) => (
                  <div key={cat.id} className="impact-chip">
                    <div>{cat.label} <Tip text={CATEGORY_DOCS[cat.label] || `Category: ${cat.label}.`} /></div>
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
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="impactful-stats" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Gauge size={18} /> Impactful Stats (Concise) <span className="metric-scope-pill player" title="Player metric: compares tracked-player averages in wins versus losses.">Player</span> <Tip text="Top player metrics with the largest average difference between wins and losses." /></div>
            {!hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className="impact-chips">
                {scopedImpactStats.slice(0, 6).map((m) => (
                  <div key={m.label} className="impact-chip">
                    <div>{m.label}</div>
                    <strong>{signed(m.delta)}</strong>
                    <span>W {num(m.winAvg)} | L {num(m.lossAvg)}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
          )}
          {shouldShowAnalytics("overview") && (
          <article id="grouped-match-type" className="panel chart-panel tabs-panel">
            <div className="panel-title"><Filter size={18} /> Grouped by Match Type <span className="metric-scope-pill player" title="Player metric: grouped averages are computed from tracked-player stats in each replay.">Player</span> <Tip text="Table view summarizing tracked-player performance per match type with win rate, score, and boost averages." /></div>
            {!hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {renderSortableHeader("Type", "type", groupedTypeSort, setGroupedTypeSort)}
                      {renderSortableHeader("Games", "games", groupedTypeSort, setGroupedTypeSort, "desc")}
                      {renderSortableHeader("Win Rate", "winRate", groupedTypeSort, setGroupedTypeSort, "desc")}
                      {renderSortableHeader("Your Avg Score", "avgScore", groupedTypeSort, setGroupedTypeSort, "desc")}
                      {renderSortableHeader("Avg Big Boosts", "avgBigBoosts", groupedTypeSort, setGroupedTypeSort, "desc")}
                      {renderSortableHeader("Avg Small Boosts", "avgSmallBoosts", groupedTypeSort, setGroupedTypeSort, "desc")}
                      {renderSortableHeader("Avg Total Boost", "avgBoostTotal", groupedTypeSort, setGroupedTypeSort, "desc")}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedByType.slice(0, 20).map((r) => (
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
            )}
          </article>
          )}
          {shouldShowAnalytics("distribution") && (
          <article id="mode-distribution" className="panel chart-panel">
            <div className="panel-title"><RadarIcon size={18} /> Mode Distribution <Tip text="Distribution of games played by mode under current analysis filters." /></div>
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
            <div className="panel-title"><RadarIcon size={18} /> Mode Outcomes Split <Tip text="Per mode, split games into wins and losses to compare consistency by queue/mode." /></div>
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
          <article className="panel chart-panel wide-table-panel">
            <div className="panel-title"><Trophy size={18} /> Win Rate by Map <Tip text="Maps ranked by play count, but the primary bar is your win rate on each map. Games played stay as the secondary overlay for context." /></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={mapWinRateRows} margin={{ top: 24, right: 16, left: 8, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                  <XAxis
                    dataKey="map"
                    tick={{ fill: chartTick, fontSize: 11 }}
                    tickFormatter={(value) => formatMapAxisLabel(value, 18)}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={92}
                  />
                  <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: chartTick, fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTick, fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === "Win %") return `${num(value, 2)}%`;
                      if (name === "Games") return `${value} games`;
                      return value;
                    }}
                    labelFormatter={(label) => {
                      const row = mapWinRateRows.find((entry) => entry.map === label);
                      return row ? `${row.map} | ${row.games} games` : label;
                    }}
                  />
                  <Bar yAxisId="left" dataKey={MAP_WINRATE_PRIMARY_KEY} name="Win %" fill="#60a5fa" radius={[6, 6, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey={MAP_WINRATE_SECONDARY_KEY}
                    name="Games"
                    stroke="#f97316"
                    strokeWidth={2.5}
                    dot={{ r: 2 }}
                    label={{ position: "top", fill: chartTick, fontSize: 11 }}
                  />
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
          <article id="best-mates" className="panel chart-panel wide-table-panel">
            <div className="panel-title"><Trophy size={18} /> Best Mates <Tip text="Teammates ordered by games played together first, then by tracked-player average score." /></div>
            {!hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {renderSortableHeader("Mate", "name", matesSort, setMatesSort)}
                      {renderSortableHeader("Games", "games", matesSort, setMatesSort, "desc")}
                      {renderSortableHeader("Wins", "wins", matesSort, setMatesSort, "desc")}
                      {renderSortableHeader("Win Rate", "winRate", matesSort, setMatesSort, "desc")}
                      {renderSortableHeader("Your Avg Score", "avgScore", matesSort, setMatesSort, "desc")}
                      {renderSortableHeader("Score vs Mate", "avgScoreDiffVsMate", matesSort, setMatesSort, "desc")}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedMates.slice(0, 40).map((m) => (
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
            )}
          </article>
          )}
          {shouldShowAnalytics("synergy") && (
          <article id="enemy-rivals" className="panel chart-panel wide-table-panel">
            <div className="panel-title"><Trophy size={18} /> Enemies <Tip text="Opponents ordered by games faced first, then by tracked-player average score." /></div>
            {!hasTrackedPlayerMatch ? (
              <p className="failure-empty">{playerMetricPrompt}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {renderSortableHeader("Enemy", "name", enemiesSort, setEnemiesSort)}
                      {renderSortableHeader("Games", "games", enemiesSort, setEnemiesSort, "desc")}
                      {renderSortableHeader("Wins", "wins", enemiesSort, setEnemiesSort, "desc")}
                      {renderSortableHeader("Losses", "losses", enemiesSort, setEnemiesSort, "desc")}
                      {renderSortableHeader("Win Rate", "winRate", enemiesSort, setEnemiesSort, "desc")}
                      {renderSortableHeader("Your Avg Score", "avgScore", enemiesSort, setEnemiesSort, "desc")}
                      {renderSortableHeader("Score vs Opp", "avgScoreDiffVsOpp", enemiesSort, setEnemiesSort, "desc")}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedEnemies.slice(0, 40).map((e) => (
                      <tr key={`enemy-${e.name}`} id={toAnchorId(e.name, "enemy")}>
                        <td>{e.name}</td>
                        <td>{e.games}</td>
                        <td>{e.wins}</td>
                        <td>{e.losses}</td>
                        <td>{pct(e.winRate)}</td>
                        <td>{num(e.avgScore)}</td>
                        <td>{signed(e.avgScoreDiffVsOpp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
          )}
        </section>
        {shouldShowAnalytics("overview") && (
        <section className="panel chart-panel overview-summary-panel">
          <div className="panel-title"><Gauge size={18} /> {tabMeta[timeTab].label} Aggregate Insights <span className="metric-scope-pill player" title="Player metric: aggregate insights summarize the tracked-player time series.">Player</span> <Tip text="Weighted summary cards for the tracked-player timeline: best/worst/busiest periods and overall weighted performance." /></div>
          <div className="impact-chips">
            <div className="impact-chip">
              <div>Weighted Win Rate</div>
              <strong>{pct(timeAggregate.weightedWinRate)}</strong>
              <span>Across {timeAggregate.buckets} {tabMeta[timeTab].short.toLowerCase()} buckets</span>
            </div>
            <div className="impact-chip">
              <div>Weighted Tracked Avg Score</div>
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
        </section>
        )}

        {shouldShowAnalytics("misc") && (
        <section id="misc-stats" className="panel chart-panel">
          <div className="panel-title"><RadarIcon size={18} /> Misc <Tip text="Fun/quirky derived counters from your filtered replay set." /></div>
          <div className="wtf-grid">
            {viewDerived.miscStats.map((s) => (
              <article key={s.label} className="wtf-item" title={s.hint}>
                <div className="wtf-label">{s.label}</div>
                <strong>{s.value}</strong>
                <div className="wtf-hint">{s.hint}</div>
              </article>
            ))}
          </div>
        </section>
        )}
      </main>
      <StatsInfoModal
        open={statsInfoOpen}
        onClose={() => setStatsInfoOpen(false)}
        statsInfoTree={statsInfoTree}
      />
      <PlayerIdPickerModal
        open={playerPickerOpen}
        onClose={() => setPlayerPickerOpen(false)}
        players={playerPickerCandidates}
        currentPlayerId={filters.playerId}
        onPick={(value) => setFilters((prev) => ({ ...prev, playerId: value }))}
      />
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

