/* Solar Gravity - a cinematic 3D miniature solar system.
   A small state machine drives the sun's life and death:
     active     - the sun shines, planets orbit
     destroying - corona destabilizes (turbulence rises)
     lightDelay - the compressed 8m 20s light-travel delay (sky stays bright)
     disappearing - the sun collapses cleanly; light fades system-wide
     absent     - deep space; planets coast on inertial trajectories
     restoring  - the sun reforms, then planets curve back to their orbits
   A damped 3D camera, sun lighting, stars and rings are all derived
   per-frame from the same small state. */

"use strict";

const root = document.documentElement;
const world = document.getElementById("world");
const sunEl = document.getElementById("sun");
const ringBack = document.getElementById("ring-back");
const ringFront = document.getElementById("ring-front");
const tooltip = document.getElementById("tooltip");
const tooltipName = tooltip.querySelector(".tooltip-name");
const tooltipInfo = tooltip.querySelector(".tooltip-info");
const orbitPathEls = Array.prototype.slice.call(document.querySelectorAll(".orbits path"));
const starPts = {
  far: document.querySelector(".stars-far .pts"),
  mid: document.querySelector(".stars-mid .pts"),
  bright: document.querySelector(".stars-bright .pts"),
};
const statusEl = document.getElementById("status");
const statusTitle = statusEl.querySelector(".status-title");
const statusLines = statusEl.querySelector(".status-lines");

const STATE = {
  ACTIVE: "active",
  DESTROYING: "destroying",
  LIGHT_DELAY: "lightDelay",
  DISAPPEARING: "disappearing",
  ABSENT: "absent",
  RESTORING: "restoring",
};

const DESTROY_DUR = 1.5;       // s of corona destabilization
const LIGHT_DELAY_DUR = 2.0;   // s for the compressed 8m20s light delay
const DISAPPEAR_DUR = 1.0;     // s for the sun to collapse cleanly
const ESC_TRANS_DUR = 2.5;     // s to ease orbit -> inertial straight line
const RESTORE_REFORM_DUR = 2.0; // s for the sun to reform
const RESTORE_TOTAL_DUR = 6.5; // s for the full restoration arc
const POST_SUN_TIME_SCALE = 1.8; // visualization speed-up for the 8m20s light-time
const PERSP = 1400;            // camera perspective distance (px)

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = window.innerWidth < 640;
const MOBILE_SCALE = isMobile ? 0.78 : 1;

/* ---------- Planet data ---------- */

const PLANETS = [
  {
    name: "Mercury", sel: ".p-mercury", labId: "lab-mercury", sizePx: 16,
    gap: 0.050, dir: 1, speed: 0.30, phase: 0.0, selfRot: 0.05,
    tilt: 0.20, incl: 0.05, inclPhase: 0.0, ambient: 0.22,
    info: { distance: "0.39 AU", size: "4,879 km", period: "88 days" },
  },
  {
    name: "Venus", sel: ".p-venus", labId: "lab-venus", sizePx: 24,
    gap: 0.075, dir: -1, speed: 0.24, phase: 1.7, selfRot: 0.03,
    tilt: -0.15, incl: 0.05, inclPhase: 1.0, ambient: 0.48,
    info: { distance: "0.72 AU", size: "12,104 km", period: "225 days" },
  },
  {
    name: "Earth", sel: ".p-earth", labId: "lab-earth", sizePx: 28,
    gap: 0.100, dir: 1, speed: 0.19, phase: 3.1, selfRot: 0.06,
    tilt: 0.05, incl: 0.06, inclPhase: 2.0, ambient: 0.20, clouds: true,
    info: { distance: "1.00 AU", size: "12,742 km", period: "365 days" },
  },
  {
    name: "Mars", sel: ".p-mars", labId: "lab-mars", sizePx: 22,
    gap: 0.125, dir: -1, speed: 0.16, phase: 4.5, selfRot: 0.03,
    tilt: -0.25, incl: 0.06, inclPhase: 3.0, ambient: 0.30,
    info: { distance: "1.52 AU", size: "6,779 km", period: "687 days" },
  },
  {
    name: "Jupiter", sel: ".p-jupiter", labId: "lab-jupiter", sizePx: 52,
    gap: 0.150, dir: 1, speed: 0.11, phase: 0.9, selfRot: 0.10,
    tilt: 0.10, incl: 0.07, inclPhase: 0.5, ambient: 0.30,
    info: { distance: "5.20 AU", size: "139,820 km", period: "11.9 years" },
  },
  {
    name: "Saturn", sel: ".p-saturn", labId: "lab-saturn", sizePx: 46,
    gap: 0.180, dir: -1, speed: 0.09, phase: 2.3, selfRot: 0.06,
    tilt: -0.10, incl: 0.08, inclPhase: 1.5, ambient: 0.30, rings: true,
    info: { distance: "9.58 AU", size: "116,460 km", period: "29.4 years" },
  },
  {
    name: "Uranus", sel: ".p-uranus", labId: "lab-uranus", sizePx: 30,
    gap: 0.210, dir: 1, speed: 0.07, phase: 5.2, selfRot: 0.04,
    tilt: 0.15, incl: 0.08, inclPhase: 2.5, ambient: 0.34,
    info: { distance: "19.2 AU", size: "50,724 km", period: "84 years" },
  },
  {
    name: "Neptune", sel: ".p-neptune", labId: "lab-neptune", sizePx: 29,
    gap: 0.240, dir: -1, speed: 0.05, phase: 6.0, selfRot: 0.03,
    tilt: -0.05, incl: 0.09, inclPhase: 3.5, ambient: 0.36,
    info: { distance: "30.0 AU", size: "49,244 km", period: "165 years" },
  },
];

const planets = PLANETS.map((def, i) => ({
  ...def,
  index: i,
  el: document.querySelector(def.sel),
  labEl: document.getElementById(def.labId),
  angle: def.phase,
  selfAngle: 0,
  proj: { sx: 0, sy: 0, sz: 0, ss: 1 },
  zIndex: 10,
  esc: null,
}));

/* ---------- State ---------- */

let state = STATE.ACTIVE;
let phaseT = 0;               // seconds elapsed inside the current state
let escAge = 0;               // seconds since the sun disappeared
let camYaw = 0;               // damped camera angles (radians)
let camPitch = 0;
let camYawTarget = 0;
let camPitchTarget = 0;
let autoYaw = 0;
let autoRotate = false;
let camEnabled = true;
let parX = 0;                 // cursor parallax (normalised -0.5..0.5)
let parY = 0;
let parTX = 0;
let parTY = 0;
let hoverIndex = -1;
let selectedIndex = -1;
let rafId = null;
let lastTime = null;

let explorerMode = false;     // Space Explorer Mode: night sky, sun untouched
let night = 0;                // eased 0..1 blend toward the explorer night

let U = 0;                    // base unit = min(vw, vh) * scale
let sunR = isMobile ? 50 : 75;

/* ---------- Math helpers ---------- */

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(hexA, hexB, t) {
  const a = [parseInt(hexA.slice(1, 3), 16), parseInt(hexA.slice(3, 5), 16), parseInt(hexA.slice(5, 7), 16)];
  const b = [parseInt(hexB.slice(1, 3), 16), parseInt(hexB.slice(3, 5), 16), parseInt(hexB.slice(5, 7), 16)];
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return "rgb(" + r + ", " + g + ", " + bl + ")";
}

function mixRgba(hexA, hexB, t, alpha) {
  const rgb = mixColor(hexA, hexB, t);
  return rgb.replace(")", ", " + alpha + ")").replace("rgb(", "rgba(");
}

/* One point on an ellipse, rotated by `tilt`. */
function ellipsePoint(rx, ry, tilt, angle) {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const ex = rx * Math.cos(angle);
  const ey = ry * Math.sin(angle);
  return {
    x: ex * c - ey * s,
    y: ex * s + ey * c,
  };
}

/* Tangent direction of the ellipse at `angle` (the derivative). */
function ellipseTangent(rx, ry, tilt, angle) {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const dex = -rx * Math.sin(angle);
  const dey = ry * Math.cos(angle);
  return {
    x: dex * c - dey * s,
    y: dex * s + dey * c,
  };
}

function setVar(name, value) {
  root.style.setProperty(name, value);
}

/* ---------- Geometry: scale, orbits, projection ---------- */

function computeScale() {
  U = Math.min(window.innerWidth, window.innerHeight) * MOBILE_SCALE;
}

function buildOrbits() {
  for (const p of planets) {
    const rx = sunR + p.gap * U;
    const ry = rx * 0.45;
    const pts = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const e = ellipsePoint(rx, ry, p.tilt, a);
      pts.push({ x: e.x, y: e.y, z: Math.sin(a + p.inclPhase) * p.incl * U });
    }
    p.orbitPx = { rx, ry, pts };
  }
}

/* Rotate a world-space point by yaw (around Y) then pitch (around X),
   then apply perspective. Returns an offset from screen centre. */
function project(x, y, z, cyw, syw, cpx, spx) {
  const X = x * cyw + z * syw;
  const Z = -x * syw + z * cyw;
  const Y2 = y * cpx - Z * spx;
  const Z2 = y * spx + Z * cpx;
  const s = PERSP / (PERSP + Z2);
  return { x: X * s, y: Y2 * s, z: Z2, s: s };
}

/* ---------- Stars ---------- */

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function buildStars() {
  const counts = isMobile ? { far: 70, mid: 30, bright: 10 } : { far: 120, mid: 48, bright: 18 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  let far = "";
  let mid = "";
  let bright = "";

  for (let i = 0; i < counts.far; i++) {
    far += rand(0, w).toFixed(0) + "px " + rand(0, h).toFixed(0) + "px 0 0 " +
      (i % 3 ? "#ffffff" : "#dbe9ff") + (i < counts.far - 1 ? ", " : "");
  }
  for (let i = 0; i < counts.mid; i++) {
    mid += rand(0, w).toFixed(0) + "px " + rand(0, h).toFixed(0) + "px 0 0 #eaf2ff" +
      (i < counts.mid - 1 ? ", " : "");
  }
  for (let i = 0; i < counts.bright; i++) {
    const x = rand(0, w).toFixed(0) + "px ";
    const y = rand(0, h).toFixed(0) + "px ";
    bright += x + y + "0 1px #ffffff, " + x + y + "0 3px rgba(190, 215, 255, 0.5)" +
      (i < counts.bright - 1 ? ", " : "");
  }

  starPts.far.style.boxShadow = far;
  starPts.mid.style.boxShadow = mid;
  starPts.bright.style.boxShadow = bright;
}

/* ---------- Escape trajectories ---------- */

/* Capture each planet's position and tangential velocity at the exact
   moment the sun's influence vanishes (DISAPPEARING -> ABSENT). The
   tangent already carries the ellipse scale, so the escape speed is the
   orbital angular speed scaled by POST_SUN_TIME_SCALE. */
function recordEscape() {
  for (const p of planets) {
    const e = ellipsePoint(p.orbitPx.rx, p.orbitPx.ry, p.tilt, p.angle);
    const t = ellipseTangent(p.orbitPx.rx, p.orbitPx.ry, p.tilt, p.angle);
    const vMag = p.speed * POST_SUN_TIME_SCALE * p.dir;
    p.esc = {
      x: e.x,
      y: e.y,
      z: Math.sin(p.angle + p.inclPhase) * p.incl * U,
      vx: t.x * vMag,
      vy: t.y * vMag,
      angle: p.angle,
    };
  }
}

/* Straight-line inertial position `a` seconds after escape. */
function escapePos(p, a) {
  return {
    x: p.esc.x + p.esc.vx * a,
    y: p.esc.y + p.esc.vy * a,
    z: p.esc.z,
  };
}

/* ---------- Environment (per-frame CSS variables) ---------- */

function applyEnv() {
  let sunLive = 1;
  let illum = 1;
  let skyLevel = 0;
  let remn = 0;
  let turb = 0;
  let lf = 0;

  if (state === STATE.DISAPPEARING) {
    const k = clamp01(phaseT / DISAPPEAR_DUR);
    sunLive = 1 - k;
    illum = 1 - k;
    skyLevel = k;
    remn = k;
    turb = 1 - k * 0.7;
    lf = Math.max(0, 1 - k * 1.2);
  } else if (state === STATE.ABSENT) {
    sunLive = 0;
    illum = 0;
    skyLevel = 1;
    remn = 1;
    turb = 0;
    lf = 0;
  } else if (state === STATE.RESTORING) {
    const reform = smoothstep(0, RESTORE_REFORM_DUR, phaseT);
    sunLive = reform;
    illum = reform;
    skyLevel = 1 - reform;
    remn = 1 - reform;
    turb = (1 - reform) * 0.5;
    lf = 0;
  } else if (state === STATE.DESTROYING) {
    turb = clamp01(phaseT / DESTROY_DUR);
  } else if (state === STATE.LIGHT_DELAY) {
    turb = 1;
    lf = clamp01(phaseT / LIGHT_DELAY_DUR);
  }

  // Space Explorer Mode darkens the sky on its own; the sun keeps shining
  // and the planets keep their orbits, so only sky-level values blend.
  if (night > 0) {
    skyLevel = Math.max(skyLevel, night);
  }

  const boil = sunLive * (0.45 + 0.4 * turb);
  setVar("--space", skyLevel.toFixed(3));
  setVar("--illum", illum.toFixed(3));
  setVar("--sun-live", sunLive.toFixed(3));
  setVar("--turb", turb.toFixed(3));
  setVar("--boil", boil.toFixed(3));
  setVar("--remnant", remn.toFixed(3));
  setVar("--delay", lf.toFixed(3));
  setVar("--lf-s", (1 + lf * 3.2).toFixed(3));
  setVar("--lf-o", (lf * 0.85).toFixed(3));
  setVar("--pulse-s", (1 + turb * 0.5).toFixed(3));
  setVar("--face-op", lerp(0.4, 1, illum).toFixed(3));
  setVar("--stars", skyLevel.toFixed(3));

  // The photosphere warms as the corona destabilizes.
  setVar("--sun-a", mixColor("#fffbe0", "#ffd9a0", turb));
  setVar("--sun-b", mixColor("#ffd93d", "#ffb02a", turb));
  setVar("--sun-c", mixColor("#ff9f1a", "#ff7a1a", turb));
  setVar("--sun-d", mixColor("#e8670a", "#d84a08", turb));

  // Clouds, birds and planes only belong to daylight.
  setVar("--cloud-fade", (1 - skyLevel).toFixed(3));
  setVar("--bird-fade", (1 - skyLevel).toFixed(3));

  // Interface colouring adapts to the sky.
  setVar("--ui-text", mixColor("#123a6b", "#dfe6ff", skyLevel));
  setVar("--title-color", mixColor("#0b2a5e", "#e8f0ff", skyLevel));
  setVar("--title-glow", mixRgba("#ffffff", "#cdd8ff", skyLevel, 0.85));
  setVar("--orbit-c", mixColor("#4a5f96", "#b8c8ff", skyLevel));
}

/* ---------- Render ---------- */

function setSvgSize() {
  const svg = document.getElementById("orbits");
  svg.setAttribute("viewBox", "0 0 " + window.innerWidth + " " + window.innerHeight);
}

function worldPosition(p) {
  if (state === STATE.ABSENT || state === STATE.RESTORING) {
    const o = p.esc;
    const ep = escapePos(p, escAge);
    if (state === STATE.ABSENT) {
      const k = easeInOutSine(clamp01(escAge / ESC_TRANS_DUR));
      return {
        x: lerp(o.x, ep.x, k),
        y: lerp(o.y, ep.y, k),
        z: o.z,
      };
    }
    const b = smoothstep(RESTORE_REFORM_DUR, RESTORE_TOTAL_DUR, phaseT);
    const wob = Math.sin(o.angle + p.inclPhase) * p.incl * U;
    const orb = ellipsePoint(p.orbitPx.rx, p.orbitPx.ry, p.tilt, o.angle);
    return {
      x: lerp(ep.x, orb.x, b),
      y: lerp(ep.y, orb.y, b),
      z: lerp(o.z, wob, b),
    };
  }
  const e = ellipsePoint(p.orbitPx.rx, p.orbitPx.ry, p.tilt, p.angle);
  return {
    x: e.x,
    y: e.y,
    z: Math.sin(p.angle + p.inclPhase) * p.incl * U,
  };
}

function render(yaw, pitch) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = vw / 2;
  const cy = vh / 2;
  const cyw = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const cpx = Math.cos(pitch);
  const spx = Math.sin(pitch);
  const illum = parseFloat(root.style.getPropertyValue("--illum") || "1");
  const tNow = performance.now() / 1000;

  for (const p of planets) {
    const w = worldPosition(p);
    const pr = project(w.x, w.y, w.z, cyw, syw, cpx, spx);
    const sx = pr.x;
    const sy = pr.y;
    const sz = pr.z;
    const ss = pr.s;
    p.proj = { sx: sx, sy: sy, sz: sz, ss: ss };

    // Face the bright side toward the sun, compensating the planet's spin.
    const face = Math.atan2(sy, sx) * 180 / Math.PI - p.selfAngle * 180 / Math.PI;
    const posLight = Math.min(1.25, Math.max(0.6, 0.82 + (ss - 1) * 1.6));
    const b = posLight * lerp(p.ambient, 1, illum);

    p.el.style.transform =
      "translate3d(" + sx.toFixed(2) + "px," + sy.toFixed(2) + "px,0) " +
      "rotate(" + p.selfAngle.toFixed(4) + "rad) scale(" + ss.toFixed(4) + ")";
    p.el.style.setProperty("--face", face.toFixed(2) + "deg");
    p.el.style.setProperty("--pl", b.toFixed(3));

    if (p.clouds) {
      p.el.style.setProperty("--cloud-x", ((tNow * 9) % 22 - 11).toFixed(2) + "px");
    }
  }

  // Painter's sort: deepest first, the sun sits at depth zero.
  const items = planets.map((p) => ({ p: p, z: p.proj.sz }));
  items.push({ sun: true, z: 0 });
  items.sort((a, b) => a.z - b.z);
  let zi = 10;
  for (const it of items) {
    if (it.sun) {
      sunEl.style.zIndex = zi;
    } else {
      it.p.el.style.zIndex = zi;
      it.p.zIndex = zi;
    }
    zi++;
  }

  // Saturn's rings: front and back halves pinned to the planet.
  const sat = planets.find((p) => p.rings);
  if (sat) {
    const theta = -24 + pitch * 57.2958 * 0.55;
    const t3 = "translate3d(" + sat.proj.sx.toFixed(2) + "px," + sat.proj.sy.toFixed(2) + "px,0) " +
      "scale(" + sat.proj.ss.toFixed(4) + ") scaleY(0.38) rotate(" + theta.toFixed(2) + "deg)";
    ringBack.style.transform = t3;
    ringFront.style.transform = t3;
    ringBack.style.zIndex = Math.max(2, sat.zIndex - 1);
    ringFront.style.zIndex = sat.zIndex + 1;
  }

  // Orbit lines (project the precomputed polylines each frame).
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i];
    const pts = p.orbitPx.pts;
    let d = "";
    for (let k = 0; k < pts.length; k++) {
      const pr = project(pts[k].x, pts[k].y, pts[k].z, cyw, syw, cpx, spx);
      d += (k ? "L" : "M") + (cx + pr.x).toFixed(1) + " " + (cy + pr.y).toFixed(1);
    }
    d += "Z";
    orbitPathEls[i].setAttribute("d", d);
  }

  // Labels float just above their planet.
  if (document.body.classList.contains("labels-on")) {
    for (const p of planets) {
      const off = p.sizePx * p.proj.ss / 2 + 12;
      p.labEl.style.transform = "translate3d(" + p.proj.sx.toFixed(2) + "px," + (p.proj.sy - off).toFixed(2) + "px,0)";
    }
  }

  // Starfield parallax with the camera.
  starPts.far.parentElement.style.transform = "translate3d(" + (yaw * -18).toFixed(2) + "px," + (pitch * -18).toFixed(2) + "px,0)";
  starPts.mid.parentElement.style.transform = "translate3d(" + (yaw * -34).toFixed(2) + "px," + (pitch * -34).toFixed(2) + "px,0)";
  starPts.bright.parentElement.style.transform = "translate3d(" + (yaw * -52).toFixed(2) + "px," + (pitch * -52).toFixed(2) + "px,0)";

  // Tooltip follows the hovered planet.
  if (hoverIndex >= 0) {
    const p = planets[hoverIndex];
    const tx = cx + p.proj.sx + parX * 12;
    const ty = cy + p.proj.sy - 48;
    const tw = tooltip.offsetWidth || 190;
    let fx = tx + 14;
    if (fx + tw > vw - 8) fx = tx - tw - 14;
    let fy = ty;
    if (fy < 8) fy = cy + p.proj.sy + p.sizePx * p.proj.ss / 2 + 18;
    tooltip.style.transform = "translate3d(" + fx + "px," + fy + "px,0)";
    tooltip.classList.add("show");
  }
}

/* ---------- State machine ---------- */

function step(dtSec) {
  phaseT += dtSec;
  switch (state) {
    case STATE.DESTROYING:
      if (phaseT >= DESTROY_DUR) {
        state = STATE.LIGHT_DELAY;
        phaseT = 0;
        updateStatus();
        updateSunUI();
      }
      break;
    case STATE.LIGHT_DELAY:
      if (phaseT >= LIGHT_DELAY_DUR) {
        state = STATE.DISAPPEARING;
        phaseT = 0;
        updateStatus();
        updateSunUI();
      }
      break;
    case STATE.DISAPPEARING:
      if (phaseT >= DISAPPEAR_DUR) {
        recordEscape();
        escAge = 0;
        state = STATE.ABSENT;
        phaseT = 0;
        updateStatus();
        updateSunUI();
      }
      break;
    case STATE.ABSENT:
      escAge += dtSec;
      break;
    case STATE.RESTORING:
      escAge += dtSec;
      if (phaseT >= RESTORE_TOTAL_DUR) {
        for (const p of planets) p.esc = null;
        escAge = 0;
        state = STATE.ACTIVE;
        phaseT = 0;
        updateStatus();
        updateSunUI();
      }
      break;
  }
}

function beginDestroy() {
  if (state !== STATE.ACTIVE) return;
  state = STATE.DESTROYING;
  phaseT = 0;
  if (reducedMotion) {
    recordEscape();
    escAge = ESC_TRANS_DUR + 3;
    state = STATE.ABSENT;
    phaseT = 0;
    applyEnv();
    render(0, 0);
  }
  updateStatus();
  updateSunUI();
}

function beginRestore() {
  if (state !== STATE.ABSENT) return;
  state = STATE.RESTORING;
  phaseT = 0;
  if (reducedMotion) {
    for (const p of planets) p.esc = null;
    escAge = 0;
    state = STATE.ACTIVE;
    phaseT = 0;
    applyEnv();
    render(0, 0);
  }
  updateStatus();
  updateSunUI();
}

function toggleSun() {
  if (state === STATE.ACTIVE) beginDestroy();
  else if (state === STATE.ABSENT) beginRestore();
}

/* ---------- Status + sun UI ---------- */

const STATUS_TEXT = {
  [STATE.ACTIVE]: {
    title: "SUN ACTIVE",
    lines: ["Solar gravity: active", "Solar radiation: active"],
  },
  [STATE.DESTROYING]: {
    title: "SOLAR EVENT",
    lines: ["Solar instability detected", "Corona turbulence increasing"],
  },
  [STATE.LIGHT_DELAY]: {
    title: "LIGHT TRAVEL DELAY",
    lines: ["Propagation delay: 8m 20s", "Earth still receives sunlight until the last photons arrive"],
  },
  [STATE.DISAPPEARING]: {
    title: "SOLAR COLLAPSE",
    lines: ["Final photons departing", "Sunlight fading across the system"],
  },
  [STATE.ABSENT]: {
    title: "SUN ABSENT",
    lines: ["Solar illumination: none", "Planets: inertial trajectories"],
  },
  [STATE.RESTORING]: {
    title: "SOLAR RESTORATION",
    lines: ["Restoring illumination...", "Restoring orbital paths..."],
  },
};

function updateStatus() {
  const text = STATUS_TEXT[state];
  statusTitle.textContent = text.title;
  statusLines.innerHTML = text.lines.join("<br>");
  document.body.classList.toggle("count-on", state === STATE.LIGHT_DELAY || state === STATE.DISAPPEARING);
}

/* ---------- Controls ---------- */

const ctlSun = document.getElementById("ctl-sun");
const ctlCamera = document.getElementById("ctl-camera");
const ctlOrbits = document.getElementById("ctl-orbits");
const ctlLabels = document.getElementById("ctl-labels");
const ctlRotate = document.getElementById("ctl-rotate");
const ctlExplorer = document.getElementById("ctl-explorer");

function updateSunUI() {
  if (state === STATE.ACTIVE) {
    ctlSun.textContent = "Destroy Sun";
    ctlSun.disabled = false;
    ctlSun.setAttribute("aria-pressed", "false");
    sunEl.setAttribute("aria-label", "Destroy the Sun");
    sunEl.title = "Click to destroy the Sun";
  } else if (state === STATE.ABSENT) {
    ctlSun.textContent = "Restore Sun";
    ctlSun.disabled = false;
    ctlSun.setAttribute("aria-pressed", "true");
    sunEl.setAttribute("aria-label", "Restore the Sun");
    sunEl.title = "Click to restore the Sun";
  } else {
    ctlSun.textContent = state === STATE.RESTORING ? "Restoring..." : "Destroying...";
    ctlSun.disabled = true;
    ctlSun.setAttribute("aria-pressed", "true");
    sunEl.setAttribute("aria-label", "Solar event in progress");
    sunEl.title = "";
  }
}

ctlSun.addEventListener("click", toggleSun);

sunEl.addEventListener("click", function (event) {
  event.stopPropagation();
  toggleSun();
});

sunEl.addEventListener("keydown", function (event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleSun();
  }
});

ctlCamera.addEventListener("click", function () {
  camEnabled = !camEnabled;
  ctlCamera.classList.toggle("active", camEnabled);
  ctlCamera.setAttribute("aria-pressed", String(camEnabled));
});

ctlOrbits.addEventListener("click", function () {
  document.body.classList.toggle("orbits-on");
  ctlOrbits.classList.toggle("active");
  ctlOrbits.setAttribute("aria-pressed", String(document.body.classList.contains("orbits-on")));
});

ctlLabels.addEventListener("click", function () {
  document.body.classList.toggle("labels-on");
  ctlLabels.classList.toggle("active");
  ctlLabels.setAttribute("aria-pressed", String(document.body.classList.contains("labels-on")));
});

ctlRotate.addEventListener("click", function () {
  autoRotate = !autoRotate;
  ctlRotate.classList.toggle("active", autoRotate);
  ctlRotate.setAttribute("aria-pressed", String(autoRotate));
});

ctlExplorer.addEventListener("click", function () {
  explorerMode = !explorerMode;
  ctlExplorer.classList.toggle("active", explorerMode);
  ctlExplorer.setAttribute("aria-pressed", String(explorerMode));
  if (reducedMotion) {
    night = explorerMode ? 1 : 0;
    applyEnv();
    render(0, 0);
  }
});

/* ---------- Animation loop ---------- */

function frame(time) {
  if (lastTime === null) lastTime = time;
  const dt = Math.min(100, time - lastTime);
  lastTime = time;
  const dtSec = dt / 1000;

  step(dtSec);

  const damp = 1 - Math.exp(-dt / 450);
  night += ((explorerMode ? 1 : 0) - night) * damp;
  if (camEnabled) {
    camYaw += (camYawTarget - camYaw) * damp;
    camPitch += (camPitchTarget - camPitch) * damp;
  }
  if (autoRotate) autoYaw += dtSec * 0.05;
  parX += (parTX - parX) * damp;
  parY += (parTY - parY) * damp;

  const orbiting = state !== STATE.ABSENT && state !== STATE.RESTORING;
  for (const p of planets) {
    if (orbiting) p.angle += p.speed * p.dir * dtSec;
    p.selfAngle += p.selfRot * dtSec;
  }

  applyEnv();
  world.style.transform =
    "translate3d(" + (parX * 12).toFixed(2) + "px," + (parY * 10).toFixed(2) + "px,0)";
  render(camYaw + autoYaw, camPitch);

  rafId = requestAnimationFrame(frame);
}

/* ---------- Pointer interaction ---------- */

window.addEventListener("pointermove", function (event) {
  const nx = event.clientX / window.innerWidth - 0.5;
  const ny = event.clientY / window.innerHeight - 0.5;
  parTX = nx;
  parTY = ny;
  camYawTarget = nx * 0.55;
  camPitchTarget = ny * 0.34;
}, { passive: true });

planets.forEach(function (p) {
  p.el.addEventListener("pointerenter", function () {
    hoverIndex = p.index;
    tooltipName.textContent = p.name;
    tooltipInfo.innerHTML =
      "Distance: " + p.info.distance + "<br>" +
      "Diameter: " + p.info.size + "<br>" +
      "Orbital period: " + p.info.period;
    tooltip.setAttribute("aria-hidden", "false");
  });

  p.el.addEventListener("pointerleave", function () {
    hoverIndex = -1;
    tooltip.classList.remove("show");
    tooltip.setAttribute("aria-hidden", "true");
  });

  p.el.addEventListener("click", function (event) {
    event.stopPropagation();
    selectedIndex = selectedIndex === p.index ? -1 : p.index;
    planets.forEach(function (q) {
      q.el.classList.toggle("selected", q.index === selectedIndex);
    });
  });
});

document.addEventListener("pointerdown", function () {
  if (selectedIndex !== -1) {
    selectedIndex = -1;
    planets.forEach(function (q) {
      q.el.classList.remove("selected");
    });
  }
});

/* ---------- Resize ---------- */

let resizeTimer = null;
window.addEventListener("resize", function () {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    computeScale();
    buildOrbits();
    setSvgSize();
    buildStars();
  }, 200);
});

/* ---------- Start ---------- */

applyEnv();
computeScale();
buildOrbits();
setSvgSize();
buildStars();
render(0, 0);
updateSunUI();
updateStatus();

if (!reducedMotion) {
  rafId = requestAnimationFrame(frame);
}
