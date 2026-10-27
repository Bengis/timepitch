"""Pure evaluation of catalog evidence; no HTTP, credentials or budget access."""
import re


def evaluate_capabilities(items: list[dict], catalog: object) -> dict:
    voices = {}
    valid = isinstance(catalog, list)
    if valid:
        for row in catalog:
            if not isinstance(row, dict) or not isinstance(row.get('ShortName'), str) or not row['ShortName'] or row['ShortName'] in voices:
                valid = False
                break
            name = row['ShortName']
            styles = row.get('StyleList')
            if styles is None:
                styles = []
            if not isinstance(styles, list) or any(not isinstance(s, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', s) for s in styles):
                valid = False
                break
            if row.get('VoiceType') is not None and not isinstance(row['VoiceType'], str):
                valid = False
                break
            # Do not retain arbitrary fields or unrecognized server-supplied type text.
            voice_type = row.get('VoiceType') if row.get('VoiceType') in ('Neural', 'Standard') else None
            voices[name] = {'ShortName': name, 'VoiceType': voice_type, 'StyleList': list(styles)}
    if not valid:
        voices = {}
    checks = []
    for index, item in enumerate(items):
        voice = item['voice']
        style = item.get('style')
        entry = voices.get(voice)
        reason = None
        if not valid:
            reason = 'catalog_invalid'
        elif entry is None:
            reason = 'voice_missing'
        elif entry['VoiceType'] != 'Neural':
            reason = 'voice_type_not_neural'
        elif style is not None and style not in entry['StyleList']:
            reason = 'style_not_announced'
        checks.append({'index': index, 'cue_id': item['cue_id'], 'voice': voice, 'requested_style': style,
                       'present': entry is not None, 'voice_type': entry['VoiceType'] if entry else None,
                       'announced_styles': list(entry['StyleList']) if entry else [],
                       'compatible': reason is None, 'reason': reason})
    return {'catalog_valid': valid, 'checks': checks,
            'entries': [voices[name] for name in dict.fromkeys(item['voice'] for item in items) if name in voices]}
