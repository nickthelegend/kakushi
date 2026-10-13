import json
T1, T3, T4, T5 = "take1.mp4", "take3.mp4", "take4.mp4", "take5.mp4"
R = dict(cap="right", capY=640)
FULLW = dict(tagX=1500, tagY=950, cap="bottom")   # full-width operator pages: tag bottom-right, caption bottom-centre
segs = [
 ("w1", [dict(src=T1, **{"in": 0.0, "out": 15.2}, tag="live-monad", step="Kakushi · the problem")]),
 ("w2", [dict(src=T1, **{"in": 15.2, "out": 22.0}, tag="live-monad", step="Monad finality, live", **R)]),
 ("w3", [dict(src=T1, **{"in": 22.0, "out": 28.7}, speed=2, tag="live-monad", step="Send · stealth", **R),
         dict(src=T1, **{"in": 28.7, "out": 35.5}, tag="live-monad", step="Send · stealth", badges=[{"text": "Receipt in 1.10 s", "sub": "tx 0x8bf5…f051", "from": 1.6}], **R)]),
 ("w4", [dict(src=T3, **{"in": 1.5, "out": 10.2}, tag="live-monad", step="Sign-in · Privy", **R),
         dict(src=T3, **{"in": 10.2, "out": 14.6}, speed=2, tag="live-monad", step="Sign-in · browser wallet", **R)]),
 ("w5", [dict(src=T3, **{"in": 14.6, "out": 27.4}, speed=2, tag="live-sepolia", step="Shield · deposit", **R),
         dict(src=T3, **{"in": 27.4, "out": 47.0}, speed=4, tag="live-sepolia", step="Shield · deposit", badges=[{"text": "Sepolia receipt 16.9 s", "sub": "shown at ×4", "from": 3.0}], **R)]),
 ("w6", [dict(src=T3, **{"in": 47.0, "out": 58.7}, speed=2, tag="live-sepolia", step="Shield · withdraw", **R),
         dict(src=T3, **{"in": 58.7, "out": 84.0}, speed=4, tag="live-sepolia", step="Shield · proving in the browser", **R),
         dict(src=T3, **{"in": 84.0, "out": 89.0}, tag="live-sepolia", step="Shield · gasless via relayer", badges=[{"text": "Proof made in 7.3 s", "sub": "relayer fee 0.0001 ETH (10%)"}], **R)]),
 ("w7", [dict(src=T4, **{"in": 3.0, "out": 21.0}, speed=1.5, tag="live-monad", step="Shield · any token, private calls", **R)]),
 ("w8", [dict(src=T3, **{"in": 120.4, "out": 139.4}, speed=2, tag="live-both", step="Bridge · deliver privately", **R),
         dict(src=T3, **{"in": 139.4, "out": 145.1}, tag="live-both", step="Bridge · Monad source", badges=[{"text": "3 Monad receipts ≈ 0.7–1.0 s", "sub": "approve, pay, announce", "from": 2.0}], **R)]),
 ("w9", [dict(src=T3, **{"in": 145.1, "out": 146.6}, tag="live-both", step="Bridge · Monad source", tagY=700, cap="bottom"),
         dict(src=T3, **{"in": 146.6, "out": 160.4}, speed=4, tag="live-both", step="Bridge · waiting for Maker 1", tagY=700, cap="bottom"),
         dict(src=T3, **{"in": 160.4, "out": 166.4}, tag="live-both", step="Bridge · paid on Sepolia", tagY=700, cap="bottom", badges=[{"text": "0.44955 USDC in 11 s", "sub": "to a one-time stealth address"}])]),
 ("w10", [dict(src=T4, **{"in": 87.0, "out": 101.5}, tag="live-monad", **FULLW)]),
 ("w11", [dict(src=T4, **{"in": 102.5, "out": 109.0}, tag="live-monad", tagX=1000, tagY=810, cap="right", capY=960),
          dict(src=T4, **{"in": 111.4, "out": 128.0}, speed=2, tag="live-monad", **FULLW)]),
 ("w12", [dict(src=T4, **{"in": 128.5, "out": 136.5}, tag="live-both", step="Explorer", cap="right", capY=300)]),
 ("w13", [dict(src=T3, **{"in": 445.2, "out": 449.6}, tag="live-monad", tagX=1500, tagY=118, cap="bottom"),
          dict(src="hold_attest.png", **{"in": 0, "out": 4.0}, tag="live-monad", tagX=1500, tagY=118, cap="bottom")]),
 ("w14", [dict(src=T3, **{"in": 390.0, "out": 399.0}, speed=2, tag="live-monad", step="FHE · make private", **R),
          dict(src=T3, **{"in": 399.0, "out": 408.6}, tag="live-monad", step="FHE · make private, reveal", **R)]),
 ("w15", [dict(src=T3, **{"in": 408.6, "out": 417.8}, speed=2, tag="live-monad", step="FHE · encrypted stealth pay", **R),
          dict(src=T3, **{"in": 417.8, "out": 426.4}, tag="live-monad", step="FHE · encrypted stealth pay", **R)]),
 ("w16", [dict(src=T3, **{"in": 426.4, "out": 434.4}, speed=2, tag="live-monad", step="FHE · KMS cash-out", **R),
          dict(src=T3, **{"in": 434.4, "out": 442.4}, tag="live-monad", step="FHE · KMS cash-out", **R)]),
 ("w17", [dict(src=T3, **{"in": 456.8, "out": 471.6}, tag="live-monad", step="Receive · inbox scan", **R)]),
 ("w18", [dict(src=T5, **{"in": 0.3, "out": 9.0}, tag="live-monad", step="Plugin", compact=True, tagX=1664, tagY=60, cap="bottom")]),
 ("w19", [dict(src=T4, **{"in": 153.5, "out": 173.0}, tag="live-monad", step="Plugin · SDK", compact=True, tagX=1664, tagY=60, cap="bottom")]),
]
clips, vo = [], []
for line, cs in segs:
    vo.append({"id": line, "clip": len(clips), "offset": {"w4": 1.0, "w11": 1.6}.get(line, 0.3)})
    clips += cs
vo.append({"id": "w20", "clip": len(clips) - 1, "offset": 11.9})
T = sum((c["out"] - c["in"]) / c.get("speed", 1) for c in clips)
spec = {"name": "kakushi-walkthrough", "clips": clips, "vo": vo, "music": 0.06, "crf": 23,
        "captionReplace": {"a hundredth of a MON": "0.01 MON", "a thousandth of an ETH": "0.001 ETH", "half a USDC": "0.5 USDC", "point three": "0.3", "Z K": "ZK", "F H E": "FHE", "K M S": "KMS", "a hundred blocks": "100 blocks", "kakushi dot vercel dot app": "kakushi.vercel.app"},
        "texts": [{"text": "kakushi.vercel.app", "from": T - 7.0, "to": T, "y": 880}]}
json.dump(spec, open("spec-walkthrough.json", "w"), indent=1)
print("total", round(T, 2))
