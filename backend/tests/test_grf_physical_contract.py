import json
import zlib
import struct
import pytest
from timepitch.grf.physical_codec import encode_chunk,decode_chunk,canonical,make_chunk_ref
from timepitch.grf.physical_models import PhysicalChunk
from grf_physical_fixtures import chunk,row
from grf_physical_fixtures import write_match,iter_fixture
from timepitch.grf.physical_codec import validate_manifest,manifest_hash
from timepitch.grf.physical_wire import pack_samples


@pytest.fixture(scope='module')
def complete_match(tmp_path_factory):
    directory=tmp_path_factory.mktemp('contract');return directory,write_match(directory)


@pytest.mark.parametrize('change',['sha','input','missing','duplicate','clock','totals'])
def test_whole_stream_integrity_and_clock_policy_are_checked(complete_match,change):
    directory,original=complete_match;manifest=original.model_copy(deep=True)
    if change=='sha':manifest.chunks[0].sha256='f'*64
    if change=='input':manifest.input.config.seed+=1
    if change=='totals':manifest.chunks[0].expanded_bytes+=1
    manifest.trace_hash=manifest_hash(manifest)
    def chunks():
        for block in iter_fixture(directory,manifest):
            if change=='missing' and block.index==2:continue
            if change=='clock' and block.index==1:block.samples[0][1]-=100
            yield block
            if change=='duplicate' and block.index==2:yield block
    with pytest.raises(ValueError):validate_manifest(manifest,chunks(),original.input)


@pytest.mark.parametrize('budget',['MAX_TOTAL_COMPRESSED','MAX_TOTAL_EXPANDED'])
def test_total_stream_budget_is_enforced(complete_match,monkeypatch,budget):
    monkeypatch.setattr('timepitch.grf.physical_codec.'+budget,1)
    directory,manifest=complete_match
    with pytest.raises(ValueError,match='exceeds budget'):validate_manifest(manifest,iter_fixture(directory,manifest))


def test_chunk_round_trip_and_canonical_digest():
    value=chunk();raw=encode_chunk(value)
    assert decode_chunk(raw)==value
    assert len(make_chunk_ref(value,raw).sha256)==64
    assert canonical({'b':1,'a':2})==b'{"a":2,"b":1}'


def test_wire_uses_lossless_float64_xor_words_and_preserves_signed_zero():
    block=chunk();block.samples[0][21]=-0.0;block.samples[1][21]=.12345678901234567
    raw=encode_chunk(block);wire=json.loads(zlib.decompress(raw))
    assert wire['encoding']=='float64-xor32-1' and 'samples' not in wire
    decoded=decode_chunk(raw)
    assert [struct.pack('<d',r[21]) for r in decoded.samples]==[struct.pack('<d',r[21]) for r in block.samples]


@pytest.mark.parametrize('mutation',[
    lambda d:d['samples'][0].__setitem__(17,0),
    lambda d:d['samples'][1].__setitem__(1,-1),
    lambda d:d['samples'][0].__setitem__(21,float('nan')),
    lambda d:d['samples'][0].append(0),
    lambda d:d['samples'].reverse(),
])
def test_bad_chunk_rows_are_rejected(mutation):
    data=chunk().model_dump();mutation(data)
    with pytest.raises(ValueError):
        decode_chunk(zlib.compress(canonical(pack_samples(data))))


@pytest.mark.parametrize('change',['overflow','odd','unequal','unknown'])
def test_malformed_float64_columns_are_rejected(change):
    wire=pack_samples(chunk().model_dump(mode='json'))
    if change=='overflow':wire['sample_xor32'][0][0]=2**32
    if change=='odd':wire['sample_xor32'][0].pop()
    if change=='unequal':wire['sample_xor32'][1].clear()
    if change=='unknown':wire['encoding']='unknown'
    with pytest.raises(ValueError):decode_chunk(zlib.compress(canonical(wire)))


@pytest.mark.parametrize('raw',[b'bad',zlib.compress(b'{'),zlib.compress(b' '* (4*1024*1024+1)),
    zlib.compress(b'{}')+b'trailing',zlib.compress(b'{}')[:-1]])
def test_bounded_decode_rejects_expansion_truncation_and_trailing_data(raw):
    with pytest.raises(ValueError):decode_chunk(raw)
