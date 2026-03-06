from __future__ import annotations

import logging
import sys
import os
import time
import threading
from contextlib import asynccontextmanager
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from uuid import uuid4
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

try:
    from .api_utils import (
        pick_replays_for_cache_mode,
        open_directory_in_explorer,
        reason_key,
        resolve_replay_file,
        validate_clear_cache_paths,
    )
    from .cache import clear_cache_store, ensure_db, resolve_store_dirs
    from .config import (
        candidate_boxcars_paths,
        default_demos_dir,
        get_replay_digests,
        parse_date_param,
        resolve_boxcars_path,
    )
    from .replay import (
        build_row,
        extract_spatial_summary,
        parse_or_cache_replay,
        run_boxcars_json,
        summarize_monthly,
    )
except ImportError:
    # Fallback for script/frozen execution (e.g. PyInstaller onefile) where
    # package-relative imports may not resolve with __package__ unset.
    try:
        from backend.api_utils import (
            pick_replays_for_cache_mode,
            open_directory_in_explorer,
            reason_key,
            resolve_replay_file,
            validate_clear_cache_paths,
        )
        from backend.cache import clear_cache_store, ensure_db, resolve_store_dirs
        from backend.config import (
            candidate_boxcars_paths,
            default_demos_dir,
            get_replay_digests,
            parse_date_param,
            resolve_boxcars_path,
        )
        from backend.replay import (
            build_row,
            extract_spatial_summary,
            parse_or_cache_replay,
            run_boxcars_json,
            summarize_monthly,
        )
    except ImportError:
        from api_utils import (
            open_directory_in_explorer,
            pick_replays_for_cache_mode,
            reason_key,
            resolve_replay_file,
            validate_clear_cache_paths,
        )
        from cache import clear_cache_store, ensure_db, resolve_store_dirs
        from config import (
            candidate_boxcars_paths,
            default_demos_dir,
            get_replay_digests,
            parse_date_param,
            resolve_boxcars_path,
        )
        from replay import (
            build_row,
            extract_spatial_summary,
            parse_or_cache_replay,
            run_boxcars_json,
            summarize_monthly,
        )


LOGGER = logging.getLogger("rl_local_dashboard")
if not LOGGER.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


@asynccontextmanager
async def _lifespan(_: FastAPI):
    ensure_db()
    yield


app = FastAPI(title="RL Local Dashboard API", version="1.0.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_PROGRESS_LOCK = threading.Lock()
_PROGRESS: dict[str, dict[str, Any]] = {}
_CANCEL_LOCK = threading.Lock()
_CANCEL_FLAGS: dict[str, threading.Event] = {}
_ALLOWED_BOXCARS_PATHS: set[str] = set()


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def _frontend_dist_dir() -> Path | None:
    root = _runtime_root()
    candidates = [
        root / "frontend",
        root.parent / "frontend",
        root / "dist" / "frontend",
        root / "frontend" / "dist",
    ]
    for candidate in candidates:
        index_file = candidate / "index.html"
        if index_file.is_file():
            return candidate
    return None


def _set_progress(run_id: str, **fields: Any) -> None:
    with _PROGRESS_LOCK:
        current = _PROGRESS.get(run_id, {}).copy()
        current.update(fields)
        _PROGRESS[run_id] = current


def _get_progress(run_id: str) -> dict[str, Any] | None:
    with _PROGRESS_LOCK:
        item = _PROGRESS.get(run_id)
        return item.copy() if item else None


def _register_cancel(run_id: str) -> threading.Event:
    with _CANCEL_LOCK:
        event = threading.Event()
        _CANCEL_FLAGS[run_id] = event
        return event


def _get_cancel(run_id: str) -> threading.Event | None:
    with _CANCEL_LOCK:
        return _CANCEL_FLAGS.get(run_id)


def _clear_cancel(run_id: str) -> None:
    with _CANCEL_LOCK:
        _CANCEL_FLAGS.pop(run_id, None)


@app.get("/api/health")
def health() -> dict[str, Any]:
    demos = default_demos_dir()
    parsed_store, raw_store = resolve_store_dirs()
    boxcars_resolved = ""
    for candidate in candidate_boxcars_paths():
        if candidate.is_file():
            boxcars_resolved = str(candidate)
            break
    return {
        "ok": True,
        "default_demos_dir": str(demos),
        "default_player_id": "",
        "boxcars_resolved": boxcars_resolved,
        "cache_db": "",
        "local_replay_store": str(parsed_store),
        "raw_replay_store": str(raw_store),
    }


@app.post("/api/clear-cache")
def clear_cache(
    cache_dir: str | None = Query(default=None),
    raw_dir: str | None = Query(default=None),
) -> dict[str, Any]:
    validate_clear_cache_paths(cache_dir, raw_dir)
    try:
        stats = clear_cache_store(parsed_replays_dir=cache_dir, raw_replays_dir=raw_dir)
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("clear cache failed")
        raise HTTPException(status_code=500, detail=f"clear cache failed: {exc}") from exc
    return {"ok": True, **stats}


@app.get("/api/clear-cache")
def clear_cache_get(
    cache_dir: str | None = Query(default=None),
    raw_dir: str | None = Query(default=None),
) -> dict[str, Any]:
    return clear_cache(cache_dir=cache_dir, raw_dir=raw_dir)


@app.post("/api/open-cache-dir")
def open_cache_dir(cache_dir: str | None = Query(default=None)) -> dict[str, Any]:
    parsed_store, _ = resolve_store_dirs(parsed_replays_dir=cache_dir)
    parsed_store.mkdir(parents=True, exist_ok=True)
    open_directory_in_explorer(parsed_store, "cache")
    return {"ok": True, "path": str(parsed_store)}


@app.get("/api/open-cache-dir")
def open_cache_dir_get(cache_dir: str | None = Query(default=None)) -> dict[str, Any]:
    return open_cache_dir(cache_dir=cache_dir)


@app.post("/api/open-raw-dir")
def open_raw_dir(raw_dir: str | None = Query(default=None)) -> dict[str, Any]:
    _, raw_store = resolve_store_dirs(raw_replays_dir=raw_dir)
    raw_store.mkdir(parents=True, exist_ok=True)
    open_directory_in_explorer(raw_store, "raw")
    return {"ok": True, "path": str(raw_store)}


@app.get("/api/open-raw-dir")
def open_raw_dir_get(raw_dir: str | None = Query(default=None)) -> dict[str, Any]:
    return open_raw_dir(raw_dir=raw_dir)


@app.get("/api/replay-spatial")
def replay_spatial(
    replay_id: str = Query(...),
    demos_dir: str = Query(...),
    boxcars_exe: str | None = Query(default=None),
    player_name: str | None = Query(default=None),
    cache_dir: str | None = Query(default=None),
) -> dict[str, Any]:
    replay_file = resolve_replay_file(replay_id, demos_dir, cache_dir=cache_dir)
    boxcars = resolve_boxcars_path(boxcars_exe, allowed_user_paths=_ALLOWED_BOXCARS_PATHS)
    try:
        raw = run_boxcars_json(boxcars, replay_file)
        spatial = extract_spatial_summary(raw, selected_player_name=player_name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not build spatial view: {exc}") from exc
    return {"ok": True, "replay_id": replay_id, **spatial}


@app.get("/api/rocket-league-parse-replay")
def parse_sample_replay(
    boxcars_exe: str | None = Query(default=None),
    demos_dir: str | None = Query(default=None),
    use_cache: bool = Query(default=True),
    write_cache: bool = Query(default=True),
    cache_dir: str | None = Query(default=None),
    raw_dir: str | None = Query(default=None),
) -> dict[str, Any]:
    demos = Path(demos_dir).expanduser() if demos_dir else default_demos_dir()
    replay_files = get_replay_digests(demos, count=1, start_date=None, end_date=None)
    if not replay_files:
        raise HTTPException(status_code=404, detail=f"No .replay files found in {demos}")

    boxcars: Path | None = None
    boxcars_error = None
    try:
        boxcars = resolve_boxcars_path(boxcars_exe, allowed_user_paths=_ALLOWED_BOXCARS_PATHS)
    except HTTPException as exc:
        boxcars_error = str(exc.detail)
        if not use_cache:
            raise
    digest = replay_files[0]
    canonical, _, error = parse_or_cache_replay(
        digest,
        boxcars,
        use_cache=use_cache,
        write_cache=write_cache,
        cache_dir=cache_dir,
        raw_dir=raw_dir,
    )
    if not canonical:
        detail = error or "Sample parse failed"
        if boxcars_error:
            detail = f"{detail} (boxcars error: {boxcars_error})"
        raise HTTPException(status_code=500, detail=detail)
    return {
        "ok": True,
        "row_count": len(canonical.get("players") or []),
        "replay_id": canonical.get("replay_id"),
        "local_parser_used": str(boxcars) if boxcars else "cache-only",
    }


@app.get("/api/rocket-league-detect")
def rocket_league_detect(
    demos_dir: str = Query(...),
    count: int = Query(default=200, ge=1, le=5000),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    use_cache: bool = Query(default=True),
    load_cached_replays: bool = Query(default=False),
    cache_dir: str | None = Query(default=None),
) -> dict[str, Any]:
    start_dt = parse_date_param(start_date, is_end=False)
    end_dt = parse_date_param(end_date, is_end=True)
    demos = Path(demos_dir).expanduser()
    digests = get_replay_digests(demos, count=count, start_date=start_dt, end_date=end_dt)
    selected, new_count = pick_replays_for_cache_mode(
        digests,
        use_cache=use_cache,
        load_cached_replays=load_cached_replays,
        cache_dir=cache_dir,
    )
    return {
        "ok": True,
        "detected_replays": len(selected),
        "total_replays": len(digests),
        "new_replays": new_count,
        "using_new_only": bool(use_cache and new_count > 0 and not load_cached_replays),
        "demos_dir": str(demos),
        "use_cache": use_cache,
        "load_cached_replays": load_cached_replays,
    }


@app.get("/api/rocket-league-dashboard")
def rocket_league_dashboard(
    demos_dir: str = Query(...),
    player_id: str = Query(default=""),
    highlight_name: str = Query(default=""),
    limit_replays: bool = Query(default=True),
    count: int = Query(default=200, ge=1, le=5000),
    parse_count: int = Query(default=40, ge=0, le=5000),
    workers: int = Query(default=4, ge=1, le=16),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    boxcars_exe: str | None = Query(default=None),
    use_cache: bool = Query(default=True),
    load_cached_replays: bool = Query(default=False),
    write_cache: bool = Query(default=True),
    cache_dir: str | None = Query(default=None),
    raw_dir: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
) -> dict[str, Any]:
    run_id = (run_id or "").strip() or str(uuid4())
    cancel_event = _register_cancel(run_id)
    started = time.perf_counter()
    start_dt = parse_date_param(start_date, is_end=False)
    end_dt = parse_date_param(end_date, is_end=True)

    demos = Path(demos_dir).expanduser()
    boxcars: Path | None = None
    boxcars_error = None
    try:
        boxcars = resolve_boxcars_path(boxcars_exe, allowed_user_paths=_ALLOWED_BOXCARS_PATHS)
    except HTTPException as exc:
        boxcars_error = str(exc.detail)
        if not use_cache:
            raise
        LOGGER.warning("boxcars unavailable, switching to cache-only mode: %s", boxcars_error)
    effective_count = count if limit_replays else 2_000_000
    digests = get_replay_digests(demos, count=effective_count, start_date=start_dt, end_date=end_dt)
    digests, new_count = pick_replays_for_cache_mode(
        digests,
        use_cache=use_cache,
        load_cached_replays=load_cached_replays,
        cache_dir=cache_dir,
    )
    queued = min(len(digests), parse_count) if limit_replays else len(digests)
    candidates = digests[:queued]
    workers = max(1, min(workers, queued if queued > 0 else 1))
    _set_progress(
        run_id,
        done=False,
        processed=0,
        queued=queued,
        parsed=0,
        failed=0,
        matched=0,
        cache_hits=0,
        cache_misses=0,
        status="running",
        elapsed_seconds=0.0,
    )

    recent_rows: list[dict[str, Any]] = []
    parsed_count = 0
    failed_count = 0
    matched_count = 0
    cache_hits = 0
    cache_misses = 0
    failed_by_reason: dict[str, int] = {}
    failed_examples: list[dict[str, Any]] = []
    success_examples: list[dict[str, Any]] = []

    try:
        if boxcars is not None:
            stat = boxcars.stat()
            LOGGER.info(
                "dashboard run started run_id=%s boxcars=%s boxcars_mtime=%s boxcars_size=%sB use_cache=%s queued=%s",
                run_id,
                boxcars,
                datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                stat.st_size,
                use_cache,
                queued,
            )
        else:
            LOGGER.info(
                "dashboard run started run_id=%s boxcars=unavailable cache_only=true use_cache=%s queued=%s",
                run_id,
                use_cache,
                queued,
            )
    except OSError:
        LOGGER.info(
            "dashboard run started run_id=%s boxcars=%s use_cache=%s queued=%s",
            run_id,
            boxcars,
            use_cache,
            queued,
        )

    def _parse_one(digest_item):
        replay_data, from_cache_flag, error_text = parse_or_cache_replay(
            digest_item,
            boxcars,
            use_cache=use_cache,
            write_cache=write_cache,
            cache_dir=cache_dir,
            raw_dir=raw_dir,
        )
        row_data = None
        if replay_data:
            row_data = build_row(replay_data, player_id=player_id, highlight_name=highlight_name)
        return digest_item, replay_data, row_data, from_cache_flag, error_text

    processed_count = 0
    executor = ThreadPoolExecutor(max_workers=workers)
    future_map: dict[Any, Any] = {}

    def submit_next() -> bool:
        if cancel_event.is_set():
            return False
        idx = len(future_map) + processed_count
        if idx >= len(candidates):
            return False
        digest = candidates[idx]
        future_map[executor.submit(_parse_one, digest)] = digest
        return True

    try:
        for _ in range(workers):
            if not submit_next():
                break

        while future_map:
            if cancel_event.is_set():
                for pending in list(future_map):
                    pending.cancel()
                break

            done, _ = wait(list(future_map.keys()), return_when=FIRST_COMPLETED, timeout=0.25)
            if not done:
                continue

            for future in done:
                digest = future_map.pop(future)
                try:
                    _, replay, row, from_cache, error = future.result()
                except Exception as exc:  # noqa: BLE001
                    replay = None
                    row = None
                    from_cache = False
                    error = f"worker exception: {exc}"

                processed_count += 1

                if from_cache:
                    cache_hits += 1
                else:
                    cache_misses += 1

                if not replay:
                    failed_count += 1
                    key = reason_key(error)
                    failed_by_reason[key] = failed_by_reason.get(key, 0) + 1
                    if len(failed_examples) < 25:
                        failed_examples.append(
                            {
                                "replay": digest.file_path.name,
                                "reason": key,
                                "error": error or "unknown parse error",
                                "from_cache": from_cache,
                            }
                        )
                    if not from_cache:
                        LOGGER.warning(
                            "dashboard parse failed replay=%s error=%s",
                            digest.file_path.name,
                            error or "unknown parse error",
                        )
                else:
                    parsed_count += 1
                    if row:
                        matched_count += 1
                        recent_rows.append(row)
                        if len(success_examples) < 25:
                            success_examples.append(
                                {
                                    "replay": digest.file_path.name,
                                    "from_cache": from_cache,
                                    "matched": True,
                                    "player_name": row.get("player_name", ""),
                                    "result": "win" if row.get("won") else "loss",
                                    "score": row.get("score", 0),
                                }
                            )
                    elif len(success_examples) < 25:
                        success_examples.append(
                            {
                                "replay": digest.file_path.name,
                                "from_cache": from_cache,
                                "matched": False,
                            }
                        )

                if processed_count % 10 == 0 or processed_count == queued:
                    LOGGER.info(
                        "dashboard progress processed=%s/%s parsed=%s failed=%s matched=%s",
                        processed_count,
                        queued,
                        parsed_count,
                        failed_count,
                        matched_count,
                    )
                _set_progress(
                    run_id,
                    processed=processed_count,
                    queued=queued,
                    parsed=parsed_count,
                    failed=failed_count,
                    matched=matched_count,
                    cache_hits=cache_hits,
                    cache_misses=cache_misses,
                    done=False,
                    status="running",
                    elapsed_seconds=(time.perf_counter() - started),
                )

                submit_next()
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    recent_rows.sort(key=lambda r: str(r.get("date", "")), reverse=True)
    wins = sum(1 for row in recent_rows if row.get("won"))
    monthly = summarize_monthly(recent_rows)
    resolved_cache_dir, resolved_raw_dir = resolve_store_dirs(
        parsed_replays_dir=cache_dir,
        raw_replays_dir=raw_dir,
    )

    elapsed = time.perf_counter() - started
    cancelled = cancel_event.is_set()
    summary = {
        "run_id": run_id,
        "player_id": player_id,
        "highlight_name": highlight_name,
        "scan_replays": len(digests),
        "queued_replays": queued,
        "parsed_replays": parsed_count,
        "failed_replays": failed_count,
        "matched_replays": matched_count,
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
        "failed_by_reason": failed_by_reason,
        "failed_examples": failed_examples,
        "success_examples": success_examples,
        "wins": wins,
        "losses": max(0, matched_count - wins),
        "win_rate": (wins / matched_count) if matched_count else 0.0,
        "elapsed_seconds": elapsed,
        "boxcars_exe": str(boxcars) if boxcars else "",
        "cache_dir": str(resolved_cache_dir),
        "raw_dir": str(resolved_raw_dir),
        "cache_only_mode": boxcars is None,
        "boxcars_error": boxcars_error,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "use_cache": use_cache,
        "write_cache": write_cache,
        "load_cached_replays": load_cached_replays,
        "new_replays_detected": new_count,
        "using_new_only": bool(use_cache and new_count > 0 and not load_cached_replays),
        "limit_replays": limit_replays,
        "workers": workers,
        "cancelled": cancelled,
    }
    _set_progress(
        run_id,
        processed=processed_count if cancelled else queued,
        queued=queued,
        parsed=parsed_count,
        failed=failed_count,
        matched=matched_count,
        cache_hits=cache_hits,
        cache_misses=cache_misses,
        done=True,
        status="cancelled" if cancelled else "done",
        elapsed_seconds=elapsed,
    )
    _clear_cancel(run_id)
    return {"summary": summary, "monthly": monthly, "recent": recent_rows}


@app.get("/api/rocket-league-progress")
def rocket_league_progress(
    run_id: str = Query(...),
) -> dict[str, Any]:
    progress = _get_progress(run_id)
    if not progress:
        return {"ok": False, "run_id": run_id, "status": "unknown"}
    return {"ok": True, "run_id": run_id, **progress}


@app.post("/api/rocket-league-cancel")
def rocket_league_cancel(
    run_id: str = Query(...),
) -> dict[str, Any]:
    cancel_event = _get_cancel(run_id)
    if not cancel_event:
        return {"ok": False, "run_id": run_id, "status": "unknown_run"}
    cancel_event.set()
    _set_progress(run_id, status="cancelling")
    return {"ok": True, "run_id": run_id, "status": "cancelling"}


def _pick_path(mode: str, title: str | None = None) -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=501, detail=f"Tk file picker unavailable: {exc}") from exc

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        if mode == "file":
            path = filedialog.askopenfilename(
                title=title or "Pick boxcars executable",
                filetypes=[("Executable", "*.exe"), ("All files", "*.*")],
            )
        else:
            path = filedialog.askdirectory(title=title or "Pick Rocket League demos directory")
    finally:
        root.destroy()

    if not path:
        raise HTTPException(status_code=400, detail="No path selected")
    return path


@app.post("/api/pick-boxcars-exe")
def pick_boxcars_exe() -> dict[str, Any]:
    path = _pick_path("file", title="Pick boxcars executable")
    resolved = str(Path(path).expanduser().resolve())
    _ALLOWED_BOXCARS_PATHS.add(resolved)
    return {"path": resolved}


@app.post("/api/pick-demos-dir")
def pick_demos_dir() -> dict[str, Any]:
    return {"path": _pick_path("dir", title="Pick Rocket League demos directory")}


@app.post("/api/pick-cache-dir")
def pick_cache_dir() -> dict[str, Any]:
    return {"path": _pick_path("dir", title="Pick cache directory")}


@app.post("/api/pick-raw-dir")
def pick_raw_dir() -> dict[str, Any]:
    return {"path": _pick_path("dir", title="Pick raw replay directory")}


_FRONTEND_DIR = _frontend_dist_dir()
if _FRONTEND_DIR:
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
else:
    @app.get("/")
    def root() -> dict[str, Any]:
        return {
            "ok": True,
            "message": "Backend is running. Frontend files not found. Build frontend or run Vite dev server.",
        }


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port, reload=False)
