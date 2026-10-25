"""Explicit replay codecs and lightweight temporal adapters for both formats."""
from bisect import bisect_right
from hashlib import sha256
import json
from .models import MatchRecord, RenderFrame, Point, Score
from .replay_models import MatchRecordV2, ResolvedEvent, EventView

ReplayRecord = MatchRecord | MatchRecordV2
MAX_REPLAY_BYTES = 16 * 1024 * 1024


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def parse_replay(payload: bytes | dict) -> ReplayRecord:
    if isinstance(payload, bytes):
        if len(payload) > MAX_REPLAY_BYTES: raise ValueError('Replay exceeds size budget')
        payload = json.loads(payload, object_pairs_hook=_unique_object)
    if not isinstance(payload, dict): raise ValueError('Expected replay object')
    version = payload.get('format_version', 1)
    if type(version) is not int: raise ValueError('Invalid replay version')
    if version == 2: return MatchRecordV2.model_validate(payload)
    if version != 1: raise ValueError('Unknown replay version')
    data = {k: v for k, v in payload.items() if k != 'format_version'}
    if set(data) - MatchRecord.model_fields.keys(): raise ValueError('Unknown legacy fields')
    return MatchRecord.model_validate(data)


def _payload(record, exclude_hash=False):
    return record.model_dump(mode='json', exclude={'trace_hash'} if exclude_hash else set(),
                             exclude_none=isinstance(record, MatchRecordV2))


def encode_replay(record: ReplayRecord) -> bytes:
    raw = json.dumps(_payload(record), sort_keys=True, ensure_ascii=False,
                     separators=(',', ':'), allow_nan=False).encode()
    if len(raw) > MAX_REPLAY_BYTES: raise ValueError('Replay exceeds size budget')
    return raw


def trace_hash(record: ReplayRecord) -> str:
    return sha256(json.dumps(_payload(record, True), sort_keys=True, ensure_ascii=False,
                            separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def sample_frame(record: MatchRecordV2, index: int) -> RenderFrame:
    sample = record.motion[index]
    players = [p.model_copy(update={'x': sample.player_xy_mm[2*i]/1000,
                                   'y': sample.player_xy_mm[2*i+1]/1000})
               for i, p in enumerate(record.initial_frame.players)]
    return RenderFrame(players=players, ball=Point(x=sample.ball_x_mm/1000, y=sample.ball_y_mm/1000),
        carrier=players[sample.carrier_index].key if sample.carrier_index >= 0 else None,
        possession=('home', 'away')[sample.possession_index], clock_ms=sample.clock_ms, period=sample.period,
        score=Score(home=sample.home_goals, away=sample.away_goals))


def frame_at(record: ReplayRecord, time_ms: int) -> RenderFrame:
    if isinstance(record, MatchRecord):
        index = bisect_right([e.t1_ms for e in record.events], time_ms) - 1
        return record.events[index].frame_after if index >= 0 else record.initial_frame
    index = max(0, bisect_right([s.clock_ms for s in record.motion], time_ms) - 1)
    return sample_frame(record, index)


def event_view(event: ResolvedEvent) -> EventView:
    return EventView(**event.model_dump(), context_available=True)


def events_until(record: ReplayRecord, end_ms: int) -> list[EventView]:
    if isinstance(record, MatchRecordV2):
        return [event_view(e) for e in record.events if e.t1_ms <= end_ms]
    return [EventView(**e.model_dump(exclude={'frame_after'}), period=e.frame_after.period)
            for e in record.events if e.t1_ms <= end_ms]
