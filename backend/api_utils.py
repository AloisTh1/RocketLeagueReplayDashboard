from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import HTTPException

try:
    from .cache import DEFAULT_CACHE_ROOT_DIR, is_replay_cached, resolve_store_dirs
    from .config import default_demos_dir
except ImportError:
    try:
        from backend.cache import DEFAULT_CACHE_ROOT_DIR, is_replay_cached, resolve_store_dirs
        from backend.config import default_demos_dir
    except ImportError:
        from cache import DEFAULT_CACHE_ROOT_DIR, is_replay_cached, resolve_store_dirs
        from config import default_demos_dir


def is_subpath(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def validate_clear_cache_paths(cache_dir: str | None, raw_dir: str | None) -> None:
    allowed_root = DEFAULT_CACHE_ROOT_DIR.resolve()
    for label, value in (("cache_dir", cache_dir), ("raw_dir", raw_dir)):
        if not value:
            continue
        candidate = Path(value).expanduser().resolve()
        if not is_subpath(candidate, allowed_root):
            raise HTTPException(
                status_code=400,
                detail=f"{label} must be inside app cache root: {allowed_root}",
            )


def pick_replays_for_cache_mode(
    digests: list[Any],
    use_cache: bool,
    load_cached_replays: bool,
    cache_dir: str | None = None,
) -> tuple[list[Any], int]:
    if not use_cache:
        return digests, 0
    uncached = [digest for digest in digests if not is_replay_cached(digest, parsed_replays_dir=cache_dir)]
    if load_cached_replays:
        return digests, len(uncached)
    return uncached, len(uncached)


def reason_key(error: str | None) -> str:
    text = (error or "").lower()
    if "no known attributes found" in text:
        return "unsupported_replay_schema"
    if "invalid json" in text:
        return "invalid_json_output"
    if "no player stats" in text:
        return "missing_player_stats"
    if "launch failed" in text:
        return "boxcars_launch_failed"
    return "other"


def safe_replay_id(replay_id: str) -> str:
    safe = "".join(ch for ch in str(replay_id or "") if ch.isalnum() or ch in ("-", "_"))
    return safe or "unknown_replay"


def resolve_replay_file(replay_id: str, demos_dir: str | None, cache_dir: str | None = None) -> Path:
    rid = str(replay_id or "").strip()
    if not rid:
        raise HTTPException(status_code=422, detail="Missing replay_id")

    direct = Path(rid).expanduser()
    if direct.suffix.lower() == ".replay" and direct.is_file():
        return direct

    candidates: list[Path] = []
    if demos_dir:
        candidates.append(Path(demos_dir).expanduser() / f"{rid}.replay")
    default_dir = default_demos_dir()
    candidates.append(default_dir / f"{rid}.replay")

    parsed_store, _ = resolve_store_dirs(parsed_replays_dir=cache_dir)
    cache_file = parsed_store / f"{safe_replay_id(rid)}.json"
    if cache_file.is_file():
        try:
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            replay_path = payload.get("replay_path")
            if replay_path:
                candidates.append(Path(str(replay_path)).expanduser())
        except Exception:  # noqa: BLE001
            pass

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        if candidate.is_file():
            return candidate

    search_roots = [Path(demos_dir).expanduser()] if demos_dir else []
    if default_dir not in search_roots:
        search_roots.append(default_dir)
    rid_lower = rid.lower()
    for root in search_roots:
        if not root.exists() or not root.is_dir():
            continue
        matches: list[Path] = []
        for replay_file in root.rglob("*.replay"):
            try:
                if replay_file.stem.lower() == rid_lower:
                    matches.append(replay_file)
            except OSError:
                continue
        if matches:
            matches.sort(key=lambda path: path.stat().st_mtime_ns if path.exists() else 0, reverse=True)
            return matches[0]

    tried = ", ".join(str(path) for path in candidates[:4])
    raise HTTPException(status_code=404, detail=f"Replay not found for id '{rid}'. Tried: {tried}")


def open_directory_in_explorer(path: Path, label: str) -> None:
    try:
        if os.name == "nt":
            try:
                os.startfile(str(path))  # type: ignore[attr-defined]
            except OSError:
                subprocess.Popen(["explorer.exe", str(path)])
            return
        raise RuntimeError(f"open {label} directory is only supported on Windows")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Could not open {label} directory: {exc}") from exc
