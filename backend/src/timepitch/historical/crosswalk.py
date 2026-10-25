"""Explicit, reviewed source identities. Never resolve clubs or players by names."""
from collections import Counter
import hashlib
import json
from pathlib import Path

from pydantic import Field,model_validator
from .models import HistoricalModel,HistoricalMatch,FormationChange,MatchupTeam,MatchupPrefill,PINNED_SNAPSHOT


class ClubCrosswalk(HistoricalModel):
    clubs: dict[str,str]
    # Per catalog team-season, source player -> catalog player. Empty in the shipped map.
    players: dict[str,dict[str,str]] = Field(default_factory=dict)

    @model_validator(mode='after')
    def one_to_one(self):
        if len(set(self.clubs.values()))!=len(self.clubs):raise ValueError('Ambiguous club identities')
        for values in self.players.values():
            if len(set(values.values()))!=len(values):raise ValueError('Ambiguous player identities')
        return self

    @property
    def version(self):
        return 'sha256:'+hashlib.sha256(self.model_dump_json().encode()).hexdigest()


def load_crosswalk(path:Path)->ClubCrosswalk:
    raw=path.read_bytes()
    if len(raw)>128*1024:raise ValueError('Crosswalk too large')
    data=json.loads(raw)
    if data['snapshot']!=PINNED_SNAPSHOT:raise ValueError('Wrong source snapshot')
    entries=data['clubs']
    keys=[row['source_key'] for row in entries]
    if len(set(keys))!=len(keys):raise ValueError('Repeated source club')
    return ClubCrosswalk(clubs={row['source_key']:row['catalog_club'] for row in entries})


def resolve_matchup(match:HistoricalMatch,catalog,crosswalk:ClubCrosswalk,*,starting_formations:list[FormationChange]|None=None)->MatchupPrefill:
    season={27:2015,44:2003}[match.season_id]
    def side(team):
        differences=[];club=crosswalk.clubs.get(team.key);key=f'{club}:{season}' if club else None
        try:resolved=catalog.get_team(key) if key else None
        except KeyError:resolved=None
        if resolved is None:differences.append('unmapped_club_season');key=None
        starts=[f for f in starting_formations or [] if f.team_key==team.key and f.at.period==1 and f.at.period_ms==0]
        start=starts[0] if len(starts)==1 else None
        formation='-'.join(str(start.formation)) if start and start.formation else None
        source_players=start.player_keys if start else []
        supported=list(resolved.available_formations) if resolved else []
        if formation is None:differences.append('source_formation_unavailable')
        elif formation not in supported:differences.append('unsupported_source_formation')
        mapping=crosswalk.players.get(key,{}) if key else {}
        mapped=[mapping.get(player) for player in source_players]
        exact=len(source_players)==11 and len(set(source_players))==11 and all(mapped) and len(set(mapped))==11
        roster={p.key:p for p in resolved.players} if resolved else {}
        exact=bool(exact and all(key in roster for key in mapped))
        if not exact:differences.append('unverified_player_identities')
        elif formation in supported:
            roles=['GK']+['DEF']*int(formation[0])+['MID']*int(formation[2])+['FWD']*int(formation[4])
            if Counter(roster[key].role for key in mapped)!=Counter(roles):
                differences.append('mapped_roles_incompatible');exact=False
            else:
                remaining=list(mapped);ordered=[]
                for role in roles:
                    player=next(key for key in remaining if roster[key].role==role);remaining.remove(player);ordered.append(player)
                mapped=ordered
        return MatchupTeam(source_team_key=team.key,catalog_key=key,source_formation=formation,source_players=source_players,
            player_keys=mapped if exact and formation in supported else None,supported_formations=supported,differences=differences)
    home,away=side(match.home_team),side(match.away_team)
    return MatchupPrefill(historical_match_id=match.id,catalog_dataset_version=catalog.dataset_version,crosswalk_version=crosswalk.version,
        available=bool(home.catalog_key and away.catalog_key),exact_xi_available=home.player_keys is not None and away.player_keys is not None,
        home=home,away=away)
