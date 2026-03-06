from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timezone
from pathlib import Path
from typing import Iterable

from fastapi import HTTPException


ROOT_DIR = Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT_DIR / "tools"
RUNTIME_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else ROOT_DIR
APP_DIR = RUNTIME_DIR.parent if getattr(sys, "frozen", False) and RUNTIME_DIR.name.lower() == "backend" else RUNTIME_DIR


@dataclass
class ReplayDigest:
    replay_id: str
    file_path: Path
    file_size: int
    file_mtime_ns: int


def default_demos_dir() -> Path:
    candidates: list[Path] = []
    user_home = Path.home()
    candidates.append(user_home / "Documents" / "My Games" / "Rocket League" / "TAGame" / "Demos")

    for env_name in ("OneDriveCommercial", "OneDriveConsumer", "OneDrive"):
        root = os.environ.get(env_name, "").strip()
        if root:
            candidates.append(Path(root) / "Documents" / "My Games" / "Rocket League" / "TAGame" / "Demos")

    candidates.append(user_home / "OneDrive" / "Documents" / "My Games" / "Rocket League" / "TAGame" / "Demos")

    seen: set[str] = set()
    normalized: list[Path] = []
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(candidate)

    for candidate in normalized:
        if candidate.is_dir():
            return candidate
    return normalized[0]


def candidate_boxcars_paths() -> list[Path]:
    candidates: list[Path] = []
    env_path = os.environ.get("BOXCARS_EXE", "").strip()
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(RUNTIME_DIR / "tools" / "boxcars.exe")
    candidates.append(RUNTIME_DIR / "tools" / "boxcars")
    candidates.append(ROOT_DIR / "tools" / "boxcars.exe")
    candidates.append(ROOT_DIR / "tools" / "boxcars")
    candidates.append(ROOT_DIR / ".boxcars-src" / "target" / "release" / "examples" / "json.exe")
    candidates.append(ROOT_DIR / ".boxcars-src" / "target" / "release" / "examples" / "json")
    return candidates


def _normalized(path: Path) -> Path:
    return path.expanduser().resolve()


def _normalized_existing(candidates: Iterable[Path]) -> list[Path]:
    out: list[Path] = []
    for candidate in candidates:
        c = _normalized(candidate)
        if c.is_file():
            out.append(c)
    return out


def resolve_boxcars_path(
    boxcars_exe: str | None,
    *,
    allowed_user_paths: set[str] | None = None,
) -> Path:
    known_paths = _normalized_existing(candidate_boxcars_paths())
    if boxcars_exe:
        path = _normalized(Path(boxcars_exe))
        if path.is_file():
            allowed_from_ui = str(path) in (allowed_user_paths or set())
            if path in known_paths or allowed_from_ui:
                return path
            raise HTTPException(
                status_code=400,
                detail="boxcars executable path is not allowed. Use a known path or pick it via the UI browser.",
            )
        raise HTTPException(status_code=400, detail=f"boxcars executable not found: {path}")

    if known_paths:
        return known_paths[0]

    raise HTTPException(
        status_code=400,
        detail="Could not resolve boxcars executable. Set it in UI or BOXCARS_EXE env var.",
    )


def parse_date_param(value: str | None, *, is_end: bool) -> datetime | None:
    if not value:
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc

    # Interpret UI date inputs in local time, then normalize to UTC for mtime comparisons.
    local_tz = datetime.now().astimezone().tzinfo or timezone.utc
    bound = dtime.max if is_end else dtime.min
    local_dt = datetime.combine(parsed, bound, tzinfo=local_tz)
    return local_dt.astimezone(timezone.utc)


def get_replay_digests(
    demos_dir: Path,
    count: int,
    start_date: datetime | None,
    end_date: datetime | None,
) -> list[ReplayDigest]:
    if not demos_dir.exists() or not demos_dir.is_dir():
        raise HTTPException(status_code=400, detail=f"Demos directory does not exist: {demos_dir}")

    digests: list[ReplayDigest] = []
    for file in demos_dir.rglob("*.replay"):
        if not file.is_file():
            continue
        try:
            stat = file.stat()
        except OSError:
            continue
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        if start_date and mtime < start_date:
            continue
        if end_date and mtime > end_date:
            continue
        digests.append(
            ReplayDigest(
                replay_id=file.stem,
                file_path=file,
                file_size=stat.st_size,
                file_mtime_ns=stat.st_mtime_ns,
            )
        )

    digests.sort(key=lambda item: item.file_mtime_ns, reverse=True)
    return digests[: max(1, count)]
