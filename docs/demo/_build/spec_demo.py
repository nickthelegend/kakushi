import json
T1, T3, T5 = "take1.mp4", "take3.mp4", "take5.mp4"
R = dict(cap="right", capY=640)
clips = [
 dict(src=T1, **{"in": 0.0, "out": 15.2}, tag="live-monad", step="The problem · Kakushi landing"),
 dict(src=T1, **{"in": 15.2, "out": 21.8}, tag="live-monad", step="Monad finality, read live", **R),
 dict(src=T1, **{"in": 22.0, "out": 28.7}, speed=2, tag="live-monad", step="1 · Stealth send", **R),
 dict(src=T1, **{"in": 28.7, "out": 35.5}, tag="live-monad", step="1 · Stealth send", badges=[{"text": "Receipt in 1.10 s", "sub": "0.01 MON · tx 0x8bf5…f051", "from": 1.6}], **R),
 dict(src=T3, **{"in": 1.5, "out": 10.2}, tag="live-monad", step="Sign-in · Privy", **R),
 dict(src=T3, **{"in": 10.2, "out": 14.6}, speed=2, tag="live-monad", step="Sign-in · browser wallet", **R),
 dict(src=T3, **{"in": 14.6, "out": 27.4}, speed=2, tag="live-sepolia", step="2 · Shield on Sepolia", **R),
 dict(src=T3, **{"in": 27.4, "out": 47.0}, speed=4, tag="live-sepolia", step="2 · Shield: deposit", badges=[{"text": "Sepolia receipt 16.9 s", "sub": "shown at ×4", "from": 3.2}], **R),
 dict(src=T3, **{"in": 47.0, "out": 58.7}, speed=2, tag="live-sepolia", step="2 · Withdraw to a fresh address", **R),
 dict(src=T3, **{"in": 58.7, "out": 84.0}, speed=4, tag="live-sepolia", step="2 · Proving in the browser", **R),
 dict(src=T3, **{"in": 84.0, "out": 88.6}, tag="live-sepolia", step="2 · Gasless via the relayer", badges=[{"text": "Proof made in 7.3 s", "sub": "relayer fee 0.0001 ETH (10%)"}], **R),
 dict(src=T3, **{"in": 120.4, "out": 139.4}, speed=2, tag="live-both", step="3 · Bridge, delivered privately", **R),
 dict(src=T3, **{"in": 139.4, "out": 145.1}, tag="live-both", step="3 · Bridge: Monad source", badges=[{"text": "3 Monad receipts ≈ 0.7–1.0 s", "sub": "approve, pay, announce", "from": 2.0}], **R),
 dict(src=T3, **{"in": 145.1, "out": 146.6}, tag="live-both", step="3 · Bridge: Monad source", tagY=700, cap="bottom"),
 dict(src=T3, **{"in": 146.6, "out": 160.4}, speed=4, tag="live-both", step="3 · Waiting for Maker 1", tagY=700, cap="bottom"),
 dict(src=T3, **{"in": 160.4, "out": 166.4}, tag="live-both", step="3 · Paid on Sepolia", tagY=700, badges=[{"text": "0.44955 USDC in 11 s", "sub": "to a one-time stealth address"}]),
 dict(src=T3, **{"in": 390.0, "out": 399.0}, speed=2, tag="live-monad", step="4 · Confidential (FHE)", **R),
 dict(src=T3, **{"in": 399.0, "out": 408.6}, tag="live-monad", step="4 · Make private, reveal", **R),
 dict(src=T3, **{"in": 408.6, "out": 417.8}, speed=2, tag="live-monad", step="4 · Encrypted stealth pay", **R),
 dict(src=T3, **{"in": 417.8, "out": 426.4}, tag="live-monad", step="4 · Encrypted stealth pay", **R),
 dict(src=T3, **{"in": 426.4, "out": 434.4}, speed=2, tag="live-monad", step="4 · KMS cash-out", **R),
 dict(src=T3, **{"in": 434.4, "out": 442.4}, tag="live-monad", step="4 · KMS cash-out", **R),
 dict(src=T3, **{"in": 445.2, "out": 449.6}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
 dict(src="hold_attest.png", **{"in": 0, "out": 4.0}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
 dict(src=T3, **{"in": 456.8, "out": 471.6}, tag="live-monad", step="6 · Receive: inbox scan", **R),
 dict(src=T5, **{"in": 0.3, "out": 13.6}, tag="live-monad", step="7 · Plugin", compact=True, tagX=1664, tagY=60, cap="bottom"),
]
vo = [("p1",0,0.2),("p2",1,0.4),("p3",2,0.9),("p4",4,0.9),("p5",6,0.2),("p6",8,0.2),("p7",11,0.2),("p8",16,0.2),("p9",18,0.2),("p10",20,0.2),("p11",22,0.4),("p12",24,0.3),("p14",25,0.3),("p15",25,6.6)]
spec = {"name": "kakushi-demo", "clips": clips, "vo": [{"id": a, "clip": b, "offset": c} for a, b, c in vo], "music": 0.06, "crf": 22,
        "captionReplace": {"a hundredth of a MON": "0.01 MON", "a thousandth of an ETH": "0.001 ETH", "point three": "0.3", "Z K": "ZK", "F H E": "FHE", "a hundred blocks": "100 blocks"},
        "texts": []}
T = sum((c["out"] - c["in"]) / c.get("speed", 1) for c in clips)
spec["texts"] = [{"text": "kakushi.vercel.app", "from": T - 5.2, "to": T, "y": 880}]
json.dump(spec, open("spec-demo.json", "w"), indent=1)
t = sum((c["out"] - c["in"]) / c.get("speed", 1) for c in clips); print("total", round(t, 2))
