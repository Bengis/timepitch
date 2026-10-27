"""Fail-closed REST transport for the four specifically authorized F0 samples."""
from hashlib import sha256
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import time
from uuid import UUID
from xml.etree import ElementTree

import httpx

from .ledger import SpeechLedger, SpeechRefused
from .capabilities import evaluate_capabilities

BASE_URL = 'https://swedencentral.tts.speech.microsoft.com'
FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
RESOURCE = {'name': 'timepitch-speech-f0', 'group': 'timepitch', 'kind': 'SpeechServices', 'sku': 'F0', 'location': 'swedencentral'}
LEGACY_PRESETS = [('en', 'en-US-GuyNeural', None), ('en', 'en-US-GuyNeural', 'excited'),
                  ('es', 'es-ES-AlvaroNeural', None), ('es', 'es-ES-AlvaroNeural', 'cheerful')]
PRESETS = [*LEGACY_PRESETS[:3], ('es', 'es-ES-AlvaroNeural', None)]
LIMITS = {'new_speech_requests': 4, 'new_speech_reservations': 4, 'ssml_utf8_bytes': 4000,
          'speech_cost_ceiling_eur': 0, 'automatic_retries': 0, 'concurrency': 1,
          'minimum_request_spacing_seconds': 4, 'stop_on_first_failure': True}


def require(condition, code):
    if not condition:
        raise SpeechRefused(code)


def validate_inputs(raw: bytes, auth: dict, dry_raw: bytes) -> dict:
    require(auth.get('authorized') is True, 'unauthorized')
    require(auth.get('proposal_sha256') == sha256(raw).hexdigest(), 'proposal_hash')
    proposal = validate_proposal(raw, dry_raw)
    require(auth.get('subscription_id') == proposal['subscription_id'], 'subscription_mismatch')
    for field, value in [('max_requests', 4), ('max_reservations', 4), ('max_ssml_bytes', 4000), ('speech_cost_ceiling_eur', 0)]:
        require(auth.get(field) == value, 'authorization_limit')
    if proposal.get('preset_revision') == 'alvaro-prosody-2':
        require(auth.get('recovery_parent_sha256') == proposal['lineage']['parent_proposal_sha256'], 'recovery_parent')
    return {**proposal, 'authorization': dict(auth), 'binding': sha256(raw).hexdigest()}


def validate_proposal(raw: bytes, dry_raw: bytes) -> dict:
    """Pure structural validation; never admits a request or changes a ledger."""
    proposal = json.loads(raw)
    require(proposal.get('resource') == RESOURCE, 'resource_proposal')
    require(proposal.get('explicit_subscription_required') is True, 'subscription_unpinned')
    subscription = proposal['subscription_id']
    require(str(UUID(subscription)) == subscription, 'subscription_format')
    require(all(proposal.get('limits', {}).get(k) == v for k, v in LIMITS.items()), 'proposal_limit')
    require(proposal.get('dry_manifest_sha256') == sha256(dry_raw).hexdigest(), 'dry_hash')
    dry = json.loads(dry_raw)
    require(proposal.get('source') == dry.get('source'), 'source_mismatch')
    cues = {cue['id']: cue for cue in dry['pilot']['cues']}
    items = proposal['items']
    require(len(items) == 4 and len({i['cue_id'] for i in items}) == 4, 'four_unique_items')
    revision = proposal.get('preset_revision', 'legacy-1')
    require(revision in ('legacy-1', 'alvaro-prosody-2'), 'preset_revision')
    if revision == 'alvaro-prosody-2':
        parent = proposal.get('lineage', {}).get('parent_proposal_sha256', '')
        require(isinstance(parent, str) and len(parent) == 64 and all(c in '0123456789abcdef' for c in parent), 'recovery_parent')
    presets = LEGACY_PRESETS if revision == 'legacy-1' else PRESETS
    for index, (item, preset) in enumerate(zip(items, presets, strict=True)):
        require(tuple(item.get(k) for k in ['locale', 'voice', 'style']) == preset, 'preset')
        require(item.get('format') == FORMAT, 'format')
        body = item['ssml'].encode('utf-8')
        require(item['ssml_sha256'] == sha256(body).hexdigest() and item['ssml_utf8_bytes'] == len(body), 'payload_hash')
        require(b'<!' not in body, 'ssml_declaration')
        xml = ElementTree.fromstring(body)
        voices = xml.findall('{http://www.w3.org/2001/10/synthesis}voice')
        require(len(voices) == 1 and voices[0].get('name') == item['voice'], 'ssml_voice')
        cue = cues.get(item['cue_id'], {})
        for a, b in [('ssml','ssml'), ('ssml_sha256','ssmlSha256'), ('ssml_utf8_bytes','bytes'), ('locale','locale'), ('voice','voice'), ('style','style'), ('format','format')]:
            require(item.get(a) == cue.get(b), 'dry_cue_mismatch')
        if revision == 'alvaro-prosody-2' and index == 3:
            binding = cue.get('binding', {}).get('preset', {})
            require(item.get('preset_id') == binding.get('id') == 'es-goal-prosody-2', 'prosody_revision')
            require(item.get('treatment') == cue.get('treatment') == binding.get('label') == 'More energetic prosody', 'prosody_label')
            require(binding.get('rate') == '+5%' and binding.get('pitch') == '+3%' and binding.get('style') is None, 'prosody_binding')
            prosody = list(voices[0])
            require(len(list(xml)) == 1 and len(prosody) == 1 and prosody[0].tag == '{http://www.w3.org/2001/10/synthesis}prosody'
                    and prosody[0].attrib == {'rate': '+5%', 'pitch': '+3%'} and not list(prosody[0]), 'prosody_ssml')
    require(sum(i['ssml_utf8_bytes'] for i in items) <= 4000, 'byte_limit')
    return proposal


def validate_resource(plan: dict, resource: dict):
    expected = f"/subscriptions/{plan['subscription_id']}/resourceGroups/timepitch/providers/Microsoft.CognitiveServices/accounts/timepitch-speech-f0"
    require(resource.get('id', '').casefold() == expected.casefold(), 'resource_identity')
    require(resource.get('name') == RESOURCE['name'] and resource.get('kind') == 'SpeechServices', 'resource_kind')
    require(resource.get('sku', {}).get('name') == 'F0', 'resource_not_f0')
    require(resource.get('location') == 'swedencentral' and resource.get('properties', {}).get('provisioningState') == 'Succeeded', 'resource_not_ready')


def write_exclusive(path: Path, body: bytes):
    with path.open('xb') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())


def inspect_capabilities(plan: dict, key: str, client: httpx.Client, output: Path) -> dict:
    """GET once and retain only safe evidence before any rejection/reservation."""
    catalog = None
    status = None
    digest = None
    error = None
    try:
        response = client.get('/cognitiveservices/voices/list', headers={'Ocp-Apim-Subscription-Key': key})
        status = response.status_code
        digest = sha256(response.content).hexdigest()
        if status != 200:
            error = f'catalog_http_{status}'
        else:
            try:
                catalog = response.json()
            except (ValueError, UnicodeError):
                error = 'catalog_invalid_json'
    except httpx.TimeoutException:
        error = 'catalog_timeout'
    except httpx.RequestError:
        error = 'catalog_request_failed'
    report = evaluate_capabilities(plan['items'], catalog)
    if error is None and not report['catalog_valid']:
        error = 'catalog_invalid'
    receipt = {'version': 'speech-capabilities-1', 'at_utc': datetime.now(timezone.utc).isoformat(),
               'region': RESOURCE['location'], 'resource': RESOURCE['name'], 'sku': RESOURCE['sku'],
               'http_status': status, 'response_sha256': digest, 'proposal_sha256': plan['binding'],
               **report, 'error': error}
    try:
        write_exclusive(output / 'capabilities.json', json.dumps(receipt, indent=2).encode('utf-8'))
    except OSError:
        raise SpeechRefused('capability_receipt_unwritten') from None
    return receipt


def run_canary(plan: dict, resource: dict, key: str, ledger: SpeechLedger, client: httpx.Client,
               output: Path, probe, *, sleep=time.sleep, verify_resource) -> dict:
    require(output.resolve() == Path(plan['authorization']['output_root']).resolve(), 'output_mismatch')
    require(str(client.base_url).rstrip('/') == BASE_URL and not client.follow_redirects, 'transport_target')
    ledger.claim(plan['authorization']['id'], plan['binding'])
    result = {'status': 'stopped', 'samples': [], 'speech_cost_ceiling_eur': 0, 'error': None}
    active = None
    try:
        validate_resource(plan, resource)
        capabilities = inspect_capabilities(plan, key, client, output)
        result['capability_receipt'] = 'capabilities.json'
        require(capabilities['error'] is None, capabilities['error'])
        for check in capabilities['checks']:
            code = f"voice_capability:{check['index']}:{check['voice']}:{check['requested_style'] or 'neutral'}:{check['reason']}"
            require(check['compatible'], code)
        for index, item in enumerate(plan['items']):
            if index:
                sleep(4)
            validate_resource(plan, verify_resource())
            ledger.reserve(index, item['ssml_sha256'], item['ssml_utf8_bytes'])
            active = index
            ledger.mark_sent(index)
            response = client.post('/cognitiveservices/v1', content=item['ssml'].encode('utf-8'), headers={
                'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': FORMAT, 'User-Agent': 'TimePitch-Speech-Canary/1'})
            require(response.status_code == 200, f'synthesis_http_{response.status_code}')
            body = response.content
            require(response.headers.get('content-type', '').split(';')[0] in ('audio/mpeg', 'audio/mp3'), 'audio_content_type')
            require(64 <= len(body) <= 2_000_000 and (body[:3] == b'ID3' or body[0] == 255 and body[1] & 224 == 224), 'audio_bytes')
            treatment = 'prosody' if item.get('preset_id') == 'es-goal-prosody-2' else item['style'] or 'neutral'
            path = output / f'{index + 1:02d}-{item["locale"]}-{treatment}.mp3'
            write_exclusive(path, body)
            metadata = probe(path)
            require(metadata['codec'] == 'mp3' and metadata['sample_rate'] == 24000 and metadata['channels'] == 1
                    and metadata['bit_rate'] == 48000 and math.isfinite(metadata['duration_s']) and metadata['duration_s'] > 0, 'audio_metadata')
            receipt = {'index': index, 'cue_id': item['cue_id'], 'voice': item['voice'], 'style': item['style'],
                       'ssml_bytes': item['ssml_utf8_bytes'], 'ssml_sha256': item['ssml_sha256'],
                       'audio_sha256': sha256(body).hexdigest(), 'audio_bytes': len(body), 'file': path.name,
                       'request_id': response.headers.get('x-requestid'), **metadata}
            for field in ('preset_id', 'treatment', 'cache_key'):
                if field in item:
                    receipt[field] = item[field]
            write_exclusive(path.with_suffix('.receipt.json'), json.dumps(receipt, indent=2).encode())
            ledger.receipt(index, 'received', json.dumps(receipt))
            result['samples'].append(receipt)
            active = None
        result['status'] = 'completed'
    except Exception as error:
        # Never serialize an HTTP exception/request: it can contain the subscription key.
        code = str(error) if isinstance(error, SpeechRefused) else type(error).__name__
        result['error'] = code
        if active is not None:
            ledger.receipt(active, 'failed_or_uncertain', json.dumps({'error': code}))
    ledger.finish(result['status'])
    result['usage'] = ledger.summary()
    result['cumulative_usage'] = ledger.cumulative_summary()
    return result
