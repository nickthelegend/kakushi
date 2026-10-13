import json
R = dict(cap="right", capY=640)
clips = [
 dict(src="card-bounty-envio.png", **{"in": 0, "out": 3.0}),
 dict(src="take3.mp4", **{"in": 456.8, "out": 470.3}, tag="live-monad", step="Before: RPC-only scan (03:20 IST)", **R),
 dict(src="take7.mp4", **{"in": 0.0, "out": 7.8}, speed=2, tag="live-monad", step="Now: Envio HyperSync", **R),
 dict(src="take7.mp4", **{"in": 7.8, "out": 12.0}, tag="live-monad", step="Now: Envio HyperSync", badges=[{"text": "Scan finished in 2.3 s", "sub": "290k+ blocks of history", "from": 2.3}], **R),
 dict(src="take7.mp4", **{"in": 12.0, "out": 24.4}, tag="live-both", step="Inbox: 3 payments found", **R),
 dict(src="hold_inbox.png", **{"in": 0, "out": 7.0}, tag="live-both", step="Inbox: 3 payments found", **R),
 dict(src="take7.mp4", **{"in": 24.4, "out": 33.0}, tag="live-web", step="/api/announcements · raw JSON", tagY=150, cap="bottom", capY=60, badges=[{"text": "\"source\": \"envio-hypersync\"", "sub": "last line of the response", "from": 1.0}]),
 dict(src="hold_json.png", **{"in": 0, "out": 4.0}, tag="live-web", step="Same response, last lines zoomed", tagY=150, cap="bottom", capY=60, badges=[{"text": "\"source\": \"envio-hypersync\"", "sub": "last line of the response"}]),
]
vo = [("e1", 1, 0.3), ("e2", 2, 0.2), ("e3", 4, 3.0), ("e4", 6, 0.3)]
spec = {"name": "bounty-envio", "clips": clips, "vo": [{"id": a, "clip": b, "offset": c} for a, b, c in vo], "music": 0.06, "crf": 22,
        "captionReplace": {"a hundred blocks": "100 blocks", "point three c USDC": "0.3 cUSDC", "zero point four four nine five five USDC": "0.44955 USDC", "hundredth of a MON": "0.01 MON"}}
json.dump(spec, open("spec-bounty-envio.json", "w"), indent=1)
print("total", sum((c["out"] - c["in"]) / c.get("speed", 1) for c in clips))
