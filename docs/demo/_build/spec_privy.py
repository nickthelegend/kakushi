import json
R = dict(cap="right", capY=640)
TERM = dict(tagX=1250, tagY=880, cap="bottom")
TG1, TG2 = "CLI RUN CAPTURED 05:17 IST · REAL SPEED", "MONAD TESTNET RPC · CAPTURED 05:18 IST"
clips = [
 dict(src="card-bounty-privy.png", **{"in": 0, "out": 3.0}),
 dict(src="take3.mp4", **{"in": 1.5, "out": 10.2}, tag="live-monad", step="App sign-in · Privy", **R),
 dict(src="take3.mp4", **{"in": 10.2, "out": 14.6}, speed=2, tag="live-monad", step="App sign-in · Privy", **R),
 dict(src="privy-term.mp4", **{"in": 0, "out": 9.2}, tag=TG1, **TERM),
 dict(src="hold_pv1.png", **{"in": 0, "out": 13.0}, tag=TG1, tagX=1250, tagY=560, cap="bottom", badges=[{"text": "Allowed: approve landed", "sub": "Refused: transfer out (policy violation)", "from": 0.5}]),
 dict(src="privy-term.mp4", **{"in": 9.2, "out": 14.2}, tag=TG1, **TERM),
 dict(src="hold_pv2.png", **{"in": 0, "out": 11.3}, tag=TG1, **TERM),
 dict(src="privy-tx.mp4", **{"in": 0, "out": 6.0}, tag=TG2, **TERM),
 dict(src="hold_pvtx.png", **{"in": 0, "out": 4.0}, tag=TG2, **TERM),
]
vo = [("v1", 1, 0.3), ("v2", 2, 0.2), ("v3", 3, 6.0), ("v4", 5, 0.3), ("v5", 7, 0.3)]
spec = {"name": "bounty-privy", "clips": clips, "vo": [{"id": a, "clip": b, "offset": c} for a, b, c in vo], "music": 0.06, "crf": 22, "captionReplace": {}}
json.dump(spec, open("spec-bounty-privy.json", "w"), indent=1)
print("total", sum((c["out"] - c["in"]) / c.get("speed", 1) for c in clips))
