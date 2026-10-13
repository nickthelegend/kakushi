import json
R = dict(cap="right", capY=640)
TERM = dict(tagX=1250, tagY=880, cap="bottom")
clips = [
 dict(src="card-bounty-cre.png", **{"in": 0, "out": 3.0}),
 dict(src="take3.mp4", **{"in": 146.6, "out": 160.4}, speed=4, tag="live-both", step="Bridge payout · waiting", tagY=700, cap="bottom"),
 dict(src="take3.mp4", **{"in": 160.4, "out": 166.4}, tag="live-both", step="Bridge payout · settled", tagY=700, cap="bottom"),
 dict(src="take3.mp4", **{"in": 445.2, "out": 449.6}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
 dict(src="hold_attest.png", **{"in": 0, "out": 2.2}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
 dict(src="cre-term.mp4", **{"in": 0, "out": 18.7}, tag="CLI RUN CAPTURED 04:54 IST · REAL SPEED", **TERM),
 dict(src="hold_creterm.png", **{"in": 0, "out": 15.6}, tag="CLI RUN CAPTURED 04:54 IST · REAL SPEED", **TERM),
 dict(src="cast-term.mp4", **{"in": 0, "out": 8.4}, tag="MONAD TESTNET RPC · CAPTURED 05:02 IST", **TERM),
 dict(src="hold_castterm.png", **{"in": 0, "out": 10.8}, tag="MONAD TESTNET RPC · CAPTURED 05:02 IST", **TERM),
 dict(src="take3.mp4", **{"in": 445.2, "out": 449.6}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
 dict(src="hold_attest.png", **{"in": 0, "out": 6.6}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
]
vo = [("c1", 1, 0.3), ("c2", 5, 2.6), ("c3", 6, 2.4), ("c4", 7, 0.3), ("c5", 8, 0.4), ("c6", 9, 0.4)]
spec = {"name": "bounty-cre", "clips": clips, "vo": [{"id": a, "clip": b, "offset": c} for a, b, c in vo], "music": 0.06, "crf": 22,
        "captionReplace": {}}
json.dump(spec, open("spec-bounty-cre.json", "w"), indent=1)
print("total", sum((c["out"] - c["in"]) / c.get("speed", 1) for c in clips))
