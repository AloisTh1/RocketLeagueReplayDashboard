import json
import math
import unittest
from pathlib import Path

from backend.replay import build_row, canonicalize_replay


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
        actual = build_row(canonical, player_id="76561190000000001", highlight_name="")
        assert_nested_equal(self, actual, fixture["expected_row"])


if __name__ == "__main__":
    unittest.main()

