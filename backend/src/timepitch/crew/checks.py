"""Crew-level deterministic checks: names as recorded (crew-verifier-3), the citation Fixer and
plain-language revision guidance. None of this changes the chronicle validator or its version.
"""
import re

from ..chronicles.azure.models import ChronicleDraft, ProseSentence
from ..chronicles.azure.validation import _PAIR, _WORD
from ..chronicles.models import FactPack
from .models import CrewPlan


def sentences(draft: ChronicleDraft) -> list[tuple[str, ProseSentence]]:
    return [('headline', draft.headline)] + [(f'p{i}s{j}', s) for i, p in enumerate(draft.paragraphs, 1)
                                             for j, s in enumerate(p.sentences, 1)]


# ---- names exactly as recorded ----------------------------------------------------------------

def recorded_names(pack: FactPack) -> list[str]:
    names = {pack.home_name, pack.away_name, *(n for f in pack.facts for n in f.player_names)}
    return sorted(names, key=len, reverse=True)


def name_failure(pack: FactPack, text: str) -> bool:
    """True when a recorded name is written with other capitalisation, or a part of one appears alone.

    The chronicle validator matches names case-insensitively and only flags capitalised unknown
    words, so "steven n'zonzi" or a lowercase "henry" pass it. The crew requires the recorded form.
    """
    names = recorded_names(pack)
    rest = text
    for name in names:
        rest = re.sub(r'(?<!\w)' + re.escape(name) + r'(?!\w)', ' ', rest)  # exact, case-sensitive
    for name in names:
        if re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', rest, re.I):
            return True  # a full name in another capitalisation
    parts = {w.casefold() for name in names for w in _WORD.findall(name) if len(w) >= 3}
    # A possessive ("Blackburn's") is still a shortened name.
    return any(re.sub(r"['’]s$", '', w).casefold() in parts for w in _WORD.findall(rest))


_POSSESSIVE = r"['’]s(?!\w)"


def possessive_failure(pack: FactPack, text: str) -> bool:
    """A possessive on a full recorded name ("Arsenal's", "Manchester United's")."""
    return any(re.search(r'(?<!\w)' + re.escape(name) + _POSSESSIVE, text) for name in recorded_names(pack))


def name_failures(pack: FactPack, draft: ChronicleDraft, skip: set[str]) -> list[tuple[str, str]]:
    out = []
    for where, s in sentences(draft):
        if where in skip:
            continue
        if name_failure(pack, s.text):
            out.append(('name_not_as_recorded', where))
        if possessive_failure(pack, s.text):
            out.append(('possessive_name', where))
    return out


# ---- coverage is server-owned (crew-verifier-4) ------------------------------------------------

_COVERAGE_WORDS = re.compile(r'\b(?:coverage|covered|telemetry|export\w*|omit\w*|incomplete|completeness|'
                             r'missing data|cobertura|cubiert\w*|telemetr[ií]a|omiti\w*|incomplet\w*|datos ausentes)\b',
                             re.I)


def coverage_failures(pack: FactPack, draft: ChronicleDraft) -> list[tuple[str, str]]:
    coverage = {f.id for f in pack.facts if f.kind == 'coverage'}
    return [('coverage_in_prose', where) for where, s in sentences(draft)
            if coverage & set(s.fact_ids) or _COVERAGE_WORDS.search(s.text)]


# ---- deterministic Fixer ----------------------------------------------------------------------

FIXABLE = frozenset({'unsupported_score', 'unsupported_clock', 'uncited_entity'})


def _clock(ms):
    return f'{ms // 60000:02d}:{ms // 1000 % 60:02d}'


def _support(pack: FactPack, allowed: set[str], code: str, sentence: ProseSentence) -> list[str] | None:
    """Fact ids that literally support the claim behind a citation-only failure, or None."""
    facts = {f.id: f for f in pack.facts}
    cited = set(sentence.fact_ids)
    text = sentence.text
    if code == 'unsupported_score':
        pairs = [(int(m[1]), int(m[3])) for m in _PAIR.finditer(text) if m[2] != ':']
        if pairs and all(p == tuple(pack.score) for p in pairs) and 'result' not in cited:
            return ['result']
        return None
    if code == 'unsupported_clock':
        covered = {_clock(facts[i].time_ms) for i in cited if facts[i].kind == 'goal' and facts[i].time_ms is not None}
        add = []
        for m in _PAIR.finditer(text):
            if m[2] != ':' or m.group() in covered:
                continue
            match = [f.id for f in pack.facts if f.kind == 'goal' and f.id in allowed and f.time_ms is not None
                     and _clock(f.time_ms) == m.group()]
            if len(match) != 1:
                return None
            add.append(match[0])
        return list(dict.fromkeys(add)) or None
    if code == 'uncited_entity':
        named = {n for i in cited for n in facts[i].player_names}
        add = []
        for name in {n for f in pack.facts for n in f.player_names} - named:
            if re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', text):  # exact recorded form only
                match = [f.id for f in pack.facts if name in f.player_names and f.id in allowed]
                if len(match) != 1:
                    return None
                add.append(match[0])
        return list(dict.fromkeys(add)) or None
    return None


def fix_citations(pack: FactPack, plan: CrewPlan, draft: ChronicleDraft,
                  failures: list[tuple[str, str]]) -> tuple[ChronicleDraft, list[str]]:
    """Add only fact ids that literally support a failing claim. Wording and numbers never change."""
    allowed = {i for p in plan.paragraphs for i in p} | {'result'}
    data = draft.model_dump(mode='json')
    where = dict(sentences(draft))
    fixes = []
    for code, location in failures:
        if code not in FIXABLE or location not in where:
            continue
        sentence = where[location]
        add = _support(pack, allowed, code, sentence)
        if not add or len(sentence.fact_ids) + len(add) > 4:
            continue
        target = data['headline'] if location == 'headline' else \
            data['paragraphs'][int(location[1]) - 1]['sentences'][int(location[3]) - 1]
        if target['text'] != sentence.text:
            continue
        target['fact_ids'] = list(sentence.fact_ids) + [i for i in add if i not in sentence.fact_ids]
        fixes += [f'{location}+{i}' for i in add]
    fixed = ChronicleDraft.model_validate(data)
    assert [s.text for _, s in sentences(fixed)] == [s.text for _, s in sentences(draft)]
    return fixed, fixes


# ---- revision guidance (app-owned rules; the quoted sentence is the model's own text) ---------

RULES = {
    'uncited_entity': ('A recorded name appears but no fact cited by this sentence names that person.',
                       ['cite the fact that names this person', 'or remove the name from this sentence']),
    'unknown_entity': ('A capitalised word is not a recorded name of a cited fact (shortened names, possessives '
                       'and title case are all caught).',
                       ['write each name exactly as recorded and cite its fact', 'write ordinary words in lowercase',
                        'remove shortened names and possessives']),
    'name_not_as_recorded': ('A name is not written exactly as recorded: wrong capitalisation, or a part of a name '
                             'used on its own.',
                             ['write the full recorded name with its recorded capitals',
                              'or remove that name from this sentence']),
    'unsupported_score': ('A score appears in a sentence that does not cite result, or it is not the final '
                          'recorded score.', ['remove the score from this sentence',
                                              'or cite fact result, if it is the final recorded score']),
    'unsupported_clock': ('A clock does not match a goal cited by this sentence.',
                          ['use the mm:ss time of a cited goal', 'or cite the goal fact with that time',
                           'or remove the clock']),
    'unsupported_number': ('A number is not held by the facts cited in this sentence.',
                           ['remove the number', 'or cite the fact that holds it']),
    'unsupported_number_format': ('A number uses the wrong decimal separator for the language.',
                                  ['use the decimal separator of the requested language']),
    'unsupported_metric': ('The sentence names a statistic (goals, shots, passes, recoveries, possession) that it '
                           'does not cite, or a metric that is never allowed.',
                           ['delete those statistic words', 'or cite the fact that holds that statistic']),
    'unsupported_interpretation': ('The sentence gives a verdict or cause (domination, pressure, tactics, deserved, '
                                   'because, therefore...).', ['replace it with one of the allowed verbs',
                                                               'or delete the verdict']),
    'own_goal_marker_required': ('An own goal is cited but the sentence does not say own goal.',
                                 ['say "own goal" in this sentence']),
    'unsupported_language': ('The sentence is not in the requested language.', ['rewrite it in the requested language']),
    'unsafe_text': ('The sentence contains a link, markup or control characters.', ['use plain text only']),
    'result_reference_required': ('The headline must cite result.', ['add result to the headline facts']),
    'unknown_fact_reference': ('A cited fact id does not exist.', ['cite only fact ids from the payload']),
    'unplanned_fact': ('A cited fact is not in the paragraph plan.', ['cite only planned facts']),
    'possessive_name': ('A recorded name carries a possessive ("Arsenal\'s").',
                        ['rephrase with "for" or "of" and the full recorded name']),
    'coverage_in_prose': ('The prose must not talk about data coverage or cite the coverage fact; the server adds '
                          'its own coverage line.', ['delete the coverage sentence or the coverage words',
                                                     'and remove the coverage fact from its citations']),
}


def guidance(draft: ChronicleDraft, code: str, location: str) -> dict:
    where = dict(sentences(draft))
    rule, options = RULES.get(code, ('The sentence fails an automatic check.', ['rewrite the sentence plainly']))
    sentence = where.get(location)
    if code == 'unsupported_metric' and sentence is not None and sentence.fact_ids == ['coverage']:
        rule = 'The coverage sentence must not mention goals, shots, passes, recoveries or possession.'
        options = ['delete those words from the coverage sentence']
    item = {'location': location, 'failed_check': code, 'rule': rule, 'fix_options': options}
    if sentence is not None:
        item['sentence'] = sentence.text
        item['cited_facts'] = list(sentence.fact_ids)
    return item
