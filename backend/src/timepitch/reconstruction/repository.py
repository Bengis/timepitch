"""Hash-checked, bounded reads of a sealed offline reconstruction catalogue."""
import hashlib
from pathlib import Path

from .models import ReconstructionCatalog,ReconstructionManifest,ReconstructionSegment


class ReconstructionRepository:
    def __init__(self,dataset_dir: Path):
        self.root=Path(dataset_dir).resolve()
        self.index_path=self.root/'index.json'
        body=self._read(self.index_path,1024**2)
        self.catalog=ReconstructionCatalog.model_validate_json(body)
        self.index_hash=hashlib.sha256(body).hexdigest()
        self.entries={e.match_id:e for e in self.catalog.entries}
        if len(self.entries)!=len(self.catalog.entries):raise ValueError('Duplicate reconstruction identity')
        self.dataset_version=self.catalog.dataset_version

    def _read(self,path,maximum):
        # A replaced symlink must never turn a catalogue lookup into an arbitrary read.
        resolved=path.resolve()
        if not resolved.is_relative_to(self.root) or path.is_symlink() or path.parent.is_symlink():
            raise ValueError('Reconstruction path not contained')
        with path.open('rb') as stream:
            body=stream.read(maximum+1)
        if len(body)>maximum:raise ValueError('Reconstruction artifact too large')
        return body

    def _unchanged(self):
        if hashlib.sha256(self._read(self.index_path,1024**2)).hexdigest()!=self.index_hash:
            raise ValueError('Reconstruction catalogue changed; restart required')

    def get_manifest(self,match_id):
        self._unchanged()
        entry=self.entries.get(match_id)
        if entry is None:raise KeyError(match_id)
        body=self._read(self.root/str(match_id)/'manifest.json',1024**2)
        if len(body)!=entry.manifest_bytes or hashlib.sha256(body).hexdigest()!=entry.manifest_sha256:
            raise ValueError('Reconstruction manifest corrupt')
        result=ReconstructionManifest.model_validate_json(body)
        if result.match_id!=match_id or result.dataset_version!=self.dataset_version:
            raise ValueError('Reconstruction source mismatch')
        keys=[(s.period,s.index) for s in result.segments]
        if len(keys)!=len(set(keys)):raise ValueError('Duplicate reconstruction segment')
        self._unchanged()
        return result

    def get_segment(self,match_id,period,index):
        if not 1<=period<=4 or index<0:raise ValueError('Invalid reconstruction query')
        manifest=self.get_manifest(match_id)
        ref=next((s for s in manifest.segments if s.period==period and s.index==index),None)
        if ref is None:raise KeyError((period,index))
        body=self._read(self.root/str(match_id)/f'{period}-{index}.json',4*1024**2)
        if len(body)!=ref.bytes or hashlib.sha256(body).hexdigest()!=ref.sha256:
            raise ValueError('Reconstruction segment corrupt')
        result=ReconstructionSegment.model_validate_json(body)
        if (result.reconstruction_id!=manifest.reconstruction_id or result.match_id!=match_id or
                result.period!=period or result.index!=index or result.from_ms!=ref.from_ms or result.to_ms!=ref.to_ms):
            raise ValueError('Reconstruction segment identity mismatch')
        self._unchanged()
        return result
