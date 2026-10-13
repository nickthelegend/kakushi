"""Character alignment -> word timings. words(align_json_path) -> [(word, start, end)]"""
import json
def words(path):
    a = json.load(open(path))
    ch, st, en = a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]
    out, cur, s0 = [], "", None
    for c, s, e in zip(ch, st, en):
        if c.isspace():
            if cur: out.append((cur, s0, last)); cur = ""
            continue
        if not cur: s0 = s
        cur += c; last = e
    if cur: out.append((cur, s0, last))
    return out
