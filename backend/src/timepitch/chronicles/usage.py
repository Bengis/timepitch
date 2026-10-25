"""Accounting helpers shared by old explanations and the distributed broker."""
import json


def has_table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def reserved_chronicles(conn, owner, match_id, revision, locale):
    if not has_table(conn, 'chronicle_usage'): return 0
    return conn.execute('''SELECT COALESCE(SUM(reserved),0) FROM chronicle_usage
        WHERE owner=? AND engine='timepitch' AND match_id=? AND revision=? AND locale=?''',
        (owner, match_id, revision, locale)).fetchone()[0]


def legacy_usage(conn, owner, match_id, revision, locale):
    if not has_table(conn, 'explanations'): return 0, 0
    total = final = 0
    for row in conn.execute('SELECT body FROM explanations WHERE owner=? AND match_id=? AND revision=? AND locale=?',
                            (owner, match_id, revision, locale)):
        body = json.loads(row[0]); calls = body.get('calls_reserved', 0)
        if type(calls) is not int or not 0 <= calls <= 12: raise ValueError('Invalid legacy usage')
        total += calls
        if body['window']['id'] == 'fulltime': final += calls
    return total, final
