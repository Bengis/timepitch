"""Export the match events each engine actually recorded, as `recorded-events-1` sidecars (TP202).

No engine is run. For every recording of the tracked index it reads the served `.json.gz` (verified against the
index SHA-256) plus, where the export does not carry them, the engine's own native outputs, bound to the recording
by hash (GRF: manifest `trace_hash`; open-football: SHA-256 of every native chunk listed in the recording). Only
what the engine recorded is mapped; anything else is counted in `not_exported` and left out. Nothing is inferred
(no saves from catches, no cards from fouls, no outcomes for shots the engine did not resolve).

    python scripts/export_recorded_events.py --dist .local/replays-dist \
        --grf-raw .local/demo/grf-arsenal2003-mancity2024-43-raw --grf-raw .local/freeplay/grf/grf-chelsea-swansea-42-cal1-raw \
        --of-chunks .local/demo/of-run-arsenal2003-mancity2024-43/match_results/dev ... [--write]

Writes `<recording>.events.json.gz` next to each recording (gzip level 9, mtime 0: CPython >= 3.11 for stable bytes),
adds `events` {file, encoding, bytes, sha256, schema} to the index entry and refreshes `SHA256SUMS`.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
import zlib
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend/src'))
from timepitch.touchlines.events import KINDS, SIDES, Builder, touchlines  # noqa: E402  (TP243: compartido con el servicio en vivo)
INDEX = ROOT / 'web/src/match-centre/adapters/recorded-replays.index.json'
SCHEMA = 'recorded-events-1'



def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── open-football: native match_results chunks (events with Rust Debug descriptions), bound by chunk SHA-256 ──
OF_ID = re.compile(r'^(\w+)\((\d+)')


def of_chunks(rec: dict, dirs: list[Path]) -> tuple[list[dict], list[dict]]:
    listed = rec['open_football']['chunks']
    for d in dirs:
        files = [d / c['file'] for c in listed]
        if all(f.exists() and f.stat().st_size == c['bytes'] and sha256(f.read_bytes()) == c['sha256'] for f, c in zip(files, listed)):
            events = [e for f in files for e in json.loads(gzip.decompress(f.read_bytes()))['events']]
            return events, [{'path': str(f.relative_to(ROOT)).replace('\\', '/'), 'sha256': c['sha256']} for f, c in zip(files, listed)]
    raise SystemExit(f"open-football chunks for {rec['trace_hash'][:8]} not found (bound by SHA-256)")


def open_football(rec: dict, dirs: list[Path]) -> tuple[Builder, list[dict]]:
    b = Builder(rec, lambda s: s['period'])
    slot = {int(n): (p['side'], p['slot']) for p in rec['input']['players'] for n in p['native_ids']}
    raw, sources = of_chunks(rec, dirs)
    for e in sorted(raw, key=lambda e: e['timestamp']):
        d, t = e['description'], e['timestamp']
        i = b.index_at(t)
        m = OF_ID.match(d)
        head = (m.group(1) if m else d.split('(')[0].split(' ')[0])
        key = f"{e['category']}:{head}"
        if key == 'player:PassTo':
            ctx = dict(re.findall(r'(\w+): ([^,}]+)', d))
            frm, to = int(ctx['from_player_id']), int(ctx['to_player_id'])
            reason = ctx['reason'].strip().strip('"')
            if reason == 'KICK_OFF':
                b.add('kickoff', t, i, key, *slot[frm])
            b.add('pass', t, i, key, *slot[frm], extra={'to_slot': slot[to][1] if to in slot else None, 'reason': reason})
        elif key == 'player:Shoot':
            ctx = dict(re.findall(r'(\w+): ([^,}]+)', d))
            b.add('shot', t, i, key, *slot[int(ctx['from_player_id'])],
                  extra={'shot_type': ctx['shot_type'].strip(), 'reason': ctx['reason'].strip().strip('"'), 'outcome': None})
        elif key == 'player:CommitFoul':
            fid, severity, source = re.match(r'CommitFoul\((\d+), (\w+), (\w+)\)', d).groups()
            b.add('foul', t, i, key, *slot[int(fid)], extra={'severity': severity, 'source': source})
        elif key == 'player:Offside':  # also logged as ball:Offside at the same timestamp: one decision
            b.add('offside', t, i, key, *slot[int(m.group(2))])
        elif key == 'ball:Intercepted':
            b.add('possession_change', t, i, key, *slot[int(m.group(2))])
        else:
            b.skipped[key if not d.startswith('REFUSED') else 'player:REFUSED'] += 1
    for g in rec['open_football'].get('goals', []):
        side, s = slot[int(g['scorer_id'])]
        i = b.index_at(g['match_time_ms'])
        b.add('goal', i * 100, i, 'open_football.goals', side, s)
    b.periods()
    return b, sources


# ── GRF: native activity chunks (touch / goal / decision telemetry with referee stages), bound by trace_hash ──
GRF_PASS = {'short_pass', 'high_pass', 'long_pass'}
GRF_DECISION = {'offside': 'offside', 'free_kick': 'free_kick', 'kickoff': 'kickoff', 'throw_in': 'throw_in',
                'corner': 'corner', 'penalty': 'penalty', 'foul': 'foul'}


def grf(rec: dict, dirs: list[Path]) -> tuple[Builder, list[dict]]:
    b = Builder(rec, lambda s: s['period'])
    for d in dirs:
        man = d / 'manifest.json'
        if man.exists() and json.loads(man.read_text(encoding='utf-8'))['trace_hash'] == rec['trace_hash']:
            break
    else:
        raise SystemExit(f"GRF raw output for {rec['trace_hash'][:8]} not found (bound by trace_hash)")
    manifest = json.loads(man.read_text(encoding='utf-8'))
    sources = [{'path': str(man.relative_to(ROOT)).replace('\\', '/'), 'sha256': sha256(man.read_bytes())}]
    incidents: dict[tuple, dict] = {}
    for c in manifest['chunks']:
        data = (d / f"{c['index']}.zlib").read_bytes()
        plain = zlib.decompress(data)
        # The manifest SHA-256 is of the logical (decoded) block; the file is bound by the manifest trace_hash and sizes.
        assert len(data) == c['compressed_bytes'] and len(plain) == c['expanded_bytes'], f'GRF chunk {c["index"]} size'
        for e in json.loads(plain)['events']:
            side, slot = SIDES[e['actor_team']], e['player']
            t, i, xy = e['actual_time_ms'], min(e['sample_index'], len(b.samples) - 1), e['actor_xy']
            native = f"{e['type']}:{e['kind']}" + (f":{e['stage']}" if e['stage'] else '')
            if e['type'] == 'touch' and e['kind'] in GRF_PASS:
                b.add('pass', t, i, native, side, slot, xy, {'subtype': e['kind']})
            elif e['type'] == 'touch' and e['kind'] == 'shot':
                b.add('shot', t, i, native, side, slot, xy, {'outcome': None})
            elif e['type'] == 'goal':
                b.add('own_goal' if e['own_goal'] else 'goal', t, i, native, side, slot, xy,
                      {'credited_side': SIDES[e['team']], 'score': e['score']})
            elif e['type'] == 'decision' and e['kind'] in GRF_DECISION:
                key = (e['kind'], e['incident_id'])
                if key in incidents:  # one incident, several stages (accepted / advantage_played / sanctioned)
                    incidents[key].setdefault('extra', {}).setdefault('stages', []).append(e['stage'])
                    continue
                extra = {'stages': [e['stage']], 'incident_id': e['incident_id'], 'awarded_side': SIDES[e['team']]}
                if e['victim_team'] in (0, 1):
                    extra.update(victim_side=SIDES[e['victim_team']], victim_slot=e['victim_player'])
                b.add(GRF_DECISION[e['kind']], t, i, native, side, slot, xy, extra)
                incidents[key] = b.events[-1]
            else:
                b.skipped[native] += 1
    b.periods()
    return b, sources


XY_BASIS = {
    'grf': 'GRF actor_xy (normalised frame of the recording, checked against samples)',
    'touchlines': "actor's recorded position in samples[sample_index] (ball if no actor)",
    'open-football': "actor's recorded position in samples[sample_index] (ball if no actor)",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dist', type=Path, required=True)
    ap.add_argument("--grf-raw", type=lambda p: Path(p).resolve(), action='append', default=[])
    ap.add_argument("--of-chunks", type=lambda p: Path(p).resolve(), action='append', default=[])
    ap.add_argument('--only', action='append', default=[], help='index ids to export (default: all)')
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    index = json.loads(INDEX.read_text(encoding='utf-8'))
    for entry in index['recordings']:
        if a.only and entry['id'] not in a.only:
            continue
        served = (a.dist / entry['file']).read_bytes()
        if len(served) != entry['bytes'] or sha256(served) != entry['sha256']:
            raise SystemExit(f"{entry['file']}: bytes/SHA-256 differ from the index")
        rec = json.loads(gzip.decompress(served))
        assert rec['trace_hash'] == entry['trace_hash'] and rec['synthetic'] is True
        engine, sources = entry['engine'], [{'path': entry['file'], 'sha256': entry['sha256']}]
        if engine == 'touchlines':
            b = touchlines(rec)
        elif engine == 'open-football':
            b, extra = open_football(rec, a.of_chunks); sources += extra
        else:
            b, extra = grf(rec, a.grf_raw); sources += extra
        events = sorted(b.events, key=lambda e: (e['t_ms'], e['sample_index']))
        counts = Counter(e['kind'] for e in events)
        doc = {
            'schema': SCHEMA, 'engine': engine, 'engine_version': entry['engine_version'],
            'recording': {'id': entry['id'], 'file': entry['file'], 'sha256': entry['sha256'], 'trace_hash': entry['trace_hash'], 'seed': entry['seed']},
            'synthetic': True,
            'notice': 'SIMULATED: events recorded by the engine during this synthetic free-play recording; not a real match, not historical data.',
            'time_basis': 't_ms = elapsed physics ms of the recording (sample i at i*100 ms); match_ms = samples[sample_index].match_time_ms',
            'xy_basis': XY_BASIS[engine], 'sources': sources,
            'counts': dict(sorted(counts.items())), 'not_exported': dict(sorted(b.skipped.items())),
            'events': events,
        }
        body = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        packed = gzip.compress(body, 9, mtime=0)
        assert gzip.decompress(packed) == body
        file = entry['file'].removesuffix('.json.gz') + '.events.json.gz'
        print(json.dumps({'id': entry['id'], 'file': file, 'bytes': len(packed), 'events': len(events), 'counts': doc['counts'],
                          'not_exported': doc['not_exported']}, ensure_ascii=False))
        if a.write:
            (a.dist / file).write_bytes(packed)
            entry['events'] = {'file': file, 'encoding': 'gzip', 'bytes': len(packed), 'sha256': sha256(packed), 'schema': SCHEMA}
    if a.write:
        INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        sums = []
        for e in index['recordings']:
            sums.append(f"{e['sha256']}  {e['file']}")
            if 'events' in e:
                sums.append(f"{e['events']['sha256']}  {e['events']['file']}")
        (a.dist / 'SHA256SUMS').write_text('\n'.join(sums) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    sys.exit(main())
