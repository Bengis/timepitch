"""Bounded worker wire encoding; standalone Python 3.10 and stdlib only."""
import json
from typing import TextIO

MAX_BYTES = 16*1024*1024


def encode_native_result(result: dict) -> str:
    # Wire order/ASCII escaping differ from the canonical replay codec.
    text = json.dumps(result, separators=(',', ':'), ensure_ascii=True,
                      allow_nan=False, sort_keys=False)
    if len(text) > MAX_BYTES:
        raise ValueError('GRF output exceeds size budget')
    return text


def write_native_json(text: str, stream: TextIO) -> None:
    if stream.write(text) != len(text):
        raise OSError('Incomplete GRF JSON write')
    stream.flush()
