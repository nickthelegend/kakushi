#!/usr/bin/env python3
"""Cut, caption and mix one Kakushi video (1920x1080, H.264 + AAC, -16 LUFS) from an edit spec.

Adapted from clockin/videos/_pipeline (tts -> timeline -> base -> overlay -> assemble) for landscape web capture:
- footage fills the frame (captures are 1536x864 CSS at DPR 1.25 = exactly 1920x1080);
- a clip may be sped up ("speed": 4) and then carries a "⏩ ×4" chip; key moments stay at ×1;
- the overlay (opaque captions, LIVE tags, step chips, timing badges, speed chips) is drawn with PIL as a sequence of
  transparent PNG states and laid over the bed in one ffmpeg pass;
- narration lines (ElevenLabs, tts.py) are placed on clip anchors; captions come from their word timestamps.

Spec (JSON): {"name": "kakushi-demo", "clips": [{"src": "take1.mp4" | "card.png", "in": s, "out": s, "speed": 1,
  "tag": "live-monad"|"live-sepolia"|"live-both"|null, "step": "…", "badges": [{"text","sub","from","to"}], "capY": 1000}],
  "vo": [{"id": "d1", "clip": 0, "offset": 0.3}], "captionReplace": {"say words": "shown"}, "music": 0.07}
Usage: python3 cut.py spec.json [--skip-base]   -> work/<name>.mp4 + work/<name>.srt
"""
import json, os, re, subprocess, sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from words import words

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, "work")
FPS = 30
VW, VH = 1920, 1080
spec = json.load(open(sys.argv[1]))
NAME = spec["name"]
WD = os.path.join(W, NAME); os.makedirs(WD, exist_ok=True)
LINES = {l["id"]: l for l in json.load(open(os.path.join(W, "vo", "lines.json")))}
FONT = lambda n, s: ImageFont.truetype(os.path.join(HERE, "fonts", n), s)
GOLD = (242, 194, 122)


def run(cmd):
    subprocess.run(cmd, check=True)


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)


# ── timeline ────────────────────────────────────────────────────────────────
clips, t = [], 0.0
for c in spec["clips"]:
    sp = c.get("speed", 1)
    d = round((c["out"] - c["in"]) / sp * FPS) / FPS
    clips.append({**c, "speed": sp, "start": t, "end": t + d, "dur": d})
    t += d
TOTAL = t

vo = []
for a in spec["vo"]:
    st = a["at"] if "at" in a else clips[a["clip"]]["start"] + a.get("offset", 0.3)
    vo.append((a["id"], st))
vo.sort(key=lambda x: x[1])
for (a, sa), (b, sb) in zip(vo, vo[1:]):
    ea = sa + dur(LINES[a]["file"])
    if ea + 0.12 > sb:
        print(f"WARNING overlap: {a} ends {ea:.2f} > {b} starts {sb:.2f}")
last_end = vo[-1][1] + dur(LINES[vo[-1][0]]["file"])
if last_end > TOTAL:
    print(f"WARNING: narration ends {last_end:.2f} after the cut {TOTAL:.2f}")

# ── captions from word timestamps ───────────────────────────────────────────
REPL = spec.get("captionReplace", {})
norm_ = lambda x: re.sub(r"[^\w\s-]", "", x).lower()
cues = []
for lid, st in vo:
    ws = words(LINES[lid]["align"])
    toks, i = [], 0
    while i < len(ws):
        hit = None
        for say, show in REPL.items():
            n = len(say.split())
            grp = ws[i:i + n]
            if len(grp) == n and norm_(" ".join(w for w, _, _ in grp)) == norm_(say):
                punct = re.search(r"[.,:;!?]+$", grp[-1][0])
                hit = (show + (punct.group(0) if punct else ""), grp[0][1], grp[-1][2], n)
                break
        if hit:
            toks.append(hit[:3]); i += hit[3]
        else:
            toks.append(ws[i]); i += 1
    cur = []

    def flush():
        if cur:
            cues.append({"text": " ".join(x[0] for x in cur), "start": st + cur[0][1], "end": st + cur[-1][2]})
    for tok in toks:
        if cur and len(" ".join(x[0] for x in cur + [tok])) > 60:
            # prefer to break after the last comma, so a cue never starts with a stranded word
            k = max((i for i, x in enumerate(cur[:-1]) if x[0].endswith(",") and i >= 2), default=None)
            if k is not None:
                rest = cur[k + 1:]; cur = cur[:k + 1]; flush(); cur = rest
            else:
                flush(); cur = []
        cur.append(tok)
        if re.search(r"[.?!:;]$", tok[0]) and len(" ".join(x[0] for x in cur)) > 16:
            flush(); cur = []
    flush()
    # never leave a one-word tail on its own: fold it into the cue before (same line)
    if len(cues) >= 2 and len(cues[-1]["text"]) < 14 and cues[-2]["start"] >= st and len(cues[-2]["text"]) + len(cues[-1]["text"]) < 80:
        tail = cues.pop()
        cues[-1]["text"] += " " + tail["text"]; cues[-1]["end"] = tail["end"]
for a, b in zip(cues, cues[1:]):
    a["end"] = min(a["end"] + 0.3, b["start"] - 0.04)
cues[-1]["end"] = min(cues[-1]["end"] + 0.5, TOTAL)


def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


with open(os.path.join(W, NAME + ".srt"), "w") as f:
    for n, c in enumerate(cues, 1):
        f.write(f"{n}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n\n")


# ── footage bed ─────────────────────────────────────────────────────────────
def seg(c, dst):
    src = os.path.join(W, c["src"])
    n = round(c["dur"] * FPS)
    common = ["-frames:v", str(n), "-r", str(FPS), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-video_track_timescale", "15360", dst]
    if src.endswith(".png"):
        run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", src, "-vf", f"scale={VW}:{VH},setsar=1,format=yuv420p"] + common)
        return
    vf = f"setpts=(PTS-STARTPTS)/{c['speed']},fps={FPS},scale={VW}:{VH}:flags=lanczos,setsar=1,format=yuv420p"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{c['in']:.3f}", "-t", f"{c['out'] - c['in'] + 0.2:.3f}", "-i", src, "-vf", vf] + common)


if "--skip-base" not in sys.argv:
    parts = []
    for i, c in enumerate(clips):
        p = os.path.join(WD, f"b_{i:02d}.mp4"); seg(c, p); parts.append(p)
        print(f"clip {i:02d} {c['start']:7.2f}-{c['end']:7.2f}  {c['src']} {c['in']:.2f}-{c['out']:.2f} x{c['speed']}  {c.get('step', '')}", flush=True)
    open(os.path.join(WD, "parts.txt"), "w").write("".join(f"file '{p}'\n" for p in parts))
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(WD, "parts.txt"), "-c", "copy", os.path.join(WD, "base.mp4")])

# ── overlay states ──────────────────────────────────────────────────────────
F_CAP = FONT("Satoshi-Medium.ttf", 38)
F_TAG = FONT("Satoshi-Black.ttf", 22)
F_STEP = FONT("Satoshi-Medium.ttf", 24)
F_BADGE = FONT("Satoshi-Black.ttf", 27)
F_BADGE_S = FONT("Satoshi-Medium.ttf", 20)
F_SPEED = FONT("Satoshi-Black.ttf", 26)
F_TAG_S = FONT("Satoshi-Black.ttf", 16)
F_STEP_S = FONT("Satoshi-Medium.ttf", 18)
GREEN = (120, 230, 160)
TAGS = {
    "live-monad": ("LIVE · MONAD TESTNET", GREEN),
    "live-sepolia": ("LIVE · SEPOLIA TESTNET", (150, 190, 255)),
    "live-both": ("LIVE · MONAD TESTNET → SEPOLIA", GREEN),
    "live-web": ("LIVE · KAKUSHI.VERCEL.APP", GREEN),
}
LX, LY = 36, 150      # left column under the header: empty on every app page


def pill(d, x, y, text, font, fg, bg, pad=(18, 9), outline=None, dot=None):
    tw = d.textlength(text, font=font)
    w = tw + pad[0] * 2 + (22 if dot else 0)
    h = font.size + pad[1] * 2 + 4
    d.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=bg, outline=outline, width=2 if outline else 0)
    tx = x + pad[0]
    if dot:
        d.ellipse([tx, y + h / 2 - 6, tx + 12, y + h / 2 + 6], fill=dot); tx += 22
    d.text((tx, y + h / 2), text, font=font, fill=fg, anchor="lm")
    return w, h


def state_img(t0):
    im = Image.new("RGBA", (VW, VH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = next((c for c in clips if c["start"] <= t0 < c["end"]), clips[-1])
    y = c.get("tagY", LY)
    LXc = c.get("tagX", LX)
    ft, fs = (F_TAG_S, F_STEP_S) if c.get("compact") else (F_TAG, F_STEP)
    if c.get("tag"):
        label, col = TAGS[c["tag"]] if c["tag"] in TAGS else (c["tag"], (150, 190, 255))
        _, h = pill(d, LXc, y, label, ft, col, (6, 10, 24, 255), outline=col + (200,), dot=col)
        y += h + 12
    if c.get("step"):
        _, h = pill(d, LXc, y, c["step"], fs, (228, 232, 255), (6, 10, 24, 255), outline=(59, 85, 255, 220))
        y += h + 12
    if c["speed"] != 1:
        label = f"×{c['speed']:g}"
        tw = d.textlength(label, font=F_SPEED)
        h = F_SPEED.size + 22; w = tw + 36 + 34
        d.rounded_rectangle([LXc, y, LXc + w, y + h], radius=h / 2, fill=GOLD + (255,))
        cy, x = y + h / 2, LXc + 18
        for k in (0, 13):   # the fast-forward glyph, drawn (the font has none)
            d.polygon([(x + k, cy - 9), (x + k + 13, cy), (x + k, cy + 9)], fill=(4, 6, 15))
        d.text((x + 34, cy), label, font=F_SPEED, fill=(4, 6, 15), anchor="lm")
        y += h + 12
    for b in c.get("badges", []):
        bs, be = c["start"] + b.get("from", 0), c["start"] + b.get("to", c["dur"])
        if bs <= t0 < be:
            tw = max(d.textlength(b["text"], font=F_BADGE), d.textlength(b.get("sub", ""), font=F_BADGE_S))
            w, h = tw + 40, 88 if b.get("sub") else 58
            d.rounded_rectangle([LXc, y, LXc + w, y + h], radius=16, fill=(6, 10, 26, 255), outline=GOLD + (230,), width=2)
            d.text((LXc + 20, y + 13), b["text"], font=F_BADGE, fill=GOLD)
            if b.get("sub"):
                d.text((LXc + 20, y + 54), b["sub"], font=F_BADGE_S, fill=(205, 212, 240))
            y += h + 12
    for cue in cues:
        if cue["start"] <= t0 < cue["end"]:
            if c.get("cap") in ("right", "left"):
                # a wrapped block in the empty side column (app pages keep their UI in the centre column)
                maxw, lines, cur = 500, [], ""
                for wd in cue["text"].split():
                    nxt = f"{cur} {wd}".strip()
                    if d.textlength(nxt, font=F_CAP) > maxw and cur:
                        lines.append(cur); cur = wd
                    else:
                        cur = nxt
                lines.append(cur)
                bw = max(d.textlength(l, font=F_CAP) for l in lines) + 52
                bh = 50 * len(lines) + 34
                x0 = (VW - 40 - bw) if c["cap"] == "right" else 40
                y0 = c.get("capY", 560) - bh / 2
                d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=16, fill=(4, 6, 15, 255), outline=(59, 85, 255, 255), width=2)
                for k, l in enumerate(lines):
                    d.text((x0 + 26, y0 + 17 + 50 * k), l, font=F_CAP, fill=(255, 255, 255))
            else:
                cy = c.get("capY", 1012)
                tw = d.textlength(cue["text"], font=F_CAP)
                d.rounded_rectangle([VW / 2 - tw / 2 - 28, cy - 32, VW / 2 + tw / 2 + 28, cy + 32], radius=14, fill=(4, 6, 15, 255), outline=(59, 85, 255, 255), width=2)
                d.text((VW / 2, cy), cue["text"], font=F_CAP, fill=(255, 255, 255), anchor="mm")
    for o in spec.get("texts", []):
        if o["from"] <= t0 < o["to"]:
            pill(d, VW / 2 - d.textlength(o["text"], font=F_BADGE) / 2 - 24, o.get("y", 900), o["text"], F_BADGE, (4, 6, 15), (255, 255, 255, 255), pad=(24, 14))
    return im


pts = {0.0, TOTAL}
for c in clips:
    pts |= {c["start"], c["end"]}
    for b in c.get("badges", []):
        pts |= {c["start"] + b.get("from", 0), c["start"] + b.get("to", c["dur"])}
for cue in cues:
    pts |= {cue["start"], cue["end"]}
for o in spec.get("texts", []):
    pts |= {o["from"], o["to"]}
pts = sorted(set(round(p * FPS) / FPS for p in pts if 0 <= p <= TOTAL))
od = os.path.join(WD, "ov"); os.makedirs(od, exist_ok=True)
for f in os.listdir(od):
    os.remove(os.path.join(od, f))
lst, cache = [], {}
for i, (a, b) in enumerate(zip(pts, pts[1:])):
    if b - a < 0.5 / FPS:
        continue
    im = state_img((a + b) / 2)
    key = hash(im.tobytes())
    p = cache.get(key)
    if not p:
        p = os.path.join(od, f"s{i:04d}.png"); im.save(p); cache[key] = p
    lst.append((p, round(b * FPS) - round(a * FPS)))
print(f"overlay: {len(lst)} states, {len(cache)} images, {len(cues)} cues, total {TOTAL:.2f}s")

# ── narration + bed ─────────────────────────────────────────────────────────
SR = 48000
buf = np.zeros(int((TOTAL + 2) * SR), np.float32)
for lid, st in vo:
    wav = os.path.join(W, "vo", lid + ".wav")
    if not os.path.exists(wav) or os.path.getmtime(wav) < os.path.getmtime(LINES[lid]["file"]):
        run(["ffmpeg", "-v", "error", "-y", "-i", LINES[lid]["file"], "-ar", str(SR), "-ac", "1", wav])
    a, _ = sf.read(wav, dtype="float32")
    i = int(st * SR); buf[i:i + len(a)] += a[: len(buf) - i]
sf.write(os.path.join(WD, "narration.wav"), buf[: int(TOTAL * SR)], SR)
PAD = os.path.join(W, "pad.wav")
if not os.path.exists(PAD):
    expr = ("0.10*sin(2*PI*73.42*t)+0.07*sin(2*PI*110*t)+0.06*sin(2*PI*146.83*t)+0.05*sin(2*PI*174.61*t)"
            "+0.04*sin(2*PI*220*t)+0.03*sin(2*PI*329.63*t)")
    run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='({expr})*(0.75+0.25*sin(2*PI*t/11))':s=48000:d=60",
         "-af", "lowpass=f=1200,aecho=0.8:0.7:200|360:0.35|0.22,volume=1.4", "-ac", "2", PAD])
music = spec.get("music", 0.07)
fc = ";".join([
    "[1:v]format=rgba[ov]", "[0:v][ov]overlay=0:0:format=auto,format=yuv420p[v]",
    f"[3:a]aloop=loop=-1:size=2147483647,atrim=0:{TOTAL:.3f},asetpts=N/SR/TB,volume={music},afade=t=in:st=0:d=1,afade=t=out:st={max(0, TOTAL-2):.3f}:d=2[bed]",
    "[2:a]pan=stereo|c0=c0|c1=c0[vo]",
    "[vo][bed]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]",
])
# the overlay goes in frame-exact: each state's PNG piped for its number of frames (the concat demuxer drifts on images)
NFR = round(TOTAL * FPS)
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-stats", "-y", "-i", os.path.join(WD, "base.mp4"), "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "png", "-i", "pipe:0",
     "-i", os.path.join(WD, "narration.wav"), "-i", PAD, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
     "-c:v", "libx264", "-preset", "medium", "-crf", str(spec.get("crf", 22)), "-pix_fmt", "yuv420p", "-r", str(FPS),
     "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{TOTAL:.3f}", os.path.join(W, NAME + ".mp4")], stdin=subprocess.PIPE)
blobs = {}
sent = 0
for p, n in lst:
    data = blobs.get(p) or blobs.setdefault(p, open(p, "rb").read())
    for _ in range(n):
        ff.stdin.write(data); sent += 1
while sent < NFR + 2:
    ff.stdin.write(data); sent += 1
ff.stdin.close()
assert ff.wait() == 0
print("final:", os.path.join(W, NAME + ".mp4"), f"{TOTAL:.2f}s")
