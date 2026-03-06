# Parsed Fields And KPI Inputs

This file documents:

- which replay fields the backend parses
- where they come from in the raw Boxcars JSON
- which fields are emitted in the dashboard row JSON
- which fields are currently used by the KPI section

All paths below are JSON paths.

## Example Files

- Parsed cache file:
  - `tools/parsed_replays/3AEB6E0C4EECC2F363D634B44E84E52A.json`
- Raw Boxcars file:
  - `tools/raw_replays/3AEB6E0C4EECC2F363D634B44E84E52A.raw.json.gz`

## Data Flow

1. Raw Boxcars JSON is parsed in [replay.py](../backend/replay.py).
2. `canonicalize_replay(...)` emits the canonical replay object.
3. `build_row(...)` emits one dashboard row for the selected player perspective.
4. The frontend consumes `dashboard.recent[]`.
5. KPI cards are built from [kpis.js](../frontend/src/features/dashboard/kpis.js) and rendered in [App.jsx](../frontend/src/App.jsx).

## Raw Boxcars Fields Parsed

### Replay Metadata

| Canonical field | Raw JSON path | Notes |
| --- | --- | --- |
| `replay_id` | top-level replay id passed from filename/cache | Not taken from raw body directly. |
| `date` | `raw.properties.Date` | Preferred source. Example: `2026-03-05 19-00-12`. |
| `date_source` | derived | `properties.Date`, `epoch`, `file_mtime_ns`, or `fallback_now`. |
| `match_type` | derived from playlist / replay flags | Emits `Ranked`, `Casual`, or `Tournament`. |
| `game_mode` | derived from playlist hint, then team size fallback | Emits `1v1`, `2v2`, `3v3`, `4v4`, or `Unknown`. |
| `mode_source` | derived | Usually `playlist_hint`. |
| `ranked` | derived | Boolean. |
| `tournament` | derived | Boolean. |
| `map_name` | `raw.properties.MapName` | Example: `UtopiaStadium_Dusk_P`. |
| `replay_name` | `raw.properties.ReplayName` | Human-readable replay title. |
| `match_guid` | `raw.properties.MatchGUID` | Match GUID. |
| `game_version` | `raw.properties.GameVersion` | Game version string. |
| `build_version` | `raw.properties.BuildVersion` | Build version string. |
| `build_id` | `raw.properties.BuildID` | Build id. |
| `team_size` | `raw.properties.TeamSize` | Used for mode fallback. |
| `total_seconds_played` | `raw.properties.TotalSecondsPlayed` | Replay duration in seconds. |
| `winning_team` | `raw.properties.WinningTeam` | Team index from raw replay. |
| `primary_player_team` | `raw.properties.PrimaryPlayerTeam` | Used as fallback team orientation. |
| `unfair_team_size` | `raw.properties.UnfairTeamSize` | Boolean-like flag. |
| `raw_game_type` | `raw.game_type` | Example: `TAGame.Replay_Soccar_TA`. |
| `raw_date_text` | `raw.properties.Date` | Stored for audit/debug. |

### Players

Each canonical player comes from one item in:

- `raw.properties.PlayerStats[]`

Parsed player fields:

| Canonical player field | Raw JSON path |
| --- | --- |
| `name` | `raw.properties.PlayerStats[].Name` |
| `player_id` | `raw.properties.PlayerStats[].OnlineID`, `player_id`, `unique_id`, `remote_id`, `id`, then `raw.properties.PlayerStats[].PlayerID.fields.Uid` / `EpicAccountId` fallback |
| `online_id` | `raw.properties.PlayerStats[].OnlineID` |
| `team` | `raw.properties.PlayerStats[].Team` |
| `score` | `raw.properties.PlayerStats[].Score` |
| `goals` | `raw.properties.PlayerStats[].Goals` |
| `assists` | `raw.properties.PlayerStats[].Assists` |
| `saves` | `raw.properties.PlayerStats[].Saves` |
| `shots` | `raw.properties.PlayerStats[].Shots` |
| `demos` | derived / optional if available in extracted player model |
| `big_boosts` | raw player stat if present, otherwise estimated from `raw.network_frames.frames[].updated_actors[]` |
| `small_boosts` | raw player stat if present, otherwise estimated from `raw.network_frames.frames[].updated_actors[]` |
| `touches` | optional, only if parser extraction found it |
| `clears` | optional, only if parser extraction found it |
| `centers` | optional, only if parser extraction found it |
| `platform` | `raw.properties.PlayerStats[].Platform.value` |
| `platform_kind` | `raw.properties.PlayerStats[].Platform.kind` |
| `is_bot` | `raw.properties.PlayerStats[].bBot` |

### Teams

Canonical `teams[]` is extracted from replay team score data:

| Canonical field | Raw JSON path |
| --- | --- |
| `teams[].index` | replay team index, or synthetic `0`/`1` when using `Team0Score`/`Team1Score` |
| `teams[].score` | `raw.properties.Team0Score`, `raw.properties.Team1Score` or team array score field |

## Canonical Replay Object

Current canonical replay shape:

```json
{
  "replay_id": "3AEB6E0C4EECC2F363D634B44E84E52A",
  "date": "2026-03-05T19:00:12+00:00",
  "date_source": "properties.Date",
  "match_type": "Ranked",
  "game_mode": "2v2",
  "mode_source": "playlist_hint",
  "ranked": true,
  "tournament": false,
  "map_name": "UtopiaStadium_Dusk_P",
  "replay_name": "2026-03-05.19.00 tracked_player Ranked Doubles Loss",
  "match_guid": "51EEC32011F118BCF2499BA0A76F5C8B",
  "game_version": "30",
  "build_version": "260114.55864.507183",
  "build_id": "1320316429",
  "team_size": 2,
  "total_seconds_played": 300,
  "winning_team": 1,
  "primary_player_team": 0,
  "unfair_team_size": true,
  "raw_game_type": "TAGame.Replay_Soccar_TA",
  "raw_date_text": "2026-03-05 19-00-12",
  "players": [],
  "teams": []
}
```

## Dashboard Row Fields

`build_row(...)` emits one row into `dashboard.recent[]`.

### Identity And Replay Context

| Row field | Meaning |
| --- | --- |
| `id` | Replay id. |
| `date` | ISO replay date used by the frontend. |
| `player_name` | Selected player for that row. |
| `player_id` | Selected player id. |
| `online_id` | Selected player online id. |
| `match_type` | Ranked / Casual / Tournament. |
| `game_mode` | 1v1 / 2v2 / 3v3 / 4v4 / Unknown. |
| `ranked` | Ranked boolean. |
| `tournament` | Tournament boolean. |
| `highlighted` | Whether the row matches the tracked player id or highlight name. |
| `map_name` | Replay map. |
| `replay_name` | Replay title. |
| `raw_game_type` | Raw Soccar class string. |
| `team_size` | Team size. |
| `duration_seconds` | Match duration in seconds. |

### Team Orientation

| Row field | Meaning |
| --- | --- |
| `team` | Selected player's team index. |
| `team_color` | `blue` if team index `0`, `orange` if team index `1`. |
| `team_score` | Selected side score. |
| `opponent_score` | Opposing side score. |
| `team_goal_diff` | `team_score - opponent_score`. |
| `won` | Selected side result, not fixed Blue/Orange result. |

### Player Rosters

| Row field | Meaning |
| --- | --- |
| `team_player_names` | Selected side player names. |
| `opponent_player_names` | Opposing side player names. |
| `teammate_names` | Selected side excluding the selected player. |
| `team_players[]` | Serialized selected side roster. |
| `opponent_players[]` | Serialized opposing side roster. |
| `blue_player_names` | Fixed blue-side player names, independent of selected player perspective. |
| `orange_player_names` | Fixed orange-side player names, independent of selected player perspective. |
| `blue_players[]` | Fixed blue-side serialized roster. |
| `orange_players[]` | Fixed orange-side serialized roster. |
| `blue_score` | Fixed blue-side score. |
| `orange_score` | Fixed orange-side score. |

`team_players[]` and `opponent_players[]` include:

```json
{
  "name": "tracked_player",
  "player_id": "76561190000000001",
  "online_id": "76561190000000001",
  "score": 352,
  "goals": 0,
  "assists": 1,
  "saves": 1,
  "shots": 5,
  "touches": 0,
  "clears": 0,
  "centers": 0,
  "demos": 0,
  "big_boosts": 19,
  "small_boosts": 68,
  "platform": "OnlinePlatform_Steam",
  "platform_kind": "OnlinePlatform",
  "platform_label": "Steam",
  "platform_code": "S",
  "is_bot": false
}
```

### Selected Player Raw Stats

These fields come from the selected player only:

| Row field |
| --- |
| `player_score` |
| `player_goals` |
| `player_assists` |
| `player_saves` |
| `player_shots` |
| `player_touches` |
| `player_clears` |
| `player_centers` |
| `player_demos` |
| `player_big_boosts` |
| `player_small_boosts` |
| `mmr` |
| `platform` |
| `platform_kind` |
| `is_bot` |

### Team Totals

These fields are totals for the selected side:

| Row field |
| --- |
| `score` |
| `goals` |
| `assists` |
| `saves` |
| `shots` |
| `touches` |
| `clears` |
| `centers` |
| `demos` |
| `big_boosts` |
| `small_boosts` |
| `team_big_boosts` |
| `team_small_boosts` |
| `team_boost_total` |

### Opponent Totals

| Row field |
| --- |
| `opponent_big_boosts` |
| `opponent_small_boosts` |
| `opponent_boost_total` |

### Derived Metrics Emitted By Backend

| Row field | Formula |
| --- | --- |
| `boost_total` | `team_big_boosts + team_small_boosts` |
| `big_boost_share` | `team_big_boosts / boost_total` |
| `small_boost_share` | `team_small_boosts / boost_total` |
| `shot_accuracy` | `goals / shots` |
| `score_per_shot` | `score / shots` |
| `score_per_goal` | `score / goals` |
| `save_to_shot_ratio` | `saves / shots` |
| `non_shot_impact` | `assists + saves + demos` |
| `pressure_index` | `score*0.01 + goals*2.0 + assists*1.5 + saves*1.4 + shots*0.7 + demos*0.8` |
| `score_share_team` | `score / (score + opp_score_total)` |
| `goals_share_team` | `goals / (goals + opp_goals_total)` |
| `assists_share_team` | `assists / (assists + opp_assists_total)` |
| `saves_share_team` | `saves / (saves + opp_saves_total)` |
| `shots_share_team` | `shots / (shots + opp_shots_total)` |
| `touches_share_team` | `touches / (touches + opp_touches_total)` |
| `clears_share_team` | `clears / (clears + opp_clears_total)` |
| `centers_share_team` | `centers / (centers + opp_centers_total)` |
| `demos_share_team` | `demos / (demos + opp_demos_total)` |
| `score_diff_vs_others` | `score - opp_score_total` |
| `score_diff_vs_mate` | `score - teammate_avg_score` |
| `score_diff_vs_opponents` | `score - opp_score_total` |
| `goals_diff_vs_opponents` | `goals - opp_goals_total` |
| `assists_diff_vs_opponents` | `assists - opp_assists_total` |
| `saves_diff_vs_opponents` | `saves - opp_saves_total` |
| `shots_diff_vs_opponents` | `shots - opp_shots_total` |
| `touches_diff_vs_opponents` | `touches - opp_touches_total` |
| `clears_diff_vs_opponents` | `clears - opp_clears_total` |
| `centers_diff_vs_opponents` | `centers - opp_centers_total` |
| `demos_diff_vs_opponents` | `demos - opp_demos_total` |
| `big_boosts_diff_vs_others` | `team_big_boosts - opp_big_boosts` |
| `small_boosts_diff_vs_others` | `team_small_boosts - opp_small_boosts` |

## KPI Section

Current top KPI cards in the left panel are:

- `Replays`
- `Win Rate`

The broader analytics panels are gated behind a valid tracked `Player ID`. The replay table still loads without one.

Source code:

- [kpis.js](../frontend/src/features/dashboard/kpis.js)
- [App.jsx](../frontend/src/App.jsx)

### Team KPI Inputs

| KPI | Frontend source | Meaning |
| --- | --- | --- |
| `Replays` | `derived.matches` | Count of currently scoped replay rows. |

`derived` comes from:

- `computeDerived(activeRecent, trackedPlayerId)`

### Player KPI Inputs

| KPI | Frontend source | Meaning |
| --- | --- | --- |
| `Replays` | `trackedPlayerOverview.matches` | Number of scoped rows where the tracked player is matched. |
| `Win Rate` | `trackedPlayerOverview.winRate` | `tracked wins / tracked matches`. |

`trackedPlayerOverview` is currently computed as:

```js
const trackedRows = rows.filter((row) => isTrackedRow(row, trackedPlayerId));
const wins = trackedRows.filter((row) => didPlayerWin(row, trackedPlayerId)).length;
```

### Important KPI Notes

The top cards only split into `Team / Player` when the values differ.

Exception:

- `Win Rate` is player-only now
- there is no team-side KPI win-rate card anymore

If both values are identical:

- only one value is shown

Selection behavior:

- `0` selected rows: aggregate view over the current filtered dataset
- `1` selected row: single-match analysis
- `2+` selected rows: aggregate view scoped to the selected rows

### Website KPI Copy

- `Replays`: How many replay rows are currently visible after your active filters. If a valid `Player ID` is set and that player is matched in fewer rows than the current scope, the card can also show the tracked-player replay count for comparison.
- `Win Rate`: Your tracked player's win rate in the current scope. Computed as tracked-player wins divided by tracked-player matched rows. Requires a valid `Player ID`.
- `Display rule`: A KPI shows both `Team` and `Player` only when those two values are different. Otherwise it stays as a single value to avoid duplication.

## Full JSON Paths Used By KPI Section

### Team KPI Paths

- `dashboard.recent[].id`

Through aggregation helpers:

- `derived.matches`

### Player KPI Paths

- `dashboard.recent[].player_id`
- `dashboard.recent[].online_id`
- `dashboard.recent[].team_players[]`
- `dashboard.recent[].opponent_players[]`
- `dashboard.recent[].team_color`
- `dashboard.recent[].team_score`
- `dashboard.recent[].opponent_score`

These are used indirectly by:

- `isTrackedRow(row, trackedPlayerId)`
- `didPlayerWin(row, trackedPlayerId)`

## Known Limitations

- `touches`, `clears`, and `centers` are only meaningful if the parser extracted them. They are not guaranteed in all raw Boxcars payloads.
- `won` in a row is selected-side oriented, not fixed Blue/Orange oriented.
- The recent table renders Blue/Orange result separately from player-perspective KPIs.
- Fields named `*_share_team` in the backend row are legacy names. Their current formula is share of the full lobby total (`selected side + opponents`), not share of the selected side alone.

