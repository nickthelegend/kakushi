// Assembles docs/video/kakushi-film.mp4 (1920x1080, 30 fps):
//   Gemini intro clip + title card -> the real product recording, cut by scene markers, with
//   captions (the dispute wait fast-forwarded and labelled) -> Gemini hanko clip + end card.
// Audio: the Gemini clips' own audio at the ends, an ambient bed made from it underneath.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const RAW = "docs/video/raw";
const SRC = "docs/video/src";
const TMP = `${RAW}/segments`;
const OUT = "docs/video/kakushi-film.mp4";
mkdirSync(TMP, { recursive: true });
const marks = Object.fromEntries((JSON.parse(readFileSync(`${RAW}/markers.json`, "utf8")) as { name: string; at: number }[]).map((m) => [m.name, m.at]));
const m = (k: string) => {
  const v = marks[k];
  if (v === undefined) throw new Error(`missing marker ${k}`);
  return v;
};
const ff = (args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const fit = "scale=-2:1080,pad=1920:1080:(ow-iw)/2:0:color=0x0b1424,setsar=1,fps=30";
const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-an"];

interface Seg { from: number; to: number; speed?: number; card?: string; zoom?: boolean }
// push in on the receipt column (left 1000x625 of the 1440x900 page) so the timeline reads at 1080p
const ZOOM = "crop=1120:700:60:6,scale=1440:900";
const product: Seg[] = [
  { from: m("landing") + 0.3, to: m("bridge") - 0.2, card: "c-amount" },
  { from: m("bridge"), to: m("pay"), card: "c-quotes" },
  { from: m("pay"), to: m("paid") - 0.5, card: "c-pay", zoom: true },
  { from: m("paid") - 0.5, to: m("outage") - 0.2, card: "c-paid", zoom: true },
  { from: m("outage"), to: m("outage-wait"), card: "c-outage", zoom: true },
  { from: m("outage-wait"), to: m("slashed"), speed: 4, card: "c-ff", zoom: true },
  { from: m("slashed"), to: m("disputes") - 0.2, card: "c-slashed", zoom: true },
  { from: m("disputes"), to: m("attestations") - 0.2, card: "c-disputes" },
  { from: m("attestations"), to: m("makers") - 0.2, card: "c-attest" },
  { from: m("makers"), to: m("refund") - 0.2, card: "c-makers" },
  { from: m("refund") + 3, to: m("end"), card: "c-refund", zoom: true },
];

const files: string[] = [];
let total = 0;

// intro: the bridge -> freeze -> seal -> pay-back clip, with the title card late
{
  const f = `${TMP}/00-intro.mp4`;
  ff(["-i", `${SRC}/clip-bridge-dispute.mp4`, "-loop", "1", "-t", "10", "-i", `${RAW}/cards/title.png`, "-filter_complex",
    `[0:v]scale=1920:1080,setsar=1,fps=30[v];[1:v]scale=1920:1080,format=rgba,fade=t=in:st=6.2:d=1.0:alpha=1[c];[v][c]overlay=shortest=1,fade=t=out:st=9.6:d=0.4[o]`,
    "-map", "[o]", "-t", "10", ...enc, f]);
  files.push(f);
  total += 10;
}

product.forEach((s, i) => {
  const speed = s.speed ?? 1;
  const d = (s.to - s.from) / speed;
  const f = `${TMP}/${String(i + 1).padStart(2, "0")}-product.mp4`;
  const cardFade = `fade=t=in:st=0.25:d=0.45:alpha=1,fade=t=out:st=${Math.max(0.8, d - 0.55).toFixed(2)}:d=0.45:alpha=1`;
  ff(["-ss", s.from.toFixed(2), "-to", s.to.toFixed(2), "-i", `${RAW}/product.webm`, "-loop", "1", "-t", d.toFixed(2), "-i", `${RAW}/cards/${s.card}.png`, "-filter_complex",
    `[0:v]setpts=(PTS-STARTPTS)/${speed}${s.zoom ? `,${ZOOM}` : ""}[v];[1:v]format=rgba,${cardFade}[c];[v][c]overlay=eof_action=pass,${fit},fade=t=in:st=0:d=0.25,fade=t=out:st=${(d - 0.25).toFixed(2)}:d=0.25[o]`,
    "-map", "[o]", "-t", d.toFixed(2), ...enc, f]);
  files.push(f);
  total += d;
});

// outro: the hanko seal, then the end card
{
  const f = `${TMP}/99-outro.mp4`;
  ff(["-i", `${SRC}/clip-hanko.mp4`, "-loop", "1", "-t", "10", "-i", `${RAW}/cards/end.png`, "-filter_complex",
    `[0:v]scale=1920:1080,setsar=1,fps=30,fade=t=in:st=0:d=0.4[v];[1:v]scale=1920:1080,format=rgba,fade=t=in:st=6.0:d=1.0:alpha=1[c];[v][c]overlay=shortest=1[o]`,
    "-map", "[o]", "-t", "10", ...enc, f]);
  files.push(f);
  total += 10;
}

writeFileSync(`${TMP}/list.txt`, files.map((f) => `file '${f.replace(`${TMP}/`, "")}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", `${TMP}/list.txt`, "-c", "copy", `${TMP}/video.mp4`]);

// audio: intro clip audio, an ambient bed (the clip audio looped, low-passed, quiet), outro clip audio
const mid = total - 20;
ff(["-i", `${SRC}/clip-bridge-dispute.mp4`, "-i", `${SRC}/clip-hanko.mp4`, "-filter_complex",
  [
    `[0:a]atrim=0:10,asetpts=PTS-STARTPTS,afade=t=out:st=8.5:d=1.5[a0]`,
    `[0:a]aloop=loop=-1:size=2e9,atrim=0:${mid.toFixed(2)},asetpts=PTS-STARTPTS,lowpass=f=900,volume=0.35,afade=t=in:st=0:d=1.5,afade=t=out:st=${(mid - 1.5).toFixed(2)}:d=1.5[a1]`,
    `[1:a]atrim=0:10,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.8,afade=t=out:st=8.8:d=1.2[a2]`,
    `[a0][a1][a2]concat=n=3:v=0:a=1[a]`,
  ].join(";"),
  "-map", "[a]", "-c:a", "aac", "-b:a", "160k", `${TMP}/audio.m4a`]);
ff(["-i", `${TMP}/video.mp4`, "-i", `${TMP}/audio.m4a`, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", OUT]);
console.log(`wrote ${OUT} (${total.toFixed(1)} s)`);
