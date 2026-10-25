"""Generate the TypeScript contract from the actual FastAPI OpenAPI schema."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend/src'))
from timepitch.app import create_app  # noqa: E402


def main():
    schema = ROOT / '.local/openapi.json'
    schema.parent.mkdir(parents=True, exist_ok=True)
    schema.write_text(json.dumps(create_app().openapi(), ensure_ascii=False), encoding='utf-8')
    subprocess.run(['node', str(ROOT / 'web/node_modules/openapi-typescript/bin/cli.js'),
                    str(schema), '--output', str(ROOT / 'web/src/generated/api.ts')], check=True, cwd=ROOT)


if __name__ == '__main__':
    main()
