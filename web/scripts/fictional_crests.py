"""TP264: escudos propios de la liga ficticia (26-oct: «faltan los escudos» → «Escudos inventados»).

Un SVG original por club: forma y dibujo elegidos por el nombre ficticio (FNV-1a, como los nombres), colores de la
primera equipación más reciente registrada y las siglas ficticias. No copia ni imita ningún escudo real.

Uso (desde web/): python scripts/fictional_crests.py <URL del API>
  Lee /api/catalog/teams para la lista de clubes y escribe public/assets/crests-fictional/<club>.svg y
  src/catalog/fictional-crests.json (club → fichero). Determinista: repetirlo da los mismos ficheros.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / 'public' / 'assets' / 'crests-fictional'
INDEX = WEB / 'src' / 'catalog' / 'fictional-crests.json'


def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for b in unicodedata.normalize('NFC', text.lower()).encode('utf-8'):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def luminance(hex_colour: str) -> float:
    r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def distance(a: str, b: str) -> float:
    return sum(abs(int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) for i in (1, 3, 5))


def club_colours(club: str, kits: dict, table: dict) -> tuple[str, str]:
    seasons = sorted((k for k in kits if k.split(':')[0] == club and kits[k].get('home')), key=lambda k: int(k.split(':')[1]))
    if seasons:
        home = kits[seasons[-1]]['home']
        primary = (home.get('body') or '#444444').upper()
        for candidate in (home.get('leftarm'), home.get('shorts'), home.get('socks'), '#FFFFFF', '#111111'):
            if candidate and distance(candidate.upper(), primary) > 120:
                return primary, candidate.upper()
        return primary, '#FFFFFF'
    if club in table:
        return table[club]['shirt'].upper(), table[club]['trim'].upper()
    return '#3A4A6B', '#F2C14E'


SHAPES = {
    'heater': 'M50 4 L92 14 V58 C92 86 72 104 50 116 C28 104 8 86 8 58 V14 Z',
    'round': 'M50 6 A52 52 0 1 1 49.9 6 Z',
    'pointed': 'M50 3 L94 12 L90 70 L50 117 L10 70 L6 12 Z',
}
PATTERNS = ('chevron', 'halves', 'band', 'hoop', 'plain')


def crest_svg(abbr: str, name: str, primary: str, secondary: str) -> str:
    h = fnv1a(name)
    shape = list(SHAPES)[h % len(SHAPES)]
    pattern = PATTERNS[(h >> 4) % len(PATTERNS)]
    outline = SHAPES[shape] if shape != 'round' else 'M50 8 a50 50 0 1 0 0.1 0 Z'
    clip = f'<clipPath id="c"><path d="{SHAPES[shape]}"/></clipPath>'
    body = f'<rect x="0" y="0" width="100" height="120" fill="{primary}"/>'
    if pattern == 'chevron':
        body += f'<path d="M0 40 L50 70 L100 40 V58 L50 88 L0 58 Z" fill="{secondary}"/>'
    elif pattern == 'halves':
        body += f'<rect x="50" y="0" width="50" height="120" fill="{secondary}"/>'
    elif pattern == 'band':
        body += f'<path d="M-10 92 L92 -10 L110 8 L8 110 Z" fill="{secondary}"/>'
    elif pattern == 'hoop':
        body += f'<rect x="0" y="44" width="100" height="26" fill="{secondary}"/>'
    # The letters sit on a disc so they stay legible over any pattern.
    disc = primary if pattern in ('plain', 'hoop', 'halves') else primary
    ink = '#FFFFFF' if luminance(disc) < 0.45 else '#111111'
    star = '<path d="M50 14 l3.2 6.6 7.2 1 -5.2 5 1.2 7.2 -6.4 -3.4 -6.4 3.4 1.2 -7.2 -5.2 -5 7.2 -1 z" fill="' + secondary + '"/>'
    text = (f'<circle cx="50" cy="62" r="25" fill="{disc}" stroke="{secondary}" stroke-width="3"/>'
            f'<text x="50" y="68.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" '
            f'font-size="18" textLength="36" lengthAdjust="spacingAndGlyphs" fill="{ink}">{abbr}</text>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120">'
            f'<defs>{clip}</defs><g clip-path="url(#c)">{body}</g>'
            f'<path d="{outline}" fill="none" stroke="{secondary}" stroke-width="4"/>'
            f'<path d="{outline}" fill="none" stroke="#000000" stroke-opacity="0.25" stroke-width="1"/>'
            f'{star}{text}</svg>\n')


def main(api: str) -> None:
    teams = json.load(urllib.request.urlopen(api.rstrip('/') + '/api/catalog/teams', timeout=30))
    clubs = {}
    for t in teams:
        clubs.setdefault(t['club'], t['name'])
    league = json.loads((WEB / 'src' / 'catalog' / 'fictional-league.json').read_text(encoding='utf-8'))['clubs']
    kits = json.loads((WEB / 'src' / 'catalog' / 'historical-kits.json').read_text(encoding='utf-8'))['seasons']
    kits_ts = (WEB / 'src' / 'catalog' / 'kits.ts').read_text(encoding='utf-8')
    table = {m[0]: {'shirt': m[1], 'trim': m[2]} for m in
             re.findall(r"^\s*(\w+): \{ shirt: '(#[0-9A-Fa-f]{6})', shorts: '#[0-9A-Fa-f]{6}', socks: '#[0-9A-Fa-f]{6}', trim: '(#[0-9A-Fa-f]{6})'",
                        kits_ts, re.M)}
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for club, real in sorted(clubs.items()):
        entry = league.get(real.lower())
        if entry is None:
            raise SystemExit(f'{real}: not in the fictional league')
        primary, secondary = club_colours(club, kits, table)
        (OUT / f'{club}.svg').write_text(crest_svg(entry['abbr'], entry['name'], primary, secondary), encoding='utf-8')
        index[club] = f'{club}.svg'
    INDEX.write_text(json.dumps({'version': 'fictional-crests-1', 'files': index}, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    print(len(index), 'crests')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8078')
