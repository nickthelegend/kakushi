import json
t = {l["id"]: l["start"] for l in json.load(open("work/pitch-timing.json"))["lines"]}
clips = [
 dict(src="pitch-kinetic.mp4", **{"in": 0.0, "out": 37.9}),
 dict(src="take3.mp4", **{"in": 423.6, "out": 427.2}, tag="live-monad", step="Live: encrypted stealth pay", cap="right", capY=640),
 dict(src="pitch-kinetic.mp4", **{"in": 41.5, "out": 80.0}),
]
vo = [{"id": i, "clip": 0, "offset": t[i]} for i in ["h1", "h2", "h3", "h4", "h5"]] + [{"id": i, "clip": 2, "offset": round(t[i] - 41.5, 3)} for i in ["h6", "h7", "h8"]]
spec = {"name": "kakushi-pitch", "clips": clips, "vo": vo, "music": 0.09, "crf": 21,
        "captionReplace": {"forty-four": "44", "four hundred thirty-one": "431", "F H E": "FHE", "Z K": "ZK"}}
json.dump(spec, open("spec-pitch.json", "w"), indent=1)
print("total", sum(c["out"] - c["in"] for c in clips))
