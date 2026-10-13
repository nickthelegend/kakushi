#!/usr/bin/env python3
"""ElevenLabs narration, one file per line, with character timestamps (for captions).
Cached by (voice, model, text): re-running only voices lines that changed.
Usage: python3 tts.py script.json            -> work/vo/<id>.mp3 + work/vo/<id>.json, work/vo/lines.json
       python3 tts.py --audition VOICE_ID "text" name
The key is read from metropolis-funding/keys/api-keys.env and never printed."""
import base64, hashlib, json, os, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
VO = os.path.join(HERE, "work", "vo"); os.makedirs(VO, exist_ok=True)
KEYF = "/Volumes/Extreme SSD/Projects/metropolis-funding/keys/api-keys.env"
KEY = next(l.split("=", 1)[1].strip().strip('"') for l in open(KEYF) if l.startswith("ELEVENLABS_API_KEY="))
MODEL = "eleven_multilingual_v2"

def synth(voice, text, out, settings=None):
    body = {"text": text, "model_id": MODEL,
            "voice_settings": settings or {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True, "speed": 1.0}}
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128",
                                 data=json.dumps(body).encode(), headers={"xi-api-key": KEY, "content-type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    open(out + ".mp3", "wb").write(base64.b64decode(d["audio_base64"]))
    json.dump(d.get("normalized_alignment") or d["alignment"], open(out + ".json", "w"))

if sys.argv[1] == "--audition":
    synth(sys.argv[2], sys.argv[3], os.path.join(VO, "audition_" + sys.argv[4])); sys.exit()

spec = json.load(open(sys.argv[1]))
voice = spec["voice"]
lines, chars = [], 0
for ln in spec["lines"]:
    say = ln.get("say", ln["text"])
    h = hashlib.sha1(f"{voice}|{MODEL}|{say}".encode()).hexdigest()[:10]
    base = os.path.join(VO, f"{ln['id']}_{h}")
    if not os.path.exists(base + ".mp3"):
        synth(voice, say, base); chars += len(say)
        print("voiced", ln["id"], len(say), "chars", flush=True)
    lines.append({**ln, "say": say, "file": base + ".mp3", "align": base + ".json"})
json.dump(lines, open(os.path.join(VO, "lines.json"), "w"), indent=2)
print("characters billed this run:", chars, " total script:", sum(len(l["say"]) for l in lines))
