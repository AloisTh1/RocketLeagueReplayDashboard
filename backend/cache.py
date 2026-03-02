from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .config import APP_DIR, ReplayDigest
except ImportError:
    from config import APP_DIR, ReplayDigest

DEFAULT_CACHE_ROOT_DIR = APP_DIR / "temp_local"
DEFAULT_PARSED_REPLAYS_DIR = DEFAULT_CACHE_ROOT_DIR / "cache"
DEFAULT_RAW_REPLAYS_DIR = DEFAULT_CACHE_ROOT_DIR / "raw"


def resolve_store_dirs(
    parsed_replays_dir: str | Path | None = None,
    raw_replays_dir: str | Path | None = None,
) -> tuple[Path, Path]:
    parsed_dir = Path(parsed_replays_dir).expanduser() if parsed_replays_dir else DEFAULT_PARSED_REPLAYS_DIR
    raw_dir = Path(raw_replays_dir).expanduser() if raw_replays_dir else DEFAULT_RAW_REPLAYS_DIR
    return parsed_dir, raw_dir


def _store_path(replay_id: str, parsed_replays_dir: str | Path | None = None) -> Path:
    safe = "".join(ch for ch in replay_id if ch.isalnum() or ch in ("-", "_"))
    if not safe:
        safe = "unknown_replay"
    parsed_dir, _ = resolve_store_dirs(parsed_replays_dir=parsed_replays_dir)
    return parsed_dir / f"{safe}.json"


def ensure_db(
    *,
    parsed_replays_dir: str | Path | None = None,
    raw_replays_dir: str | Path | None = None,
) -> None:
    # Backward-compatible function name; cache is file-only.
    parsed_dir, raw_dir = resolve_store_dirs(
        parsed_replays_dir=parsed_replays_dir,
        raw_replays_dir=raw_replays_dir,
    )
    DEFAULT_CACHE_ROOT_DIR.mkdir(parents=True, exist_ok=True)
    parsed_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)


def _raw_store_path(replay_id: str, raw_replays_dir: str | Path | None = None) -> Path:
    safe = "".join(ch for ch in replay_id if ch.isalnum() or ch in ("-", "_"))
    if not safe:
        safe = "unknown_replay"
    _, raw_dir = resolve_store_dirs(raw_replays_dir=raw_replays_dir)
    return raw_dir / f"{safe}.raw.json.gz"


def store_raw_json(
    replay_id: str,
    raw: dict[str, Any],
    *,
    raw_replays_dir: str | Path | None = None,
) -> Path:
    ensure_db(raw_replays_dir=raw_replays_dir)
    path = _raw_store_path(replay_id, raw_replays_dir=raw_replays_dir)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(raw, fh, ensure_ascii=True)
    return path


def _load_cached_payload(
    digest: ReplayDigest,
    parsed_replays_dir: str | Path | None = None,
) -> dict[str, Any] | None:
    path = _store_path(digest.replay_id, parsed_replays_dir=parsed_replays_dir)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if int(payload.get("file_size", -1)) != int(digest.file_size):
        return None
    if int(payload.get("file_mtime_ns", -1)) != int(digest.file_mtime_ns):
        return None
    return payload


def load_cached_canonical(
    digest: ReplayDigest,
    *,
    parsed_replays_dir: str | Path | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    payload = _load_cached_payload(digest, parsed_replays_dir=parsed_replays_dir)
    if payload is None:
        return None, None

    status = str(payload.get("status", "ok"))
    if status != "ok":
        return None, str(payload.get("error", "cached replay failed"))
    canonical = payload.get("canonical")
    if isinstance(canonical, dict):
        return canonical, None
    return None, "file cache missing canonical payload"


def load_cached_raw(
    digest: ReplayDigest,
    *,
    parsed_replays_dir: str | Path | None = None,
) -> dict[str, Any] | None:
    payload = _load_cached_payload(digest, parsed_replays_dir=parsed_replays_dir)
    if payload is None:
        return None
    raw = payload.get("raw")
    if isinstance(raw, dict):
        return raw
    return None


def is_replay_cached(
    digest: ReplayDigest,
    *,
    parsed_replays_dir: str | Path | None = None,
) -> bool:
    return _load_cached_payload(digest, parsed_replays_dir=parsed_replays_dir) is not None


def store_cache(
    digest: ReplayDigest,
    *,
    status: str,
    canonical: dict[str, Any] | None = None,
    raw: dict[str, Any] | None = None,
    error: str | None = None,
    parsed_replays_dir: str | Path | None = None,
    raw_replays_dir: str | Path | None = None,
) -> None:
    ensure_db(parsed_replays_dir=parsed_replays_dir, raw_replays_dir=raw_replays_dir)
    path = _store_path(digest.replay_id, parsed_replays_dir=parsed_replays_dir)
    payload: dict[str, Any] = {
        "replay_id": digest.replay_id,
        "replay_path": str(digest.file_path),
        "file_size": digest.file_size,
        "file_mtime_ns": digest.file_mtime_ns,
        "status": status,
        "error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if canonical is not None:
        payload["canonical"] = canonical
    if raw is not None:
        payload["raw"] = raw
    path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def clear_cache_store(
    *,
    parsed_replays_dir: str | Path | None = None,
    raw_replays_dir: str | Path | None = None,
) -> dict[str, int]:
    ensure_db(parsed_replays_dir=parsed_replays_dir, raw_replays_dir=raw_replays_dir)
    parsed_dir, raw_dir = resolve_store_dirs(
        parsed_replays_dir=parsed_replays_dir,
        raw_replays_dir=raw_replays_dir,
    )
    removed_files = 0
    if parsed_dir.exists():
        for path in parsed_dir.rglob("*.json"):
            try:
                path.unlink()
                removed_files += 1
            except OSError:
                continue
    if raw_dir.exists():
        for path in raw_dir.rglob("*.raw.json.gz"):
            try:
                path.unlink()
                removed_files += 1
            except OSError:
                continue
    return {"removed_rows": 0, "removed_files": removed_files}
