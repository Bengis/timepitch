"""TP259: fictional league names, shared with the web (same JSON file, same results)."""
from pathlib import Path

from timepitch.fictional import club_name, fictional_pack, fnv1a, league, player_name
from crew_fixtures import tp229_pack

ROOT = Path(__file__).resolve().parents[2]

# The web test (web/src/catalog/fictional.test.ts) checks the same pairs.
PLAYERS = {'Thierry Henry': 'Nico Warburton', 'Erling Haaland': 'Lewis Dunmore', 'Ilkay Gündogan': 'Danny Vance',
           "Steven N'Zonzi": 'Arlo Moffat', 'Gilberto Silva': 'Jude Norris'}


def test_fnv1a_is_the_standard_32_bit_hash():
    assert fnv1a('a') == 0xE40C292C


def test_players_get_stable_invented_names():
    assert {real: player_name(real) for real in PLAYERS} == PLAYERS
    assert player_name('  thierry   HENRY ') == 'Nico Warburton'  # spacing and case do not matter


def test_clubs_keep_their_season_and_unknown_clubs_keep_their_name():
    assert club_name('Arsenal 2003/04') == 'North London Reds 2003/04'
    assert club_name('Manchester City') == 'Mancunian Sky'
    assert club_name('Brighton & Hove Albion 2023/24') == 'Downs Blues 2023/24'
    assert club_name('Unknown FC') == 'Unknown FC'


def test_every_catalogue_club_has_a_distinct_fictional_name():
    from timepitch.catalog.repository import CLUB_NAMES
    clubs = league()['clubs']
    assert all(name.lower() in clubs for name in CLUB_NAMES.values())
    names = {clubs[name.lower()]['name'] for name in CLUB_NAMES.values()}
    assert len(names) == len(CLUB_NAMES)


def test_fictional_pack_swaps_names_and_keeps_every_fact():
    pack = tp229_pack()
    fake = fictional_pack(pack)
    assert fake.home_name == club_name(pack.home_name) != pack.home_name
    for real, made in zip(pack.facts, fake.facts):
        assert made.player_ids == real.player_ids and made.value == real.value and made.event_refs == real.event_refs
        assert made.player_names == [player_name(n) for n in real.player_names]


def test_the_web_uses_the_same_league_file():
    backend = ROOT / 'backend' / 'src' / 'timepitch' / 'fictional' / 'fictional-league.json'
    web = ROOT / 'web' / 'src' / 'catalog' / 'fictional-league.json'
    assert web.read_bytes() == backend.read_bytes()
