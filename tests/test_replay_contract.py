import json
import math
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.config import ReplayDigest
from backend.replay import build_row, canonicalize_replay, parse_or_cache_replay


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "replay_contract_fixture.json"


def load_fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def assert_nested_equal(testcase: unittest.TestCase, actual, expected, path="root"):
    if isinstance(expected, dict):
        testcase.assertIsInstance(actual, dict, msg=f"{path} should be dict")
        testcase.assertEqual(set(actual.keys()), set(expected.keys()), msg=f"{path} keys mismatch")
        for key, value in expected.items():
            assert_nested_equal(testcase, actual[key], value, f"{path}.{key}")
        return
    if isinstance(expected, list):
        testcase.assertIsInstance(actual, list, msg=f"{path} should be list")
        testcase.assertEqual(len(actual), len(expected), msg=f"{path} length mismatch")
        for index, (actual_item, expected_item) in enumerate(zip(actual, expected)):
            assert_nested_equal(testcase, actual_item, expected_item, f"{path}[{index}]")
        return
    if isinstance(expected, float):
        testcase.assertTrue(math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9), msg=f"{path} mismatch: {actual} != {expected}")
        return
    testcase.assertEqual(actual, expected, msg=f"{path} mismatch")


class ReplayContractTest(unittest.TestCase):
    def test_canonicalize_replay_matches_fixture_contract(self):
        fixture = load_fixture()
        actual = canonicalize_replay(fixture["raw"], replay_id=fixture["expected_canonical"]["replay_id"])
        assert_nested_equal(self, actual, fixture["expected_canonical"])

    def test_build_row_matches_fixture_contract(self):
        fixture = load_fixture()
        canonical = canonicalize_replay(fixture["raw"], replay_id=fixture["expected_canonical"]["replay_id"])
        actual = build_row(canonical, player_id="tracked-player-000001", highlight_name="")
        assert_nested_equal(self, actual, fixture["expected_row"])

    def test_build_row_returns_none_when_player_id_is_not_found(self):
        fixture = load_fixture()
        canonical = canonicalize_replay(fixture["raw"], replay_id=fixture["expected_canonical"]["replay_id"])
        actual = build_row(canonical, player_id="missing-player-id", highlight_name="")
        self.assertIsNone(actual)

    def test_build_row_returns_none_when_highlight_name_is_not_found(self):
        fixture = load_fixture()
        canonical = canonicalize_replay(fixture["raw"], replay_id=fixture["expected_canonical"]["replay_id"])
        actual = build_row(canonical, player_id="", highlight_name="DefinitelyNotInThisReplay")
        self.assertIsNone(actual)

    def test_timeout_failures_are_not_cached_as_permanent_errors(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
          replay_path = Path(tmp_dir) / "sample.replay"
          replay_path.write_bytes(b"demo")
          digest = ReplayDigest(
              replay_id="sample",
              file_path=replay_path,
              file_size=replay_path.stat().st_size,
              file_mtime_ns=replay_path.stat().st_mtime_ns,
          )
          with patch("backend.replay.run_boxcars_json", side_effect=RuntimeError("boxcars timed out after 45s")):
              replay_data, from_cache, error = parse_or_cache_replay(
                  digest,
                  boxcars_exe=Path("fake-boxcars"),
                  use_cache=True,
                  write_cache=True,
                  cache_dir=tmp_dir,
                  raw_dir=tmp_dir,
              )
          self.assertIsNone(replay_data)
          self.assertFalse(from_cache)
          self.assertIn("timed out", error)

          fixture = load_fixture()
          with patch("backend.replay.run_boxcars_json", return_value=fixture["raw"]):
              replay_data, from_cache, error = parse_or_cache_replay(
                  digest,
                  boxcars_exe=Path("fake-boxcars"),
                  use_cache=True,
                  write_cache=True,
                  cache_dir=tmp_dir,
                  raw_dir=tmp_dir,
              )
          self.assertIsNotNone(replay_data)
          self.assertFalse(from_cache)
          self.assertIsNone(error)

    def test_cancelled_failures_are_not_cached_as_permanent_errors(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            replay_path = Path(tmp_dir) / "sample.replay"
            replay_path.write_bytes(b"demo")
            digest = ReplayDigest(
                replay_id="sample-cancel",
                file_path=replay_path,
                file_size=replay_path.stat().st_size,
                file_mtime_ns=replay_path.stat().st_mtime_ns,
            )
            cancel_event = threading.Event()
            cancel_event.set()

            replay_data, from_cache, error = parse_or_cache_replay(
                digest,
                boxcars_exe=Path("fake-boxcars"),
                cancel_event=cancel_event,
                use_cache=True,
                write_cache=True,
                cache_dir=tmp_dir,
                raw_dir=tmp_dir,
            )
            self.assertIsNone(replay_data)
            self.assertFalse(from_cache)
            self.assertIn("cancelled", error)

            fixture = load_fixture()
            with patch("backend.replay.run_boxcars_json", return_value=fixture["raw"]):
                replay_data, from_cache, error = parse_or_cache_replay(
                    digest,
                    boxcars_exe=Path("fake-boxcars"),
                    cancel_event=threading.Event(),
                    use_cache=True,
                    write_cache=True,
                    cache_dir=tmp_dir,
                    raw_dir=tmp_dir,
                )
            self.assertIsNotNone(replay_data)
            self.assertFalse(from_cache)
            self.assertIsNone(error)


if __name__ == "__main__":
    unittest.main()

