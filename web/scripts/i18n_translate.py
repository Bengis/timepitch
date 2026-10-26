"""TP266: completa los catálogos de idioma de la interfaz con el modelo de Azure (gpt-4.1-mini en Foundry).

1. Volcar el inglés (desde web/):  I18N_SOURCE=<fichero> npx vitest run src/i18n-catalog.test.ts
2. Traducir lo que falta:          python scripts/i18n_translate.py <fichero> fr de it pt nl ja zh ko
   (usa el python del backend, que tiene openai y azure-identity, y la sesión de `az login`)

Solo traduce las claves que faltan en src/locales/<código>.json; una traducción que no conserva exactamente los mismos
huecos {0}, {1}… se descarta (esa clave sale en inglés). Añadir un idioma: su código en LOCALES (src/i18n-catalog.ts) y
en LANGUAGES (backend/src/timepitch/crew/translate.py), y ejecutar este script con él.
"""
import json
import re
import sys
import time
from pathlib import Path

LANGUAGES = {'fr': 'French', 'de': 'German', 'it': 'Italian', 'pt': 'European Portuguese', 'nl': 'Dutch', 'ja': 'Japanese',
             'zh': 'Simplified Chinese', 'ko': 'Korean', 'es': 'Spanish'}
ENDPOINT = 'https://timepitch-ai.openai.azure.com/openai/v1/'
DEPLOYMENT = 'gpt-4.1-mini'
BATCH = 50
# The deployment allows 20 000 tokens a minute and the public demo's reports and questions share it: stay at about half.
TOKENS_PER_MINUTE = 9000
LOCALES = Path(__file__).resolve().parents[1] / 'src' / 'locales'

INSTRUCTIONS = (
    'You translate the user interface of TimePitch, a football (soccer) match simulator web app, from British English into '
    '{language}. Each item is one UI string: a button, label, tooltip, note or a commentary/report template. Translate it '
    'naturally and concisely as a native football app would, keeping the same tone and length where possible. Keep exactly '
    'every placeholder like {{0}} or {{1}} (same placeholders, any order the grammar needs). Keep unchanged: product and '
    'brand names (TimePitch, Google Research Football, GRF, TouchLines, open-football, Azure, Azure AI Foundry, Microsoft '
    'Agent Framework, Container Apps, StatsBomb, Wikipedia, Wikidata, Three.js, Quaternius, FPL, xG, xA), units and '
    'abbreviations like km/h, HSR, TP. Return every key exactly once.')


def holes(text: str) -> list[str]:
    return sorted(re.findall(r'\{\d+\}', text))


def client():
    from azure.identity import DefaultAzureCredential
    from openai import OpenAI
    token = DefaultAzureCredential(exclude_interactive_browser_credential=True).get_token(
        'https://cognitiveservices.azure.com/.default').token
    return OpenAI(base_url=ENDPOINT, api_key=token, max_retries=0, timeout=120)


def translate_batch(api, language: str, items: list[tuple[str, str]]) -> dict[str, str]:
    schema = {'type': 'object', 'additionalProperties': False, 'required': ['items'],
              'properties': {'items': {'type': 'array', 'items': {
                  'type': 'object', 'additionalProperties': False, 'required': ['key', 'text'],
                  'properties': {'key': {'type': 'string'}, 'text': {'type': 'string'}}}}}}
    from openai import RateLimitError
    for attempt in range(6):
        try:
            response = api.chat.completions.create(
                model=DEPLOYMENT, temperature=0, max_tokens=8000,
                messages=[{'role': 'system', 'content': INSTRUCTIONS.format(language=LANGUAGES[language])},
                          {'role': 'user', 'content': json.dumps([{'key': k, 'text': t} for k, t in items], ensure_ascii=False)}],
                response_format={'type': 'json_schema', 'json_schema': {'name': 'ui_strings', 'strict': True, 'schema': schema}})
            break
        except RateLimitError:
            time.sleep(30 * (attempt + 1))
    else:
        return {}
    used = response.usage.total_tokens if response.usage else 4000
    time.sleep(60 * used / TOKENS_PER_MINUTE)  # pace: never more than TOKENS_PER_MINUTE on average
    out = {}
    wanted = dict(items)
    for item in json.loads(response.choices[0].message.content)['items']:
        key, text = item['key'], item['text'].strip()
        if key in wanted and text and holes(text) == holes(wanted[key]):
            out[key] = text
    return out


def complete(api, source: dict, language: str) -> tuple[int, int]:
    path = LOCALES / f'{language}.json'
    catalog = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}
    for ns, entries in source.items():  # nothing to translate in an empty string
        for key, text in entries.items():
            if not text.strip():
                catalog.setdefault(ns, {})[key] = text
    missing = [(f'{ns}␟{key}', text) for ns, entries in source.items() for key, text in entries.items()
               if key not in catalog.get(ns, {})]
    done = 0
    for i in range(0, len(missing), BATCH):
        batch = missing[i:i + BATCH]
        for flat, text in translate_batch(api, language, batch).items():
            ns, key = flat.split('␟', 1)
            catalog.setdefault(ns, {})[key] = text
            done += 1
        ordered = {ns: dict(sorted(catalog[ns].items())) for ns in sorted(catalog)}
        path.write_text(json.dumps(ordered, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return done, len(missing)


def main(source_file: str, languages: list[str]) -> None:
    source = json.loads(Path(source_file).read_text(encoding='utf-8'))
    LOCALES.mkdir(parents=True, exist_ok=True)
    for language in languages:  # one at a time: the shared rate limit, not the wall clock, is the constraint
        done, total = complete(client(), source, language)  # a fresh token per language: they last about an hour
        print(f'{language}: {done}/{total} translated', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
