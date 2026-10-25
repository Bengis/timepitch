"""Fixed-step velocity integration. A target update cannot assign body positions."""
from math import hypot, sqrt
from .spatial import Vec2
from .replay_models import MotionSample

STEP_MS, ACCELERATION, BRAKING = 250, 4., 5.


def _safe_component(distance, dt):
    return max(0., sqrt((BRAKING*dt)**2+2*BRAKING*max(0., distance))-BRAKING*dt)


def step_world(world, targets, dt_ms=STEP_MS):
    if dt_ms != STEP_MS: raise ValueError('World steps must be 250 ms')
    dt = dt_ms/1000
    for player in world.players:
        target = targets.get(player.index)
        if target:
            player.target, player.responsibility = target.position, target.responsibility
        dx, dy = player.target.x-player.position.x, player.target.y-player.position.y
        distance = hypot(dx, dy)
        speed = min(player.max_speed, _safe_component(distance, dt))
        vx, vy = (dx*speed/distance, dy*speed/distance) if distance > .000001 else (0., 0.)
        # Predictively brake at pitch edges; never clamp the body after integration.
        vx = max(-_safe_component(player.position.x, dt), min(_safe_component(105-player.position.x, dt), vx))
        vy = max(-_safe_component(player.position.y, dt), min(_safe_component(68-player.position.y, dt), vy))
        # A turn can spend the acceleration budget on the other axis. Reserve
        # enough room to brake the whole vector before allowing that turn.
        current_speed = player.velocity.length()
        for component, position, extent in [(player.velocity.x, player.position.x, 105),
                                             (player.velocity.y, player.position.y, 68)]:
            remaining = extent-position if component > 0 else position
            stopping = abs(component)*(current_speed/(2*BRAKING)+dt)+.25
            if component and remaining < stopping:
                vx = vy = 0.
                break
        ax, ay = vx-player.velocity.x, vy-player.velocity.y
        delta = hypot(ax, ay)
        limit = (BRAKING if hypot(vx, vy) < player.velocity.length() else ACCELERATION)*dt
        factor = min(1., limit/delta) if delta else 0.
        velocity = Vec2(player.velocity.x+ax*factor, player.velocity.y+ay*factor)
        player.position = Vec2(player.position.x+velocity.x*dt, player.position.y+velocity.y*dt)
        player.velocity = velocity
    ball = world.ball
    if ball.mode == 'controlled' and ball.carrier is not None:
        holder = world.players[ball.carrier]
        ball.position, ball.velocity = holder.position, holder.velocity
    elif ball.mode == 'flight' and ball.flight:
        dx, dy = ball.flight.target.x-ball.position.x, ball.flight.target.y-ball.position.y
        distance = hypot(dx, dy)
        travel = min(distance, ball.flight.speed*dt)
        vx, vy = (dx/distance, dy/distance) if distance else (0., 0.)
        ball.position = Vec2(ball.position.x+vx*travel, ball.position.y+vy*travel)
        ball.velocity = Vec2(vx*ball.flight.speed, vy*ball.flight.speed)
    world.clock += dt_ms


def capture_sample(world, reset_code=0):
    return MotionSample((world.clock, world.period, world.home_goals, world.away_goals,
        0 if world.possession == 'home' else 1, world.ball.carrier if world.ball.carrier is not None else -1,
        {'controlled': 0, 'flight': 1, 'restart': 2}[world.ball.mode], reset_code,
        round(world.ball.position.x*1000), round(world.ball.position.y*1000),
        [round(c*1000) for p in world.players for c in (p.position.x, p.position.y)]))
