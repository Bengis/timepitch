"""Inputs that are not distributed with the public repository.

The historical catalogue, the advanced statistics file, research captures, private
recordings and native engine builds are not part of this repository (see README).
A test that fails only because one of those inputs is absent is reported as skipped
with the reason "private dataset not distributed", instead of as a failure. Any other
failure, including a missing file elsewhere in the checkout, is still a failure.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_PRIVATE_ROOTS = tuple(p.resolve() for p in (
    ROOT / 'research', ROOT / 'data' / 'advanced', ROOT / '.local', ROOT / '.superpowers',
    Path(__file__).resolve().parent / 'fixtures' / 'advanced'))


def _under_private_root(path: Path) -> bool:
    return any(path == root or root in path.parents for root in _PRIVATE_ROOTS)


def private_input(*paths: Path | str) -> Path | None:
    """First missing non-distributed path among `paths`, if any."""
    for raw in paths:
        path = Path(raw)
        path = (ROOT / path if not path.is_absolute() else path).resolve()
        if _under_private_root(path) and not path.exists():
            return path
    return None


def _missing_private_input(exc: BaseException | None) -> Path | None:
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        names = [getattr(exc, 'filename', None), getattr(exc, 'filename2', None)]
        names += [a for a in getattr(exc, 'args', ()) if isinstance(a, (str, Path))]
        for name in names:
            if not name:
                continue
            try:
                found = private_input(name)
            except (OSError, ValueError):
                found = None
            if found:
                return found
        exc = exc.__cause__ or exc.__context__
    return None


def _catalogue_missing() -> bool:
    from timepitch import config
    return not Path(config.DATASET).exists()


# Tests that start the real app (or wait on it) and cannot fail fast without the catalogue:
# they are skipped before running instead of waiting on a server that never starts.
_NEEDS_CATALOGUE = {
    'test_local_restart.py': None,
    'test_local_launcher.py': {'test_launcher_checks_dependencies_without_starting_a_server'},
    'test_chronicle_worker.py': {'test_cancelled_worker_preserves_cancellation_and_first_snapshot_while_draining',
                                 'test_cancellation_during_failed_generation_cleanup_drains_and_carries_first_failure'},
}

# GRF engine-evaluation tests whose fixtures (native patches, campaign files, saved runs)
# live under research/. A failure in these modules counts as a skip only while research/ is absent.
_RESEARCH_MODULES = {
    'test_grf_action_campaign.py', 'test_grf_action_fixture_geometry.py', 'test_grf_action_holdout.py',
    'test_grf_action_observer.py', 'test_grf_action_sealing_edges.py', 'test_grf_candidate_launch.py',
    'test_grf_candidate_process.py', 'test_grf_coordination_policy.py', 'test_grf_coordination_process.py',
    'test_grf_coordination_profile.py', 'test_grf_coordination_shadow.py', 'test_grf_defensive_observer.py',
    'test_grf_defensive_policy.py', 'test_grf_m1_native_worker.py', 'test_grf_marking_continuity.py',
    'test_grf_shot_context_wire.py',
}


def pytest_collection_modifyitems(config, items):
    if not _catalogue_missing():
        return
    marker = pytest.mark.skip(reason='private dataset not distributed: historical catalogue (TIMEPITCH_DATASET)')
    for item in items:
        names = _NEEDS_CATALOGUE.get(item.path.name, ())
        if names is None or item.originalname in names:
            item.add_marker(marker)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if not report.failed or call.excinfo is None:
        return
    missing = _missing_private_input(call.excinfo.value)
    if missing is None and item.path.name in _RESEARCH_MODULES and not (ROOT / 'research').exists():
        missing = ROOT / 'research'
    if missing is not None:
        report.outcome = 'skipped'
        report.longrepr = (str(item.path), item.location[1] or 0,
                           f'Skipped: private dataset not distributed: {missing.relative_to(ROOT).as_posix()}')
