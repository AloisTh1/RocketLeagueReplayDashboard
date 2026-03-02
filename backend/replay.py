from __future__ import annotations

import json
import logging
import math
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .cache import load_cached_canonical, load_cached_raw, store_cache, store_raw_json
    from .config import ReplayDigest
except ImportError:
    from cache import load_cached_canonical, load_cached_raw, store_cache, store_raw_json
    from config import ReplayDigest

LOGGER = logging.getLogger("rl_local_dashboard")
BOXCARS_TIMEOUT_SECONDS = max(5, int(os.environ.get("BOXCARS_TIMEOUT_SECONDS", "45")))
MAX_REPLAY_SIZE_BYTES = max(1_000_000, int(os.environ.get("MAX_REPLAY_SIZE_BYTES", str(100 * 1024 * 1024))))

FIELD_X_MAX = 4096.0
FIELD_Y_MAX = 5120.0


def extract_json_text(stdout: str) -> str:
    stripped = stdout.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        return stripped
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return stripped[start : end + 1]
    raise ValueError("boxcars output did not contain JSON payload")


def run_boxcars_json(boxcars_exe: Path, replay_path: Path) -> dict[str, Any]:
    try:
        stat = replay_path.stat()
    except OSError as exc:
        raise RuntimeError(f"failed to stat replay file: {exc}") from exc
    if stat.st_size > MAX_REPLAY_SIZE_BYTES:
        raise RuntimeError(
            f"replay file too large ({stat.st_size} bytes), limit is {MAX_REPLAY_SIZE_BYTES} bytes"
        )
    try:
        payload_bytes = replay_path.read_bytes()
    except OSError as exc:
        raise RuntimeError(f"failed to read replay file: {exc}") from exc

    cmd = [str(boxcars_exe)]
    call_started = time.perf_counter()
    LOGGER.info("boxcars call started replay=%s cmd=%s", replay_path.name, cmd)
    try:
        completed = subprocess.run(
            cmd,
            input=payload_bytes,
            capture_output=True,
            timeout=BOXCARS_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"boxcars timed out after {BOXCARS_TIMEOUT_SECONDS}s") from exc
    except OSError as exc:
        raise RuntimeError(f"boxcars launch failed: {exc}") from exc

    elapsed = time.perf_counter() - call_started
    stderr = (completed.stderr or b"").decode("utf-8", errors="replace").strip()
    LOGGER.info(
        "boxcars call finished replay=%s rc=%s elapsed=%.2fs stderr=%s",
        replay_path.name,
        completed.returncode,
        elapsed,
        (stderr[:220] if stderr else "<empty>"),
    )

    if completed.returncode != 0:
        raise RuntimeError(f"boxcars failed rc={completed.returncode}: {stderr[:240]}")

    try:
        stdout_text = (completed.stdout or b"").decode("utf-8", errors="replace")
        payload = extract_json_text(stdout_text)
        data = json.loads(payload)
        if isinstance(data, dict):
            return data
        raise ValueError("boxcars JSON output is not an object")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"boxcars invalid JSON: {exc}") from exc


def walk_nodes(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_nodes(child)


def to_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return 0
        try:
            return int(float(value))
        except ValueError:
            return 0
    return 0


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def name_key(value: Any) -> str:
    text = to_text(value).lower()
    return "".join(ch for ch in text if ch.isalnum())


def id_key(value: Any) -> str:
    text = to_text(value).lower()
    return "".join(ch for ch in text if ch.isalnum())


def to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return False


def ratio(num: float, den: float) -> float:
    if den <= 0:
        return 0.0
    return num / den


def first_non_empty(data: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def normalize_player(player: dict[str, Any]) -> dict[str, Any] | None:
    stats = player.get("stats") if isinstance(player.get("stats"), dict) else {}
    name = first_non_empty(player, ["name", "player_name", "Name"])
    player_id = first_non_empty(
        player,
        ["online_id", "onlineId", "OnlineID", "unique_id", "player_id", "remote_id", "id"],
    )
    if str(player_id or "").strip() in ("", "0"):
        pid = player.get("PlayerID")
        if isinstance(pid, dict):
            fields = pid.get("fields")
            if isinstance(fields, dict):
                uid = str(fields.get("Uid", "")).strip()
                epic = str(fields.get("EpicAccountId", "")).strip()
                if uid and uid != "0":
                    player_id = uid
                elif epic and epic != "0":
                    player_id = epic
    def metric(*keys: str) -> Any:
        value = first_non_empty(player, list(keys))
        if value is not None:
            return value
        return first_non_empty(stats, list(keys))

    score = metric("score", "Score")
    goals = metric("goals", "Goals")
    assists = metric("assists", "Assists")
    saves = metric("saves", "Saves")
    shots = metric("shots", "Shots")
    demos = metric(
        "demolitions",
        "Demolitions",
        "demolitions_inflicted",
        "DemolitionsInflicted",
        "demolishes",
        "Demolishes",
        "demos",
        "Demos",
    )
    big_boosts = metric(
        "big_boosts",
        "BigBoosts",
        "boost_pickups_big",
        "BoostPickupsBig",
        "large_boost_pickups",
        "LargeBoostPickups",
    )
    small_boosts = metric(
        "small_boosts",
        "SmallBoosts",
        "boost_pickups_small",
        "BoostPickupsSmall",
        "small_boost_pickups",
        "SmallBoostPickups",
    )
    mmr = metric("mmr", "MMR")
    bot_value = metric("bBot", "bot", "is_bot")
    platform_obj = metric("Platform", "platform")
    platform = ""
    platform_kind = ""
    if isinstance(platform_obj, dict):
        platform = to_text(first_non_empty(platform_obj, ["value", "platform", "id"]))
        platform_kind = to_text(first_non_empty(platform_obj, ["kind", "type"]))
    elif platform_obj is not None:
        platform = to_text(platform_obj)

    if not name and not player_id:
        return None

    return {
        "name": str(name or ""),
        "player_id": str(player_id or ""),
        "team": to_int(first_non_empty(player, ["team", "team_index", "team_num", "Team"])),
        "score": to_int(score),
        "goals": to_int(goals),
        "assists": to_int(assists),
        "saves": to_int(saves),
        "shots": to_int(shots),
        "demos": to_int(demos),
        "big_boosts": to_int(big_boosts),
        "small_boosts": to_int(small_boosts),
        "mmr": to_float(mmr),
        "online_id": to_text(first_non_empty(player, ["OnlineID", "online_id", "onlineId"])),
        "platform": platform,
        "platform_kind": platform_kind,
        "is_bot": to_bool(bot_value),
        "won": first_non_empty(player, ["won", "winner", "is_winner"]),
    }


def extract_players(raw: dict[str, Any]) -> list[dict[str, Any]]:
    players: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int, int, int, int, int]] = set()

    properties = raw.get("properties")
    if isinstance(properties, dict):
        stats_list = properties.get("PlayerStats")
        if isinstance(stats_list, list):
            for item in stats_list:
                if not isinstance(item, dict):
                    continue
                parsed = normalize_player(item)
                if not parsed:
                    continue
                key = (
                    parsed["player_id"],
                    parsed["name"],
                    parsed["score"],
                    parsed["goals"],
                    parsed["assists"],
                    parsed["saves"],
                    parsed["shots"],
                )
                if key in seen:
                    continue
                seen.add(key)
                players.append(parsed)
            if players:
                return players

    for node in walk_nodes(raw):
        array = node.get("players")
        if not isinstance(array, list):
            continue
        for item in array:
            if not isinstance(item, dict):
                continue
            parsed = normalize_player(item)
            if not parsed:
                continue
            key = (
                parsed["player_id"],
                parsed["name"],
                parsed["score"],
                parsed["goals"],
                parsed["assists"],
                parsed["saves"],
                parsed["shots"],
            )
            if key in seen:
                continue
            seen.add(key)
            players.append(parsed)
    return players


def extract_teams(raw: dict[str, Any]) -> list[dict[str, Any]]:
    properties = raw.get("properties")
    if isinstance(properties, dict):
        if "Team0Score" in properties or "Team1Score" in properties:
            return [
                {"index": 0, "score": to_int(properties.get("Team0Score"))},
                {"index": 1, "score": to_int(properties.get("Team1Score"))},
            ]

    teams: list[dict[str, Any]] = []
    for node in walk_nodes(raw):
        array = node.get("teams")
        if not isinstance(array, list):
            continue
        for idx, item in enumerate(array):
            if not isinstance(item, dict):
                continue
            teams.append(
                {
                    "index": to_int(first_non_empty(item, ["index", "team", "team_index"])) or idx,
                    "score": to_int(first_non_empty(item, ["score", "Score"])),
                }
            )
        if teams:
            break
    return teams


def extract_metadata(raw: dict[str, Any]) -> dict[str, Any]:
    scalars: list[str] = []
    for node in walk_nodes(raw):
        for value in node.values():
            if isinstance(value, str):
                text = value.strip()
                if text:
                    scalars.append(text)

    properties = raw.get("properties") if isinstance(raw.get("properties"), dict) else {}
    merged = " ".join(scalars).lower()
    if isinstance(properties, dict):
        merged += " " + " ".join(to_text(v).lower() for v in properties.values() if isinstance(v, str))
    ranked = any(token in merged for token in ("ranked", "competitive"))
    tournament = "tournament" in merged

    game_mode = "Unknown"
    mode_tokens = [
        ("1v1", "1v1"),
        ("duel", "1v1"),
        ("2v2", "2v2"),
        ("doubles", "2v2"),
        ("3v3", "3v3"),
        ("standard", "3v3"),
        ("hoops", "Hoops"),
        ("rumble", "Rumble"),
        ("dropshot", "Dropshot"),
        ("snow day", "Snow Day"),
        ("heatseeker", "Heatseeker"),
    ]
    for token, label in mode_tokens:
        if token in merged:
            game_mode = label
            break

    if tournament:
        match_type = "Tournament"
    elif ranked:
        match_type = "Ranked"
    else:
        # Keep queue grouping concise and stable in UI.
        match_type = "Casual"

    parsed_date = None
    for key in ("date", "Date", "match_date", "start_time", "StartTime"):
        value = raw.get(key)
        if not value:
            continue
        if isinstance(value, str):
            try:
                parsed_date = datetime.fromisoformat(value.replace("Z", "+00:00"))
                break
            except ValueError:
                continue

    if not parsed_date and isinstance(properties, dict):
        epoch = properties.get("MatchStartEpoch")
        try:
            epoch_int = int(str(epoch))
            parsed_date = datetime.fromtimestamp(epoch_int, tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            parsed_date = None

    if not parsed_date:
        parsed_date = datetime.now(timezone.utc)
    elif not parsed_date.tzinfo:
        parsed_date = parsed_date.replace(tzinfo=timezone.utc)

    team_size = to_int(first_non_empty(properties, ["TeamSize", "team_size"]))
    total_seconds_played = to_int(first_non_empty(properties, ["TotalSecondsPlayed", "total_seconds_played"]))
    winning_team = to_int(first_non_empty(properties, ["WinningTeam", "winning_team"]))
    primary_player_team = to_int(first_non_empty(properties, ["PrimaryPlayerTeam", "primary_player_team"]))
    unfair_team_size = to_bool(first_non_empty(properties, ["UnfairTeamSize", "unfair_team_size"]))

    return {
        "date": parsed_date.isoformat(),
        "match_type": match_type,
        "game_mode": game_mode,
        "ranked": ranked,
        "tournament": tournament,
        "map_name": to_text(first_non_empty(properties, ["MapName", "map_name"])),
        "replay_name": to_text(first_non_empty(properties, ["ReplayName", "replay_name"])),
        "match_guid": to_text(first_non_empty(properties, ["MatchGUID", "MatchGuid", "match_guid"])),
        "game_version": to_text(first_non_empty(properties, ["GameVersion", "game_version"])),
        "build_version": to_text(first_non_empty(properties, ["BuildVersion", "build_version"])),
        "build_id": to_text(first_non_empty(properties, ["BuildID", "build_id"])),
        "team_size": team_size,
        "total_seconds_played": total_seconds_played,
        "winning_team": winning_team,
        "primary_player_team": primary_player_team,
        "unfair_team_size": unfair_team_size,
        "raw_game_type": to_text(raw.get("game_type")),
    }


def _boost_component_suffix(name: str) -> str:
    marker = "CarComponent_Boost_TA_"
    if marker not in name:
        return ""
    return name.split(marker, 1)[-1].strip()


def _actor_suffix(name: str, prefix: str) -> str:
    marker = f"{prefix}_"
    text = str(name or "").strip()
    if marker not in text:
        return ""
    return text.split(marker, 1)[-1].strip()


def _is_opaque_pri_name(value: Any) -> bool:
    text = to_text(value)
    if not text:
        return False
    return bool(re.fullmatch(r"[0-9A-Fa-f]{32}(?:-\d+)?", text))


def _name_from_unique_id(unique_obj: Any, player_id_to_name: dict[str, str]) -> str:
    if not isinstance(unique_obj, dict):
        return ""

    fields = unique_obj.get("fields")
    if isinstance(fields, dict):
        uid = to_text(fields.get("Uid")).lower()
        if uid and uid in player_id_to_name:
            return player_id_to_name[uid]
        epic = to_text(fields.get("EpicAccountId")).lower()
        if epic and epic in player_id_to_name:
            return player_id_to_name[epic]

    remote = unique_obj.get("remote_id")
    if isinstance(remote, dict):
        for value in remote.values():
            if isinstance(value, str):
                candidate = value.strip().lower()
                if candidate and candidate in player_id_to_name:
                    return player_id_to_name[candidate]
                continue
            if not isinstance(value, dict):
                continue
            for sub_key in ("online_id", "id"):
                candidate = to_text(value.get(sub_key)).lower()
                if candidate and candidate in player_id_to_name:
                    return player_id_to_name[candidate]
    return ""


def _is_pri_actor_name(value: Any) -> bool:
    text = to_text(value).lower()
    if not text:
        return False
    if "pri_ta" in text:
        return True
    return bool(re.search(r"pri_[a-z0-9]+_ta(?:_|$)", text))


def _is_car_actor_name(value: Any) -> bool:
    text = to_text(value).lower()
    if not text:
        return False
    if "car_ta" in text or "ta_car" in text:
        return True
    return bool(re.search(r"car_[a-z0-9]+_ta(?:_|$)", text))


def _pri_actor_suffix(name: Any) -> str:
    text = to_text(name)
    suffix = _actor_suffix(text, "PRI_TA")
    if suffix:
        return suffix
    match = re.search(r"PRI_TA[_-]?(\d+)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.search(r"PRI_[A-Za-z0-9]+_TA[_-]?(\d+)", text, flags=re.IGNORECASE)
    return match.group(1) if match else ""


def _car_actor_suffix(name: Any) -> str:
    text = to_text(name)
    suffix = _actor_suffix(text, "Car_TA")
    if suffix:
        return suffix
    match = re.search(r"(?:Car_TA|TA_CAR)[_-]?(\d+)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.search(r"Car_[A-Za-z0-9]+_TA[_-]?(\d+)", text, flags=re.IGNORECASE)
    return match.group(1) if match else ""


def _sanitize_player_name(value: Any) -> str:
    text = to_text(value)
    if not text:
        return ""
    low = text.lower()
    if low in {"none", "null", "unknown"}:
        return ""
    if _is_opaque_pri_name(text):
        return ""
    if _is_pri_actor_name(text) or _is_car_actor_name(text):
        return ""
    if low.startswith("carcomponent_boost_ta_") or low.startswith("vehiclepickup_boost_ta_"):
        return ""
    return text


def _canonical_car_actor_name(name: Any, actor_id: int | None = None) -> str:
    suffix = _car_actor_suffix(name)
    if suffix:
        return f"Car_TA_{suffix}"
    if actor_id is not None and actor_id > 0:
        return f"Car_TA_{actor_id}"
    if _is_car_actor_name(name):
        return "Car_TA_0"
    return to_text(name)


def estimate_boost_from_frames(raw: dict[str, Any]) -> dict[str, dict[str, float]]:
    """
    Fallback boost estimator from network frames.

    Why this exists:
    - Some replays expose no boost pickup stats in PlayerStats.
    - We still have ReplicatedBoost + PickupNew events, so we approximate pickups by player.
    """
    names = raw.get("names")
    frames = (raw.get("network_frames") or {}).get("frames")
    if not isinstance(names, list) or not isinstance(frames, list):
        return {}

    player_stats: dict[str, dict[str, float]] = {}
    actor_name: dict[int, str] = {}
    pri_to_player: dict[int, str] = {}
    car_to_pri: dict[int, int] = {}
    boost_component_to_car: dict[int, int] = {}
    boost_component_amount_prev: dict[int, int] = {}
    boost_pad_state_prev: dict[int, int] = {}
    pri_actor_by_suffix: dict[str, int] = {}
    car_actor_by_suffix: dict[str, int] = {}

    parsed_players = extract_players(raw)
    player_id_to_name: dict[str, str] = {}
    for player in parsed_players:
        if not isinstance(player, dict):
            continue
        pname = to_text(player.get("name"))
        if not pname:
            continue
        for key in ("player_id", "online_id"):
            pid = to_text(player.get(key)).lower()
            if pid:
                player_id_to_name[pid] = pname

    def ensure_player(player_name: str) -> dict[str, float]:
        key = player_name.strip()
        data = player_stats.get(key)
        if data is None:
            data = {
                "big_boosts": 0.0,
                "small_boosts": 0.0,
                "boost_gained": 0.0,
                "boost_used": 0.0,
                "boost_pickups": 0.0,
                "big_boosts_from_delta": 0.0,
                "small_boosts_from_delta": 0.0,
            }
            player_stats[key] = data
        return data

    def cleanup_actor(aid: int) -> None:
        actor_name.pop(aid, None)
        pri_to_player.pop(aid, None)
        car_to_pri.pop(aid, None)
        boost_component_to_car.pop(aid, None)
        boost_component_amount_prev.pop(aid, None)
        boost_pad_state_prev.pop(aid, None)

        for suffix, mapped in list(pri_actor_by_suffix.items()):
            if mapped == aid:
                pri_actor_by_suffix.pop(suffix, None)
        for suffix, mapped in list(car_actor_by_suffix.items()):
            if mapped == aid:
                car_actor_by_suffix.pop(suffix, None)
        for car_actor, pri_actor in list(car_to_pri.items()):
            if car_actor == aid or pri_actor == aid:
                car_to_pri.pop(car_actor, None)
        for component_actor, car_actor in list(boost_component_to_car.items()):
            if component_actor == aid or car_actor == aid:
                boost_component_to_car.pop(component_actor, None)

    def resolve_player_from_pri(pri_actor: int) -> str:
        if pri_actor <= 0:
            return ""
        name = to_text(pri_to_player.get(pri_actor))
        if name:
            return name
        pri_name = actor_name.get(pri_actor, "")
        if pri_name.startswith("PRI_TA_"):
            suffix = _actor_suffix(pri_name, "PRI_TA")
            mapped = pri_actor_by_suffix.get(suffix) if suffix else None
            if mapped is not None and mapped != pri_actor:
                return to_text(pri_to_player.get(mapped))
        return ""

    def resolve_player_from_car(car_actor: int) -> str:
        if car_actor <= 0:
            return ""
        pri_actor = car_to_pri.get(car_actor)
        if pri_actor is None:
            car_name = actor_name.get(car_actor, "")
            if car_name.startswith("Car_TA_"):
                suffix = _actor_suffix(car_name, "Car_TA")
                if suffix:
                    pri_actor = pri_actor_by_suffix.get(suffix)
                    if pri_actor is not None:
                        car_to_pri[car_actor] = pri_actor
        if pri_actor is None:
            return ""
        return resolve_player_from_pri(pri_actor)

    def resolve_player_from_actor(actor_id: int) -> str:
        if actor_id <= 0:
            return ""
        src = actor_name.get(actor_id, "")
        if src.startswith("PRI_TA_"):
            return resolve_player_from_pri(actor_id)
        if src.startswith("Car_TA_"):
            return resolve_player_from_car(actor_id)
        if src.startswith("CarComponent_Boost_TA_"):
            car_actor = boost_component_to_car.get(actor_id)
            if car_actor is None:
                suffix = _boost_component_suffix(src)
                if suffix:
                    car_actor = car_actor_by_suffix.get(suffix)
                    if car_actor is not None:
                        boost_component_to_car[actor_id] = car_actor
            if car_actor is not None:
                return resolve_player_from_car(car_actor)
        direct = resolve_player_from_car(actor_id)
        if direct:
            return direct
        return ""

    # Single pass over frames: actor ids can be reused, so mapping must stay time-local.
    for frame in frames:
        if not isinstance(frame, dict):
            continue

        for deleted in frame.get("deleted_actors") or []:
            deleted_id = to_int(deleted.get("actor_id")) if isinstance(deleted, dict) else to_int(deleted)
            if deleted_id > 0:
                cleanup_actor(deleted_id)

        for item in frame.get("new_actors") or []:
            if not isinstance(item, dict):
                continue
            aid = to_int(item.get("actor_id"))
            if aid <= 0:
                continue
            cleanup_actor(aid)
            nid = to_int(item.get("name_id"))
            if 0 <= nid < len(names):
                nm = to_text(names[nid])
                if nm:
                    actor_name[aid] = nm
                    if nm.startswith("PRI_TA_"):
                        suffix = _actor_suffix(nm, "PRI_TA")
                        if suffix:
                            pri_actor_by_suffix[suffix] = aid
                    elif nm.startswith("Car_TA_"):
                        suffix = _actor_suffix(nm, "Car_TA")
                        if suffix:
                            car_actor_by_suffix[suffix] = aid

        for item in frame.get("updated_actors") or []:
            if not isinstance(item, dict):
                continue
            aid = to_int(item.get("actor_id"))
            if aid <= 0:
                continue
            attr = item.get("attribute")
            if not isinstance(attr, dict):
                continue

            src_name = actor_name.get(aid, "")
            if src_name.startswith("PRI_TA_"):
                player_name = to_text(attr.get("String"))
                # Some replays emit opaque GUID-like strings for PRI names later in the match.
                # Ignore those updates so we keep the readable player mapping for boost attribution.
                if _is_opaque_pri_name(player_name):
                    player_name = ""
                if not player_name:
                    player_name = _name_from_unique_id(attr.get("UniqueId"), player_id_to_name)
                if player_name:
                    pri_to_player[aid] = player_name
                active = attr.get("ActiveActor")
                if isinstance(active, dict):
                    car_actor = to_int(active.get("actor"))
                    if car_actor > 0:
                        car_name = actor_name.get(car_actor, "")
                        if car_name.startswith("Car_TA_"):
                            car_to_pri[car_actor] = aid
            elif src_name.startswith("Car_TA_"):
                active = attr.get("ActiveActor")
                if isinstance(active, dict):
                    pri_actor = to_int(active.get("actor"))
                    if pri_actor > 0:
                        pri_name = actor_name.get(pri_actor, "")
                        if pri_name.startswith("PRI_TA_"):
                            car_to_pri[aid] = pri_actor
                if aid not in car_to_pri:
                    suffix = _actor_suffix(src_name, "Car_TA")
                    if suffix:
                        pri_actor = pri_actor_by_suffix.get(suffix)
                        if pri_actor is not None:
                            car_to_pri[aid] = pri_actor
            elif src_name.startswith("CarComponent_Boost_TA_"):
                active = attr.get("ActiveActor")
                if isinstance(active, dict):
                    car_actor = to_int(active.get("actor"))
                    if car_actor > 0:
                        car_name = actor_name.get(car_actor, "")
                        if car_name.startswith("Car_TA_"):
                            boost_component_to_car[aid] = car_actor

            rb = attr.get("ReplicatedBoost")
            if isinstance(rb, dict):
                car_actor = boost_component_to_car.get(aid)
                if car_actor is None and src_name.startswith("CarComponent_Boost_TA_"):
                    suffix = _boost_component_suffix(src_name)
                    if suffix:
                        car_actor = car_actor_by_suffix.get(suffix)
                        if car_actor is not None:
                            boost_component_to_car[aid] = car_actor
                if car_actor is not None:
                    player_name = resolve_player_from_car(car_actor)
                    if player_name:
                        stats = ensure_player(player_name)
                        amount = to_int(rb.get("boost_amount"))
                        prev = boost_component_amount_prev.get(aid)
                        if prev is not None:
                            delta = amount - prev
                            if delta > 0:
                                stats["boost_gained"] += float(delta)
                                if delta >= 34:
                                    stats["big_boosts_from_delta"] += 1.0
                                elif delta >= 8:
                                    stats["small_boosts_from_delta"] += 1.0
                            elif delta < 0:
                                stats["boost_used"] += float(-delta)
                        boost_component_amount_prev[aid] = amount

            pickup = attr.get("PickupNew")
            if isinstance(pickup, dict):
                picked_up = to_int(pickup.get("picked_up"))
                previous = boost_pad_state_prev.get(aid)
                boost_pad_state_prev[aid] = picked_up
                if not src_name.startswith("VehiclePickup_Boost_TA_"):
                    continue
                # 255 = available; transitions away from 255 represent a pickup cooldown start.
                if previous != 255:
                    continue
                if picked_up == 255:
                    continue
                instigator = to_int(pickup.get("instigator"))
                if instigator <= 0:
                    continue
                player_name = resolve_player_from_actor(instigator)
                if not player_name:
                    continue
                stats = ensure_player(player_name)
                stats["boost_pickups"] += 1.0
                # RL encodes boost-pad cooldown in quarter-seconds (odd countdown values).
                # Small pads are around 15 and below; large pads are above that.
                if picked_up >= 17:
                    stats["big_boosts"] += 1.0
                elif picked_up > 0:
                    stats["small_boosts"] += 1.0

    for stats in player_stats.values():
        big_from_delta = float(stats.pop("big_boosts_from_delta", 0.0) or 0.0)
        small_from_delta = float(stats.pop("small_boosts_from_delta", 0.0) or 0.0)
        if (stats.get("big_boosts", 0.0) or 0.0) <= 0 and (stats.get("small_boosts", 0.0) or 0.0) <= 0:
            stats["big_boosts"] = big_from_delta
            stats["small_boosts"] = small_from_delta
            if (stats.get("boost_pickups", 0.0) or 0.0) <= 0:
                stats["boost_pickups"] = big_from_delta + small_from_delta

    return player_stats


def canonicalize_replay(raw: dict[str, Any], replay_id: str) -> dict[str, Any]:
    metadata = extract_metadata(raw)
    players = extract_players(raw)
    teams = extract_teams(raw)
    if not players:
        raise RuntimeError("boxcars returned no player stats")

    # Boost fallback: fill missing boost pickups when PlayerStats omitted them.
    boost_fallback = estimate_boost_from_frames(raw)
    if boost_fallback:
        fallback_by_key = {
            key: value
            for raw_name, value in boost_fallback.items()
            if (key := name_key(raw_name))
        }
        for player in players:
            current_big = to_int(player.get("big_boosts"))
            current_small = to_int(player.get("small_boosts"))
            if current_big > 0 or current_small > 0:
                continue
            name = to_text(player.get("name"))
            extra = boost_fallback.get(name)
            if not extra and name:
                lower_name = name.lower()
                for key_name, value in boost_fallback.items():
                    if key_name.lower() == lower_name:
                        extra = value
                        break
            if not extra and name:
                extra = fallback_by_key.get(name_key(name))
            if not extra:
                continue
            player["big_boosts"] = to_int(extra.get("big_boosts"))
            player["small_boosts"] = to_int(extra.get("small_boosts"))

    return {
        "replay_id": replay_id,
        "date": metadata["date"],
        "match_type": metadata["match_type"],
        "game_mode": metadata["game_mode"],
        "ranked": metadata["ranked"],
        "tournament": metadata["tournament"],
        "map_name": metadata["map_name"],
        "replay_name": metadata["replay_name"],
        "match_guid": metadata["match_guid"],
        "game_version": metadata["game_version"],
        "build_version": metadata["build_version"],
        "build_id": metadata["build_id"],
        "team_size": metadata["team_size"],
        "total_seconds_played": metadata["total_seconds_played"],
        "winning_team": metadata["winning_team"],
        "primary_player_team": metadata["primary_player_team"],
        "unfair_team_size": metadata["unfair_team_size"],
        "raw_game_type": metadata["raw_game_type"],
        "players": players,
        "teams": teams,
    }


def parse_or_cache_replay(
    digest: ReplayDigest,
    boxcars_exe: Path | None,
    use_cache: bool = True,
    write_cache: bool = True,
    cache_dir: str | None = None,
    raw_dir: str | None = None,
) -> tuple[dict[str, Any] | None, bool, str | None]:
    def _needs_row_refresh(canonical: dict[str, Any]) -> bool:
        players = canonical.get("players")
        return not isinstance(players, list) or len(players) == 0

    def _needs_boost_refresh(canonical: dict[str, Any]) -> bool:
        players = canonical.get("players")
        if not isinstance(players, list) or not players:
            return False
        has_any_non_zero = False
        for p in players:
            if not isinstance(p, dict):
                continue
            big = float(p.get("big_boosts", 0) or 0)
            small = float(p.get("small_boosts", 0) or 0)
            if big > 0 or small > 0:
                has_any_non_zero = True
                break
        return not has_any_non_zero

    cached_error: str | None = None
    if use_cache:
        cached, cached_error = load_cached_canonical(digest, parsed_replays_dir=cache_dir)
        if cached:
            needs_refresh = _needs_row_refresh(cached) or _needs_boost_refresh(cached)
            if needs_refresh:
                raw_cached = load_cached_raw(digest, parsed_replays_dir=cache_dir)
                if isinstance(raw_cached, dict):
                    try:
                        refreshed = canonicalize_replay(raw_cached, replay_id=digest.replay_id)
                        if use_cache and write_cache:
                            store_cache(
                                digest,
                                status="ok",
                                canonical=refreshed,
                                raw=raw_cached,
                                error=None,
                                parsed_replays_dir=cache_dir,
                                raw_replays_dir=raw_dir,
                            )
                        return refreshed, True, None
                    except Exception as exc:  # noqa: BLE001
                        LOGGER.warning(
                            "cache boost refresh failed replay=%s error=%s",
                            digest.replay_id,
                            exc,
                        )
                # If cache looks stale and raw cache is unavailable, only reuse stale cache
                # when we cannot parse the replay again.
                if boxcars_exe is None:
                    return cached, True, None
                LOGGER.info("stale cache detected; reparsing replay=%s", digest.replay_id)
            else:
                # Fast cache-hit path: avoid boxcars/raw rehydration on load-cached runs.
                return cached, True, None
        if cached_error:
            # Reuse cached failure (timeout/invalid parse) to avoid re-running expensive broken replays.
            return None, True, cached_error

    if boxcars_exe is None:
        return None, False, "boxcars unavailable and replay not found in local cache"

    try:
        raw = run_boxcars_json(boxcars_exe, digest.file_path)
        if write_cache:
            try:
                # Keep raw parser output for long-term resilience if canonical parsing changes.
                store_raw_json(digest.replay_id, raw, raw_replays_dir=raw_dir)
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning("could not store raw replay json replay=%s error=%s", digest.replay_id, exc)
        canonical = canonicalize_replay(raw, replay_id=digest.replay_id)
        if use_cache and write_cache:
            store_cache(
                digest,
                status="ok",
                canonical=canonical,
                raw=raw,
                error=None,
                parsed_replays_dir=cache_dir,
                raw_replays_dir=raw_dir,
            )
        return canonical, False, None
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
        if use_cache and write_cache:
            store_cache(
                digest,
                status="failed",
                canonical=None,
                error=error,
                parsed_replays_dir=cache_dir,
                raw_replays_dir=raw_dir,
            )
        return None, False, error or cached_error


def parse_replay_date(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.now(timezone.utc)
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def pick_player(
    players: list[dict[str, Any]],
    player_id: str,
    highlight_name: str,
) -> dict[str, Any] | None:
    target_id = id_key(player_id)
    target_name = (highlight_name or "").strip().lower()

    if target_id:
        for player in players:
            pid = id_key(player.get("player_id"))
            oid = id_key(player.get("online_id"))
            if (
                (pid and (pid == target_id or target_id in pid or pid in target_id))
                or (oid and (oid == target_id or target_id in oid or oid in target_id))
            ):
                return player

    if target_name:
        for player in players:
            name = str(player.get("name", "")).lower()
            if target_name == name or target_name in name:
                return player

    return players[0] if players else None


def resolve_won(selected: dict[str, Any], replay: dict[str, Any]) -> bool:
    selected_won = selected.get("won")
    if isinstance(selected_won, bool):
        return selected_won

    teams = replay.get("teams") or []
    if not isinstance(teams, list) or len(teams) < 2:
        return False

    team_scores: dict[int, int] = {}
    for team in teams:
        if not isinstance(team, dict):
            continue
        idx = to_int(team.get("index"))
        score = to_int(team.get("score"))
        team_scores[idx] = score

    team_idx = to_int(selected.get("team"))
    if team_idx not in team_scores or len(team_scores) < 2:
        return False

    my_score = team_scores[team_idx]
    other_score = max(score for idx, score in team_scores.items() if idx != team_idx)
    return my_score > other_score


def build_row(
    replay: dict[str, Any],
    *,
    player_id: str,
    highlight_name: str,
) -> dict[str, Any] | None:
    players = replay.get("players") or []
    if not isinstance(players, list) or not players:
        return None
    selected = pick_player(players, player_id=player_id, highlight_name=highlight_name)
    if not selected:
        return None

    primary_player_team = to_int(first_non_empty(replay, ["primary_player_team", "PrimaryPlayerTeam"]))
    default_team = to_int((players[0] or {}).get("team")) if players else 0
    selected_team = to_int(selected.get("team"))
    if selected_team not in (0, 1):
        selected_team = primary_player_team if primary_player_team in (0, 1) else default_team
    if selected_team not in (0, 1):
        selected_team = 0

    team_players = [p for p in players if to_int(p.get("team")) == selected_team]
    if not team_players:
        selected_team = to_int(selected.get("team"))
        team_players = [p for p in players if to_int(p.get("team")) == selected_team]
    opponents = [p for p in players if to_int(p.get("team")) != selected_team]

    def platform_code(value: Any) -> str:
        text = to_text(value).lower()
        if "steam" in text:
            return "S"
        if "epic" in text:
            return "E"
        if "xbox" in text:
            return "X"
        if "ps4" in text or "ps5" in text or "playstation" in text:
            return "P"
        if "switch" in text:
            return "N"
        return "?"

    def serialize_player(player: dict[str, Any]) -> dict[str, Any]:
        platform = to_text(player.get("platform"))
        is_bot = bool(player.get("is_bot"))
        return {
            "name": to_text(player.get("name")),
            "player_id": to_text(player.get("player_id")),
            "online_id": to_text(player.get("online_id")),
            "score": to_int(player.get("score")),
            "goals": to_int(player.get("goals")),
            "assists": to_int(player.get("assists")),
            "saves": to_int(player.get("saves")),
            "shots": to_int(player.get("shots")),
            "demos": to_int(player.get("demos")),
            "big_boosts": to_int(player.get("big_boosts")),
            "small_boosts": to_int(player.get("small_boosts")),
            "platform": platform,
            "platform_code": "B" if is_bot else platform_code(platform),
            "is_bot": is_bot,
        }

    def total(metric: str, roster: list[dict[str, Any]]) -> float:
        return sum(float(p.get(metric, 0) or 0) for p in roster)

    team_score_total = total("score", team_players)
    team_goals_total = total("goals", team_players)
    team_assists_total = total("assists", team_players)
    team_saves_total = total("saves", team_players)
    team_shots_total = total("shots", team_players)
    team_demos_total = total("demos", team_players)
    team_big_boosts_total = total("big_boosts", team_players)
    team_small_boosts_total = total("small_boosts", team_players)

    opp_score_total = total("score", opponents)
    opp_goals_total = total("goals", opponents)
    opp_assists_total = total("assists", opponents)
    opp_saves_total = total("saves", opponents)
    opp_shots_total = total("shots", opponents)
    opp_demos_total = total("demos", opponents)
    opp_big_boosts_total = total("big_boosts", opponents)
    opp_small_boosts_total = total("small_boosts", opponents)

    team_boost_total = team_big_boosts_total + team_small_boosts_total
    opp_boost_total = opp_big_boosts_total + opp_small_boosts_total

    score = team_score_total
    goals = team_goals_total
    assists = team_assists_total
    saves = team_saves_total
    shots = team_shots_total
    demos = team_demos_total
    boost_total = team_boost_total

    shot_accuracy = ratio(goals, shots)
    score_per_shot = ratio(score, shots)
    score_per_goal = ratio(score, goals)
    save_to_shot_ratio = ratio(saves, shots)
    non_shot_impact = assists + saves + demos
    pressure_index = (
        score * 0.01
        + goals * 2.0
        + assists * 1.5
        + saves * 1.4
        + shots * 0.7
        + demos * 0.8
    )

    lobby_score_total = score + opp_score_total
    lobby_goals_total = goals + opp_goals_total
    lobby_assists_total = assists + opp_assists_total
    lobby_saves_total = saves + opp_saves_total
    lobby_shots_total = shots + opp_shots_total
    lobby_demos_total = demos + opp_demos_total

    team_avg_score = ratio(team_score_total, float(max(1, len(team_players))))

    selected_name_key = name_key(selected.get("name"))
    selected_pid = to_text(selected.get("player_id")).lower()
    selected_oid = to_text(selected.get("online_id")).lower()

    def _is_selected_player(player: dict[str, Any]) -> bool:
        pid = to_text(player.get("player_id")).lower()
        oid = to_text(player.get("online_id")).lower()
        if selected_pid and pid and selected_pid == pid:
            return True
        if selected_oid and oid and selected_oid == oid:
            return True
        return bool(selected_name_key and selected_name_key == name_key(player.get("name")))

    team_names = [str(p.get("name", "")).strip() for p in team_players if str(p.get("name", "")).strip()]
    opponent_names = [str(p.get("name", "")).strip() for p in opponents if str(p.get("name", "")).strip()]
    mate_names = [
        str(p.get("name", "")).strip()
        for p in team_players
        if str(p.get("name", "")).strip() and not _is_selected_player(p)
    ]
    team_players_detail = [serialize_player(p) for p in team_players]
    opponent_players_detail = [serialize_player(p) for p in opponents]

    player_name = str(selected.get("name", ""))
    target_id = (player_id or "").strip().lower()
    id_highlight = False
    if target_id:
        for p in players:
            pid = str(p.get("player_id", "")).lower()
            oid = str(p.get("online_id", "")).lower()
            if (pid and (target_id == pid or target_id in pid)) or (oid and (target_id == oid or target_id in oid)):
                id_highlight = True
                break
    highlight_norm = (highlight_name or "").strip().lower()
    name_highlight = False
    if highlight_norm:
        for p in players:
            pname = str(p.get("name", "")).lower()
            if highlight_norm == pname or highlight_norm in pname:
                name_highlight = True
                break
    highlighted = bool(id_highlight or name_highlight)
    replay_date = parse_replay_date(str(replay.get("date", "")))

    teams = replay.get("teams") if isinstance(replay.get("teams"), list) else []
    team_scores: dict[int, int] = {}
    for team in teams:
        if not isinstance(team, dict):
            continue
        team_scores[to_int(team.get("index"))] = to_int(team.get("score"))
    team_score = team_scores.get(selected_team, 0)
    opp_score = max([score for idx, score in team_scores.items() if idx != selected_team] or [0])
    won = team_score > opp_score if team_scores else resolve_won(selected, replay)

    return {
        "id": replay.get("replay_id", ""),
        "date": replay_date.isoformat(),
        "player_name": player_name,
        "player_id": str(selected.get("player_id", "")),
        "match_type": replay.get("match_type", "Unknown"),
        "game_mode": replay.get("game_mode", "Unknown"),
        "ranked": bool(replay.get("ranked", False)),
        "tournament": bool(replay.get("tournament", False)),
        "won": won,
        "highlighted": highlighted,
        "team": selected_team,
        "team_color": "blue" if selected_team == 0 else "orange",
        "team_score": team_score,
        "opponent_score": opp_score,
        "team_goal_diff": team_score - opp_score,
        "map_name": to_text(replay.get("map_name")),
        "replay_name": to_text(replay.get("replay_name")),
        "game_version": to_text(replay.get("game_version")),
        "build_version": to_text(replay.get("build_version")),
        "build_id": to_text(replay.get("build_id")),
        "raw_game_type": to_text(replay.get("raw_game_type")),
        "team_size": to_int(replay.get("team_size")),
        "duration_seconds": to_int(replay.get("total_seconds_played")),
        "teammate_names": mate_names,
        "team_player_names": team_names,
        "opponent_player_names": opponent_names,
        "team_players": team_players_detail,
        "opponent_players": opponent_players_detail,
        "teammate_avg_score": team_avg_score,
        "online_id": to_text(selected.get("online_id")),
        "platform": to_text(selected.get("platform")),
        "platform_kind": to_text(selected.get("platform_kind")),
        "is_bot": bool(selected.get("is_bot")),
        "player_score": to_int(selected.get("score")),
        "player_goals": to_int(selected.get("goals")),
        "player_assists": to_int(selected.get("assists")),
        "player_saves": to_int(selected.get("saves")),
        "player_shots": to_int(selected.get("shots")),
        "player_demos": to_int(selected.get("demos")),
        "player_big_boosts": to_int(selected.get("big_boosts")),
        "player_small_boosts": to_int(selected.get("small_boosts")),
        "score": score,
        "goals": goals,
        "assists": assists,
        "saves": saves,
        "shots": shots,
        "demos": demos,
        "big_boosts": team_big_boosts_total,
        "small_boosts": team_small_boosts_total,
        "team_big_boosts": team_big_boosts_total,
        "team_small_boosts": team_small_boosts_total,
        "team_boost_total": team_boost_total,
        "opponent_big_boosts": opp_big_boosts_total,
        "opponent_small_boosts": opp_small_boosts_total,
        "opponent_boost_total": opp_boost_total,
        "mmr": selected.get("mmr"),
        "boost_total": boost_total,
        "big_boost_share": ratio(team_big_boosts_total, boost_total),
        "small_boost_share": ratio(team_small_boosts_total, boost_total),
        "shot_accuracy": shot_accuracy,
        "score_per_shot": score_per_shot,
        "score_per_goal": score_per_goal,
        "save_to_shot_ratio": save_to_shot_ratio,
        "non_shot_impact": non_shot_impact,
        "pressure_index": pressure_index,
        "score_share_team": ratio(score, lobby_score_total),
        "goals_share_team": ratio(goals, lobby_goals_total),
        "assists_share_team": ratio(assists, lobby_assists_total),
        "saves_share_team": ratio(saves, lobby_saves_total),
        "shots_share_team": ratio(shots, lobby_shots_total),
        "demos_share_team": ratio(demos, lobby_demos_total),
        "score_diff_vs_others": score - opp_score_total,
        "score_diff_vs_mate": score - team_avg_score,
        "score_diff_vs_opponents": score - opp_score_total,
        "goals_diff_vs_others": goals - opp_goals_total,
        "goals_diff_vs_opponents": goals - opp_goals_total,
        "assists_diff_vs_others": assists - opp_assists_total,
        "assists_diff_vs_opponents": assists - opp_assists_total,
        "saves_diff_vs_others": saves - opp_saves_total,
        "saves_diff_vs_opponents": saves - opp_saves_total,
        "shots_diff_vs_others": shots - opp_shots_total,
        "shots_diff_vs_opponents": shots - opp_shots_total,
        "demos_diff_vs_others": demos - opp_demos_total,
        "demos_diff_vs_opponents": demos - opp_demos_total,
        "big_boosts_diff_vs_others": team_big_boosts_total - opp_big_boosts_total,
        "small_boosts_diff_vs_others": team_small_boosts_total - opp_small_boosts_total,
    }


def summarize_monthly(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        dt = parse_replay_date(str(row.get("date")))
        key = f"{dt.year:04d}-{dt.month:02d}"
        bucket = buckets.setdefault(key, {"month": key, "games": 0, "wins": 0, "score_total": 0.0})
        bucket["games"] += 1
        bucket["wins"] += 1 if row.get("won") else 0
        bucket["score_total"] += float(row.get("score", 0) or 0)

    monthly = []
    for item in sorted(buckets.values(), key=lambda x: x["month"]):
        games = item["games"] or 1
        monthly.append(
            {
                "month": item["month"],
                "games": item["games"],
                "wins": item["wins"],
                "win_rate": item["wins"] / games,
                "avg_score": item["score_total"] / games,
            }
        )
    return monthly


def extract_spatial_summary(
    raw: dict[str, Any],
    *,
    selected_player_name: str | None = None,
    max_actor_count: int = 6,
    max_points_per_actor: int = 160,
    heat_grid: int = 26,
) -> dict[str, Any]:
    names = raw.get("names")
    frames = (raw.get("network_frames") or {}).get("frames")
    if not isinstance(names, list) or not isinstance(frames, list):
        return {"heatmap": [], "trajectories": [], "actors": 0}

    actor_name: dict[int, str] = {}
    actor_points: dict[int, list[tuple[int, float, float]]] = {}
    pri_actor_name: dict[int, str] = {}
    car_actor_to_pri_actor: dict[int, int] = {}
    pri_actor_by_suffix: dict[str, int] = {}
    selected_player_norm = (selected_player_name or "").strip().lower()
    parsed_players = extract_players(raw)
    known_players = sorted({str(p.get("name", "")).strip() for p in parsed_players if str(p.get("name", "")).strip()})
    player_id_to_name: dict[str, str] = {}
    for p in parsed_players:
        if not isinstance(p, dict):
            continue
        pname = to_text(p.get("name"))
        if not pname:
            continue
        for key in ("player_id", "online_id"):
            pid = to_text(p.get(key))
            if pid:
                player_id_to_name[pid.lower()] = pname

    car_to_player: dict[str, str] = {}
    goal_events: list[dict[str, Any]] = []
    highlight_events: list[dict[str, Any]] = []
    props = raw.get("properties")
    if isinstance(props, dict):
        goals = props.get("Goals")
        highlights = props.get("HighLights")
        if isinstance(goals, list) and isinstance(highlights, list):
            car_by_frame: dict[int, str] = {}
            for hi in highlights:
                if not isinstance(hi, dict):
                    continue
                frame = to_int(hi.get("frame"))
                car_name = _canonical_car_actor_name(hi.get("CarName"))
                if frame >= 0 and car_name:
                    car_by_frame[frame] = car_name
            for goal in goals:
                if not isinstance(goal, dict):
                    continue
                frame = to_int(goal.get("frame"))
                player_name = _sanitize_player_name(goal.get("PlayerName"))
                car_name = car_by_frame.get(frame, "")
                if frame >= 0:
                    goal_events.append(
                        {
                            "frame": frame,
                            "player_name": player_name,
                            "car_name": car_name,
                        }
                    )
                if car_name and player_name:
                    car_to_player[car_name] = player_name
        if isinstance(highlights, list):
            goal_by_frame: dict[int, dict[str, Any]] = {}
            for goal in goal_events:
                frame = to_int(goal.get("frame"))
                if frame >= 0:
                    goal_by_frame[frame] = goal
            for hi in highlights:
                if not isinstance(hi, dict):
                    continue
                frame = to_int(hi.get("frame"))
                if frame < 0:
                    continue
                car_name = _canonical_car_actor_name(hi.get("CarName"))
                ball_name = str(hi.get("BallName", "")).strip()
                goal_actor = str(hi.get("GoalActorName", "")).strip()
                goal_meta = goal_by_frame.get(frame)
                if goal_meta:
                    event_type = "goal"
                    player_name = _sanitize_player_name(goal_meta.get("player_name"))
                elif goal_actor and goal_actor.lower() != "none":
                    event_type = "goal"
                    player_name = ""
                elif ball_name and ball_name.lower() != "none":
                    event_type = "save_or_shot"
                    player_name = car_to_player.get(car_name, "")
                else:
                    event_type = "highlight"
                    player_name = ""
                highlight_events.append(
                    {
                        "frame": frame,
                        "event_type": event_type,
                        "player_name": player_name,
                        "car_name": car_name,
                        "ball_name": ball_name,
                        "goal_actor_name": goal_actor,
                    }
                )
            highlight_events.sort(key=lambda x: to_int(x.get("frame")))

    def register_point(aid: int, loc: Any, frame_idx: int) -> None:
        if not isinstance(loc, dict):
            return
        try:
            x = float(loc.get("x"))
            y = float(loc.get("y"))
        except (TypeError, ValueError):
            return
        if not math.isfinite(x) or not math.isfinite(y):
            return
        if abs(x) > FIELD_X_MAX * 1.35 or abs(y) > FIELD_Y_MAX * 1.35:
            return
        actor_points.setdefault(aid, []).append((frame_idx, x, y))

    def _cleanup_actor(aid: int) -> None:
        actor_name.pop(aid, None)
        actor_points.pop(aid, None)
        pri_actor_name.pop(aid, None)
        car_actor_to_pri_actor.pop(aid, None)
        for suffix, mapped in list(pri_actor_by_suffix.items()):
            if mapped == aid:
                pri_actor_by_suffix.pop(suffix, None)
        for car_actor, pri_actor in list(car_actor_to_pri_actor.items()):
            if car_actor == aid or pri_actor == aid:
                car_actor_to_pri_actor.pop(car_actor, None)

    def resolve_player_from_pri(pri_actor_id: int) -> str:
        if pri_actor_id <= 0:
            return ""
        direct = _sanitize_player_name(pri_actor_name.get(pri_actor_id))
        if direct:
            return direct
        pri_obj_name = actor_name.get(pri_actor_id, "")
        suffix = _pri_actor_suffix(pri_obj_name)
        if suffix:
            mapped_pri_actor = pri_actor_by_suffix.get(suffix)
            if mapped_pri_actor is not None and mapped_pri_actor != pri_actor_id:
                return _sanitize_player_name(pri_actor_name.get(mapped_pri_actor))
        return ""

    def resolve_player_from_car(car_actor_id: int) -> str:
        if car_actor_id <= 0:
            return ""
        pri_actor_id = car_actor_to_pri_actor.get(car_actor_id)
        if pri_actor_id is None:
            car_obj_name = actor_name.get(car_actor_id, "")
            suffix = _car_actor_suffix(car_obj_name)
            if suffix:
                pri_actor_id = pri_actor_by_suffix.get(suffix)
                if pri_actor_id is not None:
                    car_actor_to_pri_actor[car_actor_id] = pri_actor_id
        if pri_actor_id is None:
            return ""
        return resolve_player_from_pri(pri_actor_id)

    for frame_idx, frame in enumerate(frames):
        if not isinstance(frame, dict):
            continue

        for deleted in frame.get("deleted_actors") or []:
            deleted_id = to_int(deleted.get("actor_id")) if isinstance(deleted, dict) else to_int(deleted)
            if deleted_id > 0:
                _cleanup_actor(deleted_id)
        for item in frame.get("new_actors") or []:
            if not isinstance(item, dict):
                continue
            aid = to_int(item.get("actor_id"))
            if aid <= 0:
                continue
            # Actor IDs can be reused mid-replay; clear stale links/points first.
            _cleanup_actor(aid)
            name_id = to_int(item.get("name_id"))
            if 0 <= name_id < len(names):
                nm = str(names[name_id] or "")
                if nm:
                    actor_name[aid] = nm
                    if _is_pri_actor_name(nm):
                        suffix = _pri_actor_suffix(nm)
                        if suffix:
                            pri_actor_by_suffix[suffix] = aid
            loc = ((item.get("initial_trajectory") or {}).get("location"))
            register_point(aid, loc, frame_idx)

        for item in frame.get("updated_actors") or []:
            if not isinstance(item, dict):
                continue
            aid = to_int(item.get("actor_id"))
            attr = item.get("attribute")
            if not isinstance(attr, dict):
                continue

            src_name = actor_name.get(aid, "")
            if _is_pri_actor_name(src_name):
                pname = _sanitize_player_name(attr.get("String"))
                if not pname:
                    pname = _sanitize_player_name(_name_from_unique_id(attr.get("UniqueId"), player_id_to_name))
                if pname:
                    pri_actor_name[aid] = pname
                active = attr.get("ActiveActor")
                if isinstance(active, dict):
                    car_actor = to_int(active.get("actor"))
                    if car_actor > 0:
                        car_name = actor_name.get(car_actor, "")
                        if _is_car_actor_name(car_name):
                            car_actor_to_pri_actor[car_actor] = aid
            if _is_car_actor_name(src_name):
                active = attr.get("ActiveActor")
                if isinstance(active, dict):
                    target_actor = to_int(active.get("actor"))
                    if target_actor > 0:
                        target_name = actor_name.get(target_actor, "")
                        if _is_pri_actor_name(target_name):
                            car_actor_to_pri_actor[aid] = target_actor
                if aid not in car_actor_to_pri_actor:
                    suffix = _car_actor_suffix(src_name)
                    if suffix:
                        pri_actor_id = pri_actor_by_suffix.get(suffix)
                        if pri_actor_id is not None:
                            car_actor_to_pri_actor[aid] = pri_actor_id

            rigid = attr.get("RigidBody")
            if not isinstance(rigid, dict):
                continue
            register_point(aid, rigid.get("location"), frame_idx)

    car_actor_points: dict[int, list[tuple[int, float, float]]] = {}
    moving_actor_points: dict[int, list[tuple[int, float, float]]] = {}
    for aid, pts in actor_points.items():
        if len(pts) < 8:
            continue
        dist = 0.0
        _, px, py = pts[0]
        for _, x, y in pts[1:]:
            dist += abs(x - px) + abs(y - py)
            px, py = x, y
        if dist < 1500:
            continue
        moving_actor_points[aid] = pts
        name = actor_name.get(aid, "")
        if _is_car_actor_name(name):
            car_actor_points[aid] = pts
    if not car_actor_points:
        car_actor_points = moving_actor_points

    ranked = sorted(
        car_actor_points.items(),
        key=lambda kv: len(kv[1]),
        reverse=True,
    )[: max(1, max_actor_count)]

    def decimate(points: list[tuple[int, float, float]], limit: int) -> list[dict[str, float]]:
        if len(points) <= limit:
            return [{"frame": float(frame_idx), "x": x, "y": y} for frame_idx, x, y in points]
        step = max(1, len(points) // limit)
        slim = points[::step][:limit]
        return [{"frame": float(frame_idx), "x": x, "y": y} for frame_idx, x, y in slim]

    trajectories_all = []
    all_points_all: list[tuple[float, float]] = []
    player_set: set[str] = set()
    pri_name_by_suffix: dict[str, str] = {}
    for pri_actor_id, pri_obj_name in actor_name.items():
        if not _is_pri_actor_name(pri_obj_name):
            continue
        suffix = _pri_actor_suffix(pri_obj_name)
        if not suffix:
            continue
        pname = _sanitize_player_name(pri_actor_name.get(pri_actor_id))
        if pname:
            pri_name_by_suffix[suffix] = pname

    for aid, pts in ranked:
        raw_car_name = actor_name.get(aid, f"Car_{aid}")
        car_name = _canonical_car_actor_name(raw_car_name, actor_id=aid) if _is_car_actor_name(raw_car_name) else f"Actor_{aid}"
        player_name = _sanitize_player_name(car_to_player.get(car_name) or car_to_player.get(raw_car_name, ""))
        if not player_name:
            player_name = resolve_player_from_car(aid)
        if not player_name:
            suffix = _car_actor_suffix(raw_car_name) or _car_actor_suffix(car_name)
            if suffix:
                player_name = _sanitize_player_name(pri_name_by_suffix.get(suffix, ""))
        if player_name:
            player_set.add(player_name)
        all_points_all.extend([(x, y) for _, x, y in pts])
        trajectories_all.append(
            {
                "actor_id": aid,
                "actor_name": car_name,
                "player_name": player_name,
                "points": decimate(pts, max_points_per_actor),
            }
        )

    player_filter_applied = False
    filter_message = ""
    if selected_player_norm:
        trajectories = [
            t for t in trajectories_all if str(t.get("player_name", "")).lower().find(selected_player_norm) >= 0
        ]
        if trajectories:
            player_filter_applied = True
            all_points = []
            for t in trajectories:
                all_points.extend([(p["x"], p["y"]) for p in t.get("points", []) if isinstance(p, dict)])
        else:
            trajectories = trajectories_all
            all_points = all_points_all
            filter_message = "Selected player could not be mapped to trajectories in this replay; showing all players."
    else:
        trajectories = trajectories_all
        all_points = all_points_all

    if not all_points:
        return {
            "heatmap": [],
            "trajectories": trajectories,
            "actors": len(trajectories),
            "players": known_players,
            "mapped_players": sorted(player_set),
            "goal_events": goal_events,
            "events": highlight_events,
            "frame_count": len(frames),
            "player_filter_applied": player_filter_applied,
            "message": filter_message,
        }

    bins: dict[tuple[int, int], int] = {}
    for x, y in all_points:
        gx = int((x + FIELD_X_MAX) / (2 * FIELD_X_MAX) * heat_grid)
        gy = int((y + FIELD_Y_MAX) / (2 * FIELD_Y_MAX) * heat_grid)
        gx = max(0, min(heat_grid - 1, gx))
        gy = max(0, min(heat_grid - 1, gy))
        key = (gx, gy)
        bins[key] = bins.get(key, 0) + 1

    heatmap = [
        {
            "x": ((gx + 0.5) / heat_grid) * (2 * FIELD_X_MAX) - FIELD_X_MAX,
            "y": ((gy + 0.5) / heat_grid) * (2 * FIELD_Y_MAX) - FIELD_Y_MAX,
            "count": count,
        }
        for (gx, gy), count in bins.items()
    ]
    heatmap.sort(key=lambda item: item["count"], reverse=True)
    return {
        "heatmap": heatmap[: 420],
        "trajectories": trajectories,
        "actors": len(trajectories),
        "players": known_players,
        "mapped_players": sorted(player_set),
        "goal_events": goal_events,
        "events": highlight_events,
        "frame_count": len(frames),
        "player_filter_applied": player_filter_applied,
        "message": filter_message,
    }
