"""Explicit feature admission. Only a credential digest is server-configured."""
from dataclasses import dataclass
from hashlib import sha256
import hmac
import os
from pathlib import Path
import re

WORKER_PATHS=frozenset('/api/ai-worker/'+part for part in ('claim','heartbeat','result'))


@dataclass(frozen=True)
class ChronicleSettings:
    mode: str = 'off'
    worker_id: str = 'timepitch-pc-1'
    token_sha256: str = ''
    acceptance_owner_file: Path | None = None

    def __post_init__(self):
        if self.mode not in ('off','acceptance','public'): raise ValueError('Invalid chronicles mode')
        if not 1<=len(self.worker_id)<=200: raise ValueError('Invalid worker identity')
        if self.mode!='off' and not re.fullmatch('[a-f0-9]{64}',self.token_sha256):
            raise ValueError('Chronicles require a worker credential digest')
        if self.mode=='acceptance' and self.acceptance_owner_file is None:
            raise ValueError('Acceptance mode requires a private owner file')

    @classmethod
    def from_env(cls):
        file=os.getenv('TIMEPITCH_CHRONICLE_ACCEPTANCE_OWNER_FILE','')
        return cls(os.getenv('TIMEPITCH_CHRONICLES_MODE','off'),os.getenv('TIMEPITCH_AI_WORKER_ID','timepitch-pc-1'),
                   os.getenv('TIMEPITCH_AI_WORKER_TOKEN_SHA256',''),Path(file) if file else None)

    def authenticates(self, header):
        if self.mode=='off' or not header or not header.startswith('Bearer '): return False
        token=header[7:]
        return 32<=len(token)<=512 and hmac.compare_digest(sha256(token.encode()).hexdigest(),self.token_sha256)

    def permits_generation(self, owner):
        if self.mode=='public': return True
        if self.mode!='acceptance': return False
        try: allowed=self.acceptance_owner_file.read_text(encoding='utf-8').strip()
        except OSError: return False
        return bool(re.fullmatch('[a-f0-9]{32}',allowed)) and hmac.compare_digest(owner,allowed)
