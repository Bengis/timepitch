"""Shared completion rule, also importable by standalone Python 3.10."""


def full_time_opportunity(phase:int,match_time_ms:int,game_mode:int,ball_x:float)->bool:
    # A pending penalty must be taken even after regulation time.
    return (phase==2 and 5400000<=match_time_ms<5760000 and game_mode!=6 and
            (game_mode!=0 or abs(ball_x)<.4))
