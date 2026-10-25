"""Read-only supplement access. Source IDs never cross the catalogue boundary."""
import json
from hashlib import sha256
from pathlib import Path
from .models import HistoricalStatistic

FIELDS={'xg':'expected_goals','xa':'expected_assists','starts':'starts','tackles':'tackles',
        'recoveries':'recoveries','cbi':'clearances_blocks_interceptions'}


def unavailable(reason):
    result={}
    for id in FIELDS:
        for suffix in ('','_per90') if id!='starts' else ('',):
            key=id+suffix
            unit=('xG' if id=='xg' else 'xA' if id=='xa' else 'count')+('/90' if suffix else '')
            result[key]=HistoricalStatistic(value=None,source='none',status='unavailable',unit=unit,reason=reason)
    return result


class AdvancedCatalogRepository:
    def __init__(self,path:Path|None):
        self.path=path.resolve() if path is not None else None
        self._stamp=None
        self.dataset_version=None
        self.players={}
        if self.path is not None and self.path.is_file():
            raw=self.path.read_bytes()
            payload=json.loads(raw)
            if payload.get('format_version')!='advanced-1': raise ValueError('Unsupported advanced dataset')
            self.players=payload['players']
            self.dataset_version='sha256:'+sha256(raw).hexdigest()
            stat=self.path.stat()
            self._stamp=(stat.st_size,stat.st_mtime_ns)

    def _assert_unchanged(self):
        stamp=None
        if self.path is not None and self.path.exists():
            stat=self.path.stat();stamp=(stat.st_size,stat.st_mtime_ns)
        if stamp!=self._stamp: raise ValueError('Advanced dataset changed; restart to use the new version')

    def player_stats(self,player_key):
        self._assert_unchanged()
        if self.dataset_version is None: return unavailable('missing_supplement')
        if not player_key.startswith('fpl:'): return unavailable('source_not_linked')
        data=self.players.get(player_key)
        if data is None: return unavailable('player_not_covered')
        return {id:HistoricalStatistic.model_validate(value) for id,value in data.items()}
