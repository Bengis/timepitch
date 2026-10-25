"""Server-owned feature configuration, never a grant or credential loader."""
from dataclasses import dataclass
import hmac
import os
from pathlib import Path
import re
from .models import AzureBinding


@dataclass(frozen=True)
class AzureSettings:
    mode: str = 'off'
    binding: AzureBinding | None = None
    acceptance_owner_file: Path | None = None
    credential_file: Path | None = None

    def __post_init__(self):
        if self.mode not in ('off','acceptance','public'):
            raise ValueError('Invalid Azure chronicle mode')
        if self.mode!='off' and self.binding is None:
            raise ValueError('Azure chronicles require a fixed binding')
        if self.mode=='acceptance' and self.acceptance_owner_file is None:
            raise ValueError('Acceptance requires a private owner file')

    @classmethod
    def from_env(cls):
        mode=os.getenv('TIMEPITCH_AZURE_CHRONICLES_MODE','off')
        file=os.getenv('TIMEPITCH_AZURE_CHRONICLE_BINDING_FILE','')
        binding=None
        if file:
            raw=Path(file).read_bytes()
            if len(raw)>16384: raise ValueError('Binding configuration exceeds limit')
            binding=AzureBinding.model_validate_json(raw)
        owner=os.getenv('TIMEPITCH_AZURE_CHRONICLE_OWNER_FILE','')
        credential=os.getenv('TIMEPITCH_AZURE_CHRONICLE_CREDENTIAL_FILE','')
        return cls(mode,binding,Path(owner) if owner else None,Path(credential) if credential else None)

    def permits_generation(self, owner):
        if self.mode=='public': return True
        if self.mode!='acceptance': return False
        try:
            raw=self.acceptance_owner_file.read_bytes()
            if len(raw)>200: return False
            allowed=raw.decode('utf-8').strip()
        except (OSError,UnicodeError): return False
        return bool(re.fullmatch(r'[a-f0-9]{32}',allowed)) and hmac.compare_digest(owner,allowed)
