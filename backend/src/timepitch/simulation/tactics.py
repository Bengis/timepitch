"""Estimated tactical parameters, not reconstructed historical club styles."""
from .spatial import Vec2, PlayerTarget

DEFENSIVE_WIDTH = {'balanced': 38., 'press': 36., 'counter': 36.}
ATTACKING_WIDTH = {'balanced': 52., 'press': 50., 'counter': 48.}
HEIGHT = {'balanced': 0., 'press': 5., 'counter': -4.}


def targets_for(world):
    result = {}
    for side in ('home', 'away'):
        players = [p for p in world.players if p.side == side]
        direction = world.direction(side)
        ball = world.ball.position
        bx = ball.x if direction == 1 else 105-ball.x
        tactic = getattr(world.config, side+'_tactic')
        attacking = world.possession == side
        width = ATTACKING_WIDTH[tactic] if attacking else DEFENSIVE_WIDTH[tactic]
        lateral = max(-12., min(12., (ball.y-34)*.42))
        # All lines share a moving anchor. Without possession their span is 28 m.
        anchor = max(19., min(73., bx-12+HEIGHT[tactic]))
        role_x = {'DEF': -14., 'MID': 0., 'FWD': 14.}
        if attacking:
            anchor = max(25., min(72., bx-7+HEIGHT[tactic]))
            role_x = {'DEF': -19., 'MID': -2., 'FWD': 17.}
        for role in ('GK', 'DEF', 'MID', 'FWD'):
            group = [p for p in players if p.role == role]
            # Generic role slots do not make a striker pair into two wingers.
            line_width = width
            if role == 'DEF': line_width *= (.85 if attacking else .95) if len(group) == 4 else (.62 if attacking else .84)
            elif role == 'MID' and len(group) == 3: line_width *= .6 if attacking else .9
            elif role == 'FWD': line_width *= (.42 if attacking else .52) if len(group) == 2 else (1. if attacking else .9)
            for slot, player in enumerate(group):
                if role == 'GK':
                    x = max(3., min(15., bx*.16))
                    y = 34+(ball.y-34)*.18
                    responsibility = 'goal_cover'
                else:
                    x = anchor+role_x[role]
                    offset = 0. if len(group) == 1 else slot/(len(group)-1)-.5
                    y = 34+lateral+offset*line_width
                    responsibility = 'support' if attacking else 'cover'
                x = max(1., min(104., x))
                result[player.index] = PlayerTarget(Vec2(x if direction == 1 else 105-x,
                    max(1., min(67., y))), responsibility)
        if world.ball.mode != 'restart':
            if attacking and world.ball.carrier is not None:
                carrier = world.players[world.ball.carrier]
                if carrier.side == side and carrier.role != 'GK':
                    # Control is not a command to sprint towards goal forever.
                    # A carry objective is finite and set by the action engine.
                    destination = carrier.target if carrier.responsibility == 'carry' else carrier.position
                    result[carrier.index] = PlayerTarget(destination,
                        'carry' if carrier.responsibility == 'carry' else 'hold')
            elif not attacking:
                available = sorted((p for p in players if p.role != 'GK'),
                    key=lambda p: (p.position.distance(ball), p.index))
                for rank, player in enumerate(available[:2 if tactic == 'press' else 1]):
                    if player.position.distance(ball) < (24 if tactic == 'press' else 16):
                        target = ball if rank == 0 else Vec2(ball.x-direction*4, ball.y+(-4 if ball.y > 34 else 4))
                        result[player.index] = PlayerTarget(Vec2(max(1., min(104., target.x)),
                            max(1., min(67., target.y))), 'pressure' if rank == 0 else 'cover_press')
        if world.ball.flight and world.ball.flight.receiver is not None:
            receiver = world.players[world.ball.flight.receiver]
            if receiver.side == side:
                result[receiver.index] = PlayerTarget(world.ball.flight.target, 'receive')
        elif world.ball.carrier is None and world.ball.flight is None and world.ball.mode != 'restart':
            chaser = min(players, key=lambda p: (p.position.distance(ball), p.index))
            result[chaser.index] = PlayerTarget(Vec2(max(1., min(104., ball.x)),
                max(1., min(67., ball.y))), 'recover')
    return result
