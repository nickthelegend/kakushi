"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The hero's wave of struck metal coins: real 3D (Three.js), lit by a studio
 * environment with a blue rim light from behind, rolling along a sine path
 * and turning to face you at the crest. Each coin carries one mark from the
 * route: Kakushi, USDC, ETH, Monad, Base, Chainlink. Decorative.
 */

type Mark = "kakushi" | "usdc" | "eth" | "monad" | "base" | "link";
type Metal = "silver" | "gold" | "blue" | "steel";

const ORDER: { mark: Mark; metal: Metal }[] = [
  { mark: "kakushi", metal: "silver" },
  { mark: "usdc", metal: "steel" },
  { mark: "eth", metal: "gold" },
  { mark: "monad", metal: "blue" },
  { mark: "base", metal: "silver" },
  { mark: "link", metal: "gold" },
  { mark: "usdc", metal: "blue" },
  { mark: "eth", metal: "steel" },
];

const METALS: Record<Metal, { color: number; roughness: number }> = {
  silver: { color: 0xe6e9f2, roughness: 0.22 },
  gold: { color: 0xf2c27a, roughness: 0.26 },
  blue: { color: 0x9db3ff, roughness: 0.24 },
  steel: { color: 0xa9aec0, roughness: 0.3 },
};

/** A height map for one face: a raised rim, a fine knurl field and the mark in relief. */
function faceHeight(mark: Mark): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const m = S / 2;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  // knurled field (the Swyftx-style dotted face), kept low
  g.fillStyle = "#151515";
  for (let y = 8; y < S; y += 9) for (let x = 8 + ((y / 9) % 2) * 4.5; x < S; x += 9) {
    if (Math.hypot(x - m, y - m) < m * 0.8) g.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  // raised rim and an inner groove
  g.lineWidth = S * 0.05;
  g.strokeStyle = "#fff";
  g.beginPath();
  g.arc(m, m, m * 0.93, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = S * 0.012;
  g.strokeStyle = "#8a8a8a";
  g.beginPath();
  g.arc(m, m, m * 0.84, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineJoin = "round";
  g.lineCap = "round";
  const u = S / 100;
  switch (mark) {
    case "kakushi": {
      g.font = `700 ${46 * u}px "Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Noto Sans CJK JP",sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("隠", m, m + 2 * u);
      break;
    }
    case "usdc": {
      g.lineWidth = 5 * u;
      g.beginPath();
      g.arc(m, m, 30 * u, Math.PI * 0.62, Math.PI * 1.38);
      g.stroke();
      g.beginPath();
      g.arc(m, m, 30 * u, -Math.PI * 0.38, Math.PI * 0.38);
      g.stroke();
      g.font = `700 ${40 * u}px "Helvetica Neue",Arial,sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("$", m, m + 2 * u);
      break;
    }
    case "eth": {
      const top = m - 32 * u, mid = m + 4 * u, bot = m + 34 * u, w = 20 * u;
      g.beginPath();
      g.moveTo(m, top);
      g.lineTo(m + w, mid);
      g.lineTo(m, mid + 9 * u);
      g.lineTo(m - w, mid);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(m - w, mid + 6 * u);
      g.lineTo(m, mid + 15 * u);
      g.lineTo(m + w, mid + 6 * u);
      g.lineTo(m, bot);
      g.closePath();
      g.fill();
      break;
    }
    case "monad": {
      g.save();
      g.translate(m, m);
      g.rotate(Math.PI / 4);
      const r = 25 * u;
      g.lineWidth = 10 * u;
      g.beginPath();
      g.roundRect(-r, -r, r * 2, r * 2, 11 * u);
      g.stroke();
      g.restore();
      break;
    }
    case "base": {
      g.beginPath();
      g.arc(m, m, 30 * u, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#000";
      g.fillRect(m - 34 * u, m - 4 * u, 34 * u, 8 * u);
      break;
    }
    case "link": {
      g.lineWidth = 8 * u;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const x = m + Math.cos(a) * 30 * u;
        const y = m + Math.sin(a) * 30 * u;
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      g.stroke();
      break;
    }
  }
  return c;
}

/** Fine vertical ridges for the coin's edge. */
function edgeHeight(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 16;
  const g = c.getContext("2d")!;
  for (let x = 0; x < c.width; x += 4) {
    g.fillStyle = "#fff";
    g.fillRect(x, 0, 2, c.height);
    g.fillStyle = "#000";
    g.fillRect(x + 2, 0, 2, c.height);
  }
  return c;
}

export function CoinWave({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: the hero stands on its own
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0.35, 10.5);
    camera.lookAt(0, -0.1, 0);

    // warm key from the upper left, a deep blue rim from behind on the right, a cool fill
    const key = new THREE.DirectionalLight(0xffd9b0, 2.4);
    key.position.set(-6, 5, 6);
    const rim = new THREE.DirectionalLight(0x3d5cff, 9);
    rim.position.set(7, 1, -6);
    const rim2 = new THREE.DirectionalLight(0x6f8bff, 4);
    rim2.position.set(-8, -2, -5);
    const fill = new THREE.DirectionalLight(0xbfd0ff, 0.6);
    fill.position.set(0, -4, 8);
    scene.add(key, rim, rim2, fill);

    const geo = new THREE.CylinderGeometry(1, 1, 0.17, 128, 1);
    geo.rotateX(Math.PI / 2); // faces toward the camera

    const edgeTex = new THREE.CanvasTexture(edgeHeight());
    edgeTex.wrapS = THREE.RepeatWrapping;
    edgeTex.repeat.set(3, 1);
    const faceTex = new Map<Mark, THREE.CanvasTexture>();
    const disposables: { dispose(): void }[] = [geo, edgeTex, pmrem];

    const coins: THREE.Mesh[] = [];
    const N = 13;
    for (let i = 0; i < N; i++) {
      const { mark, metal } = ORDER[i % ORDER.length]!;
      let tex = faceTex.get(mark);
      if (!tex) {
        tex = new THREE.CanvasTexture(faceHeight(mark));
        faceTex.set(mark, tex);
        disposables.push(tex);
      }
      const spec = METALS[metal];
      const face = new THREE.MeshStandardMaterial({ color: spec.color, metalness: 1, roughness: spec.roughness, bumpMap: tex, bumpScale: 5 });
      const edge = new THREE.MeshStandardMaterial({ color: spec.color, metalness: 1, roughness: spec.roughness + 0.06, bumpMap: edgeTex, bumpScale: 3 });
      disposables.push(face, edge);
      const mesh = new THREE.Mesh(geo, [edge, face, face]);
      scene.add(mesh);
      coins.push(mesh);
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 1;
    let span = 10;
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      width = w;
      // the visible half-width at z=0, so the wave always runs off both edges
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      span = halfH * camera.aspect * 1.18;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const place = (t: number) => {
      const narrow = width < 640;
      const scale = narrow ? 0.62 : width < 1024 ? 0.85 : 1;
      for (let i = 0; i < N; i++) {
        const s = (((i / N + t * 0.022) % 1) + 1) % 1; // 0..1 along the path, left to right
        const x = (s * 2 - 1) * span;
        const crest = Math.exp(-Math.pow((s - 0.5) / 0.13, 2)); // 1 at the centre
        const y = Math.sin(s * Math.PI * 2 - 0.9) * 0.62 - 0.55 + crest * 0.55;
        const z = -1.4 + crest * 1.6 + Math.cos(s * Math.PI * 2) * 0.45;
        const c = coins[i]!;
        c.position.set(x, y * scale + (narrow ? 0.35 : 0), z);
        // edge-on-ish at the sides, facing you at the crest, leaning into the slope
        c.rotation.set(
          0.18 * Math.sin(s * 9 + t * 0.4),
          (1 - crest) * (s < 0.5 ? 1.22 : -1.22) + 0.1 * Math.sin(t * 0.7 + i),
          -0.28 * Math.cos(s * Math.PI * 2 - 0.9) + 0.05 * Math.sin(t + i * 1.3),
        );
        c.scale.setScalar(scale * (1 + crest * 0.22));
      }
    };

    let raf = 0;
    let visible = true;
    const t0 = performance.now();
    const frame = () => {
      raf = 0;
      place(reduced ? 6 : (performance.now() - t0) / 1000);
      renderer.render(scene, camera);
      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting);
      if (visible) kick();
    });
    io.observe(el);
    const onVis = () => !document.hidden && kick();
    document.addEventListener("visibilitychange", onVis);
    kick();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      disposables.forEach((d) => d.dispose());
      scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} aria-hidden className={className} />;
}
