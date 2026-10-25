"""Statistics queries authorize the stored replay before any reduction."""
from .queries import statistics_until
from ..simulation.replay_models import MatchRecordV2


class StatisticsService:
    def __init__(self,repository): self.repository=repository

    def get(self,match_id,owner,end_ms):
        if type(end_ms) is not int or not 0<=end_ms<=5400000: raise ValueError('Invalid statistics window')
        record=self.repository.get_record(match_id,owner)
        end_ms=end_ms//250*250
        if end_ms==5400000 and isinstance(record,MatchRecordV2) and record.statistics is not None:
            return record.statistics
        return statistics_until(record,end_ms)
