"""One seeded action engine feeds both replay traces and fast distribution checks."""
from collections import Counter
import random

from ..catalog.repository import CatalogRepository
from .models import MatchConfig, MatchRecord, MatchEvent, TraceViolation
from .state import MatchState
from .actions import other, accessible_players, claim_control, begin_pass, begin_shot, resolve_flight
from .spatial import initial_world, arrange_restart, Vec2
from .tactics import targets_for
from .motion import step_world, capture_sample
from .replay_models import MatchRecordV2, ResolvedEvent
from .replay import trace_hash
from .observations import NullObserver, TraceObserver, CompositeObserver
from .metrics import BasicReducer
from .metrics import reduce_metrics
from .ratings import build_team_profile, get_league_baseline

HALF, FULL, MAX_EVENTS = 2700000, 5400000, 4000


def select_lineup(team, formation):
    defenders, midfielders, forwards = map(int, formation.split('-'))
    required = {'GK': 1, 'DEF': defenders, 'MID': midfielders, 'FWD': forwards}
    chosen = []
    for role, count in required.items():
        players = sorted((p for p in team.players if p.role == role),
                         key=lambda p: (-(p.stats['minutes'].value or 0), p.key))
        if len(players) < count:
            raise ValueError('Not enough participants for formation')
        chosen.extend(p.key for p in players[:count])
    return chosen


def make_config(catalog, home_key, away_key, seed=42):
    home, away = catalog.get_team(home_key), catalog.get_team(away_key)
    hf = '4-4-2' if '4-4-2' in home.available_formations else home.available_formations[0]
    af = '4-4-2' if '4-4-2' in away.available_formations else away.available_formations[0]
    return MatchConfig(home_key=home_key, away_key=away_key, seed=seed, home_formation=hf, away_formation=af,
                       home_players=select_lineup(home, hf), away_players=select_lineup(away, af))


def _prepare(config, catalog):
    teams, profiles, people = {}, {}, {}
    for side in ('home', 'away'):
        team = catalog.get_team(getattr(config, side + '_key'))
        selected = getattr(config, side + '_players')
        if len(selected) != 11 or len(set(selected)) != 11:
            raise ValueError('Each eleven must contain eleven unique players')
        members = {p.key: p for p in team.players}
        if not all(key in members for key in selected):
            raise ValueError('Selected player does not belong to this team-season')
        roles = Counter(members[key].role for key in selected)
        d, m, f = map(int, getattr(config, side + '_formation').split('-'))
        if roles != Counter({'GK': 1, 'DEF': d, 'MID': m, 'FWD': f}):
            raise ValueError('Selected roles do not match formation')
        profile = build_team_profile(team, get_league_baseline(catalog, team.season_start))
        by_key = {p.player_key: p for p in profile.players}
        profiles[side] = profile.model_copy(update={'players': [by_key[key] for key in selected]})
        people.update(members)
        teams[side] = team
    state = MatchState(config=config, profiles=profiles, people=people)
    state.carrier = state.key('home', next(p for p in state.lineup('home') if p.role == 'MID'))
    return state, teams


def run_match(config, catalog, observer):
    """Same quantized stream for stored replays, fast metrics and statistics observers."""
    state, teams = _prepare(config, catalog)
    world = initial_world(config, teams, state.profiles)
    rng, basic = random.Random(config.seed), BasicReducer()
    initial = world.snapshot()
    observer.on_start(initial)
    basic.on_start(initial)
    sample_index, event_count, possession_id, sequence_id = 0, 0, 0, 0
    pending, restart = [], None
    hold_index, hold_clock, hold_xy = 0, 0, (52500, 34000)
    next_decision = 3000

    def reserve_id():
        nonlocal event_count
        if event_count >= MAX_EVENTS: raise ValueError('Event limit reached')
        value = f'e{event_count:04}'
        event_count += 1
        return value

    def emit(kind, side, participants, outcome, *, start=None, origin_index=None, origin=None,
             evidence=None, related=None, event_id=None, owner=None):
        point = (round(world.ball.position.x*1000), round(world.ball.position.y*1000))
        event = ResolvedEvent(id=event_id or reserve_id(), type=kind, side=side,
            participants=list(dict.fromkeys(participants)), outcome=outcome,
            t0_ms=world.clock if start is None else start, t1_ms=world.clock,
            evidence={'possession_side': owner or world.possession, **(evidence or {})},
            period=world.period, sample_index=sample_index,
            origin_sample_index=sample_index if origin_index is None else origin_index,
            origin_mm=point if origin is None else origin, end_mm=point,
            possession_id=possession_id, sequence_id=sequence_id,
            related_event_ids=related or [], released_ms=world.clock if start is None else start)
        pending.append(event)
        return event

    def publish(reset_code=0):
        sample = capture_sample(world, reset_code)
        basic.on_sample(sample)
        observer.on_sample(sample)
        for event in pending:
            # All instantaneous resolutions share the tick's final ball state.
            event.end_mm = (sample.ball_x_mm, sample.ball_y_mm)
            if event.origin_sample_index == sample_index:
                event.origin_mm = event.end_mm
            basic.on_event(event)
            observer.on_event(event)
        pending.clear()

    def start_hold():
        nonlocal hold_index, hold_clock, hold_xy
        hold_index, hold_clock = sample_index, world.clock
        hold_xy = (round(world.ball.position.x*1000), round(world.ball.position.y*1000))

    emit('kickoff', 'home', [world.players[world.ball.carrier].key], 'in_play')
    publish(1)
    world.ball.mode = 'controlled'
    while world.clock < FULL:
        if restart is not None:
            side, centered, shot_id = restart
            arrange_restart(world, side, centered)
            sample_index += 1
            possession_id += 1
            sequence_id += 1
            emit('restart', side, [world.players[world.ball.carrier].key], 'in_play',
                 evidence={'shot_id': shot_id}, related=[shot_id])
            publish(3 if centered else 4)
            world.ball.mode = 'controlled'
            restart = None
            start_hold()
            next_decision = world.clock+3000
        step_world(world, targets_for(world))
        sample_index += 1
        boundary = HALF if world.period == 1 else FULL
        flight = world.ball.flight
        if flight and world.clock >= flight.arrival_ms:
            result = resolve_flight(world, rng)
            actor = world.players[result.actor]
            participants = [actor.key]
            if result.receiver is not None: participants.append(world.players[result.receiver].key)
            if result.winner is not None: participants.append(world.players[result.winner].key)
            if result.outcome == 'goal':
                if actor.side == 'home': world.home_goals += 1
                else: world.away_goals += 1
            action = emit(result.kind, actor.side, participants, result.outcome, start=flight.released_ms,
                origin_index=flight.origin_sample_index,
                origin=(round(flight.origin.x*1000), round(flight.origin.y*1000)),
                evidence={**({'simulated_xg': result.simulated_xg} if result.kind == 'shot' else {}),
                          'target_x_mm': round(flight.target.x*1000),
                          'target_y_mm': round(flight.target.y*1000)},
                event_id=flight.action_id, owner=actor.side)
            if result.kind == 'shot':
                sequence_id += 1
                if result.outcome == 'goal':
                    emit('goal', actor.side, [actor.key], 'scored', evidence={'shot_id': action.id}, related=[action.id])
                    restart = (other(actor.side), True, action.id)
                elif result.outcome == 'saved':
                    keeper = world.players[result.winner]
                    possession_id += 1
                    emit('save', keeper.side, [keeper.key], 'saved', evidence={'shot_id': action.id}, related=[action.id])
                else:
                    restart = (other(actor.side), False, action.id)
            elif result.winner is not None and world.players[result.winner].side != actor.side:
                possession_id += 1
                sequence_id += 1
                winner = world.players[result.winner]
                emit('recovery', winner.side, [winner.key], 'won_ball', related=[action.id])
            if result.winner is not None: start_hold()
            next_decision = world.clock+rng.randint(12, 24)*250
        elif world.ball.carrier is None and world.ball.flight is None and restart is None:
            reachable = accessible_players(world)
            if reachable:
                previous = world.possession
                claim_control(world, reachable[0].index)
                if previous != world.possession: possession_id += 1
                sequence_id += 1
                emit('recovery', world.possession, [reachable[0].key], 'won_ball')
                start_hold()
                next_decision = world.clock+3000
        elif world.ball.carrier is not None and world.clock >= next_decision and world.clock < boundary:
            actor = world.players[world.ball.carrier]
            side, rival = actor.side, other(actor.side)
            point = (round(world.ball.position.x*1000), round(world.ball.position.y*1000))
            if world.clock > hold_clock and point != hold_xy:
                emit('carry', side, [actor.key], 'complete', start=hold_clock, origin_index=hold_index,
                     origin=hold_xy, owner=side)
            start_hold()
            defenders = sorted((p for p in world.players if p.side == rival and p.role != 'GK'),
                               key=lambda p: (p.position.distance(world.ball.position), p.index))
            defender = defenders[0]
            distance = defender.position.distance(world.ball.position)
            pressing = getattr(config, rival+'_tactic') == 'press'
            draw = rng.random()
            if distance <= 6 and draw < (.8 if pressing else .3):
                kind = 'tackle' if distance <= 1.8 else 'pressure'
                won = kind == 'tackle' and rng.random() < .22+.35*defender.attributes['defending']
                if won: claim_control(world, defender.index)
                action = emit(kind, rival, [defender.key, actor.key], 'won_ball' if won else 'held', owner=side)
                if won:
                    possession_id += 1
                    sequence_id += 1
                    emit('recovery', rival, [defender.key], 'won_ball', related=[action.id])
                    start_hold()
            else:
                progress = actor.position.x if world.direction(side) == 1 else 105-actor.position.x
                attack = world.profiles[side].attack_rate
                shot_chance = min(.9, (.24 if progress > 73 else .025 if progress > 58 else 0)*attack)
                if progress > 96 or rng.random() < shot_chance:
                    begin_shot(world, rng, f'e{event_count:04}', sample_index, boundary)
                    if world.ball.flight: reserve_id()
                elif (actor.role == 'GK' or rng.random() < (.48 if getattr(config, side+'_tactic') == 'counter' else .68)) and boundary-world.clock > 3000:
                    receivers = [p for p in world.players if p.side == side and p.index != actor.index
                                 and 3 < p.position.distance(actor.position) <= 35]
                    if receivers:
                        weights = [max(.1, 1+(p.position.x-actor.position.x)*world.direction(side)*.065)
                                   *(.2 if p.role == 'GK' else 1.)/max(6., p.position.distance(actor.position)) for p in receivers]
                        receiver = rng.choices(receivers, weights=weights)[0]
                        begin_pass(world, receiver.index, reserve_id(), sample_index)
                else:
                    advance = rng.uniform(3, 10)
                    if getattr(config, side+'_tactic') == 'counter': advance *= 1.2
                    actor.target = Vec2(max(1., min(104., actor.position.x+world.direction(side)*advance)),
                                        max(2., min(66., actor.position.y+rng.uniform(-3, 3))))
                    actor.responsibility = 'carry'
            next_decision = world.clock+rng.randint(12, 24)*250
        if world.clock == FULL:
            emit('fulltime', None, [], 'finished')
        publish()
        if world.clock == HALF and world.period == 1:
            world.period = 2
            arrange_restart(world, 'away', True)
            restart = None
            sample_index += 1
            possession_id += 1
            sequence_id += 1
            emit('halftime', None, [], 'interval')
            emit('kickoff', 'away', [world.players[world.ball.carrier].key], 'in_play')
            publish(2)
            world.ball.mode = 'controlled'
            start_hold()
            next_decision = world.clock+3000
    return basic.metrics


def compute_trace_hash(record): return trace_hash(record)


def simulate_metrics(config, catalog):
    return run_match(config, catalog, NullObserver())


def simulate_match(config: MatchConfig, catalog: CatalogRepository) -> MatchRecordV2:
    from ..statistics.reducer import AdvancedReducer
    trace = TraceObserver()
    advanced = AdvancedReducer()
    metrics = run_match(config, catalog, CompositeObserver(trace,advanced))
    record = MatchRecordV2(format_version=2, config=config, seed=config.seed,
        dataset_version=catalog.dataset_version, home_name=catalog.get_team(config.home_key).name,
        away_name=catalog.get_team(config.away_key).name, initial_frame=trace.initial_frame,
        motion=trace.motion, events=trace.events, metrics=metrics,
        metrics_version='metrics-1',statistics=advanced.result(FULL))
    record.trace_hash = trace_hash(record)
    return record


def simulate_statistics(config,catalog):
    from ..statistics.reducer import AdvancedReducer
    reducer=AdvancedReducer()
    run_match(config,catalog,reducer)
    return reducer.result(FULL)


def validate_trace(record, catalog=None) -> list[TraceViolation]:
    if isinstance(record, MatchRecordV2):
        if catalog is None: return [TraceViolation(event_id='catalog', code='missing_catalog')]
        from .trace_validation import validate_v2
        return validate_v2(record, catalog)
    from .legacy_validation import validate_legacy_record
    return validate_legacy_record(record)
