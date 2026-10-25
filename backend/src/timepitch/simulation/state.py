"""Small mutable core state; rendering is a deterministic projection, not another simulation."""
from dataclasses import dataclass
import math
from .models import MatchConfig, PlayerProfile, PlayerFrame, RenderFrame, Point, Score


@dataclass
class MatchState:
    config: MatchConfig
    profiles: dict
    people: dict
    clock: int = 0
    period: int = 1
    possession: str = 'home'
    carrier: str | None = None
    ball_x: float = 52.5
    ball_y: float = 34
    home_goals: int = 0
    away_goals: int = 0
    event_count: int = 0

    def lineup(self, side):
        return self.profiles[side].players

    def direction(self, side):
        return 1 if (side == 'home') == (self.period == 1) else -1

    def key(self, side, player):
        return side + ':' + player.player_key

    def position(self, side, player):
        role_players = [p for p in self.lineup(side) if p.role == player.role]
        index = next(i for i, p in enumerate(role_players) if p.player_key == player.player_key)
        direction = self.direction(side)
        base_x = {'GK': 6, 'DEF': 28, 'MID': 49, 'FWD': 74}[player.role]
        shift = (self.ball_x - 52.5) * direction * (.32 if player.role != 'GK' else .05)
        x = min(101, max(4, base_x + shift))
        y = 68 * (index + 1) / (len(role_players) + 1)
        if player.role != 'GK':
            y += math.sin(self.clock / 12000 + index * 2) * 2.5
        return (x if direction == 1 else 105 - x, min(66, max(2, y)))

    def snapshot(self):
        players = []
        for side in ('home', 'away'):
            for profile in self.lineup(side):
                x, y = self.position(side, profile)
                key = self.key(side, profile)
                if key == self.carrier:
                    x, y = self.ball_x, self.ball_y
                players.append(PlayerFrame(key=key, name=self.people[profile.player_key].name,
                    role=profile.role, side=side, x=round(x, 3), y=round(y, 3)))
        return RenderFrame(players=players, ball=Point(x=round(self.ball_x, 3), y=round(self.ball_y, 3)),
            carrier=self.carrier, possession=self.possession, clock_ms=self.clock, period=self.period,
            score=Score(home=self.home_goals, away=self.away_goals))
