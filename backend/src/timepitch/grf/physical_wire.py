"""Portable physical replay wire constants, also used by Python 3.10."""
import hashlib
import json
import struct

MAX_SAMPLES=75001
MAX_EVENTS=100000
MAX_CHUNK_SAMPLES=1000
MAX_COMPRESSED=1024*1024
MAX_EXPANDED=4*1024*1024
MAX_TOTAL_COMPRESSED=32*1024*1024
MAX_TOTAL_EXPANDED=256*1024*1024
MAX_MANIFEST=1024*1024
MAX_STDOUT=48*1024*1024
MAX_PHYSICS_MS=7440000
CAUSES=('none','normal','kickoff','goal','corner','goal_kick','throw_in','free_kick','penalty')
COLUMNS=('index','physics_ms','period','period_elapsed_ms','effective_ms','in_play','set_piece',
    'discontinuity','restart_id','restart_active','restart_cause','restart_start_ms','pending_penalty',
    'owner_team','owner_slot','home_score','away_score','home_attack','away_attack','relocation_id','game_mode')+tuple(
    f'{side}_{slot}_{name}' for side in ('home','away') for slot in range(11)
    for name in ('x_m','y_m','vx_m_s','vy_m_s','active','fatigue'))+('ball_x_m','ball_y_m','ball_z_m')


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')


def digest(value):return hashlib.sha256(canonical(value)).hexdigest()


def pack_samples(block):
    """Lossless IEEE754 columns. Each uint32 word is exactly representable in JSON."""
    data=dict(block);rows=data.pop('samples');columns=[]
    if not rows or any(len(row)!=len(COLUMNS) for row in rows):raise ValueError('Invalid logical sample width')
    for col in zip(*rows):
        previous=0;words=[]
        for value in col:
            bits=struct.unpack('<Q',struct.pack('<d',value))[0]
            delta=bits^previous;previous=bits;words.extend((delta>>32,delta&0xffffffff))
        columns.append(words)
    data.update(encoding='float64-xor32-1',sample_xor32=columns)
    return data


def unpack_samples(data):
    data=dict(data)
    if data.pop('encoding',None)!='float64-xor32-1' or 'samples' in data:raise ValueError('Unknown physical encoding')
    columns=data.pop('sample_xor32',None)
    if not isinstance(columns,list) or len(columns)!=len(COLUMNS):raise ValueError('Invalid encoded column count')
    count=len(columns[0])
    if not 2<=count<=MAX_CHUNK_SAMPLES*2 or count%2:raise ValueError('Invalid encoded sample count')
    decoded=[]
    for column in columns:
        if not isinstance(column,list) or len(column)!=count:raise ValueError('Unequal encoded columns')
        previous=0;values=[]
        for high,low in zip(column[::2],column[1::2]):
            if type(high) is not int or type(low) is not int or not (0<=high<=0xffffffff and 0<=low<=0xffffffff):
                raise ValueError('Invalid float64 word')
            bits=previous^((high<<32)|low);previous=bits
            values.append(struct.unpack('<d',struct.pack('<Q',bits))[0])
        decoded.append(values)
    data['samples']=list(map(list,zip(*decoded)))
    return data
