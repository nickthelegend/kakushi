import json
R = dict(cap="right", capY=640)
clips = [
 dict(src="take1.mp4", **{"in": 6.0, "out": 10.0}, tag="live-monad"),
 dict(src="take1.mp4", **{"in": 29.6, "out": 32.6}, tag="live-monad", step="Stealth send", badges=[{"text": "Receipt in 1.10 s"}], **R),
 dict(src="take3.mp4", **{"in": 84.0, "out": 87.0}, tag="live-sepolia", step="Gasless ZK withdraw", **R),
 dict(src="take3.mp4", **{"in": 160.4, "out": 163.4}, tag="live-both", step="Private bridge payout", tagY=700, **R),
 dict(src="take3.mp4", **{"in": 407.6, "out": 410.4}, tag="live-monad", step="Encrypted balance", **R),
 dict(src="take3.mp4", **{"in": 424.3, "out": 427.3}, tag="live-monad", step="Encrypted stealth pay", **R),
 dict(src="take5.mp4", **{"in": 1.0, "out": 6.4}, tag="live-monad", step="Plugin", compact=True, tagX=1664, tagY=60, cap="bottom"),
]
vo = [("r1",0,0.3),("r2",1,0.4),("r3",3,0.3),("r4",6,0.4)]
T = sum(c["out"] - c["in"] for c in clips)
spec = {"name": "kakushi-promo", "clips": clips, "vo": [{"id": a, "clip": b, "offset": c} for a, b, c in vo], "music": 0.12, "crf": 21,
        "texts": [{"text": "kakushi.vercel.app", "from": T - 4.6, "to": T, "y": 880}]}
json.dump(spec, open("spec-promo.json", "w"), indent=1); print("total", T)
