"""Explicit operator command; a single-use output directory prevents re-execution."""
import argparse
import json
from pathlib import Path
import subprocess

import httpx

from .ledger import SpeechGrantRegistry, SpeechLedger, SpeechRefused
from .provider import BASE_URL, require, run_canary, validate_inputs, validate_resource, write_exclusive
from .recovery import RecoveryLedger, read_parent_state

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


def azure_json(python: Path, subscription: str, arguments: list[str]):
    # Values including keys are captured in memory, never echoed or included in errors.
    result = subprocess.run([str(python), '-IBm', 'azure.cli', *arguments,
                             '--subscription', subscription, '--only-show-errors', '-o', 'json'],
                            capture_output=True, timeout=90, check=False)
    require(result.returncode == 0, 'azure_read_failed')
    return json.loads(result.stdout)


def probe_audio(ffprobe: Path, path: Path):
    result = subprocess.run([str(ffprobe), '-v', 'error', '-show_entries',
                             'format=duration:stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', str(path)],
                            capture_output=True, timeout=15, check=False)
    require(result.returncode == 0, 'audio_probe_failed')
    data = json.loads(result.stdout)
    require(len(data['streams']) == 1, 'audio_streams')
    stream = data['streams'][0]
    return {'duration_s': float(data['format']['duration']), 'codec': stream['codec_name'],
            'sample_rate': int(stream['sample_rate']), 'channels': stream['channels'], 'bit_rate': int(stream['bit_rate'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['proposal', 'authorization', 'dry-manifest', 'azure-python', 'ffprobe']:
        parser.add_argument(f'--{flag}', type=Path, required=True)
    args = parser.parse_args()
    auth = json.loads(args.authorization.read_bytes())
    plan = validate_inputs(args.proposal.read_bytes(), auth, args.dry_manifest.read_bytes())
    require(args.azure_python.is_file() and args.ffprobe.is_file(), 'missing_local_tool')
    output = Path(auth['output_root'])
    require(output.is_dir(), 'missing_output_root')
    registry_path = REPOSITORY_ROOT / '.local' / 'speech-canary-grants.sqlite3'
    # Exclusive intent survives gate/key/catalog/network failure without a CLI rerun.
    write_exclusive(output / 'execution-intent.json', json.dumps({'grant_id': auth['id'], 'binding': plan['binding']}).encode())
    ledger = None
    try:
        if plan.get('preset_revision') == 'alvaro-prosody-2':
            parent = read_parent_state(plan, auth, REPOSITORY_ROOT)
            registry = SpeechGrantRegistry(registry_path, existing_only=True)
            try:
                registry.claim_recovery(auth['id'], plan['binding'], str(output.resolve()), parent['binding'])
            finally:
                registry.db.close()
            write_exclusive(output / 'parent-state.json', json.dumps(parent, indent=2).encode())
            ledger = RecoveryLedger(output / 'speech-ledger.sqlite3', parent, lambda: read_parent_state(plan, auth, REPOSITORY_ROOT))
        else:
            registry = SpeechGrantRegistry(registry_path)
            try:
                registry.claim(auth['id'], plan['binding'], str(output.resolve()))
            finally:
                registry.db.close()
            ledger = SpeechLedger(output / 'speech-ledger.sqlite3')
        def resource():
            return azure_json(args.azure_python, plan['subscription_id'], [
                'cognitiveservices', 'account', 'show', '--name', 'timepitch-speech-f0', '--resource-group', 'timepitch'])
        metadata = resource()
        validate_resource(plan, metadata)
        keys = azure_json(args.azure_python, plan['subscription_id'], [
            'cognitiveservices', 'account', 'keys', 'list', '--name', 'timepitch-speech-f0', '--resource-group', 'timepitch'])
        key = keys.pop('key1')
        keys.clear()
        with httpx.Client(base_url=BASE_URL, transport=httpx.HTTPTransport(retries=0),
                          follow_redirects=False, trust_env=False, timeout=45) as client:
            result = run_canary(plan, metadata, key, ledger, client, output,
                                lambda path: probe_audio(args.ffprobe, path), verify_resource=resource)
        del key
    except Exception as error:
        code = str(error) if isinstance(error, SpeechRefused) else type(error).__name__
        result = {'status': 'stopped', 'error': code, 'usage': ledger.summary() if ledger else {'reservations': 0, 'sent': 0, 'reserved_ssml_bytes': 0}, 'samples': []}
        if ledger:
            ledger.finish('stopped')
            result['cumulative_usage'] = ledger.cumulative_summary()
    write_exclusive(output / 'result.json', json.dumps(result, indent=2).encode())
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
