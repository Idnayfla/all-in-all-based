import { writeFileSync } from 'fs';

const ACCENT = '#c9a87c';
const BG = '#08070e';
const DURATION = '2.8s';

// Hex vertices: "60,14 97,35 97,79 60,100 23,79 23,35"
// Actual perimeter (measured):
//   4 diagonal sides: sqrt(37²+21²) ≈ 42.54 each → 170.16
//   2 vertical sides: 44 each → 88
//   Total ≈ 258.16 → use 260 for safety
const PERIM = 260;

// Hex center: x=60, y=(14+100)/2=57
// B> baseline: center_y + cap_height/2 ≈ 57 + 8 = 65
// With font-size=20 monospace: char width ≈ 12px each, "B>" = 25px wide
// text-anchor=middle at x=60 → right edge ≈ 60+12.5 = 72.5
// Cursor: x=74, y=51 (top of cap), height=14
const TEXT_Y = 65;
const CURSOR_X = 74;
const CURSOR_Y = 51;
const CURSOR_H = 14;

// ── Animated brand icon ───────────────────────────────────────────────────────
const animatedSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="bound"><rect width="120" height="120" rx="24"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="120" height="120" fill="${BG}" rx="24"/>

  <!-- Outer ring pulse -->
  <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(201,168,124,0.06)" stroke-width="1">
    <animate attributeName="r" values="54;56;54" dur="${DURATION}" repeatCount="indefinite"
      calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"/>
    <animate attributeName="opacity"
      values="0;0;0.4;0.8;0.8;0.4;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.05;0.25;0.4;0.75;0.9;1"/>
  </circle>

  <!-- Hex fill bloom -->
  <polygon points="60,22 91,39.5 91,74.5 60,92 29,74.5 29,39.5"
    fill="rgba(201,168,124,0.07)" opacity="0">
    <animate attributeName="opacity"
      values="0;0;0;0.6;1;1;0.6;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.1;0.35;0.45;0.5;0.78;0.9;1"/>
  </polygon>

  <!-- Hex outline — draws itself, full perimeter = ${PERIM} -->
  <polygon points="60,14 97,35 97,79 60,100 23,79 23,35"
    fill="none" stroke="${ACCENT}" stroke-width="2.5" filter="url(#glow)"
    stroke-dasharray="${PERIM}" stroke-dashoffset="${PERIM}" stroke-linejoin="round">
    <animate attributeName="stroke-dashoffset"
      values="${PERIM};0;0;${PERIM}"
      dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.38;0.85;1"
      calcMode="spline"
      keySplines="0.25 0.46 0.45 0.94;0 0 1 1;0.55 0 1 0.45"/>
    <animate attributeName="opacity"
      values="0;0.4;1;1;1;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.05;0.25;0.38;0.85;1"/>
  </polygon>

  <!-- Scan line sweeps through the hex -->
  <line x1="20" y1="14" x2="100" y2="14"
    stroke="rgba(201,168,124,0.22)" stroke-width="1" opacity="0"
    clip-path="url(#bound)">
    <animate attributeName="y1" values="14;100" dur="${DURATION}" repeatCount="indefinite"/>
    <animate attributeName="y2" values="14;100" dur="${DURATION}" repeatCount="indefinite"/>
    <animate attributeName="opacity"
      values="0;0;0.4;0.3;0;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.3;0.4;0.6;0.7;1"/>
  </line>

  <!-- Corner dot blinks on as outline completes -->
  <circle cx="97" cy="35" r="3" fill="${ACCENT}" filter="url(#glow)" opacity="0">
    <animate attributeName="opacity"
      values="0;0;0;1;0.6;1;0.6;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.3;0.36;0.4;0.5;0.6;0.85;1"/>
  </circle>

  <!-- B> centered in hex (center=60,57 → baseline at y=${TEXT_Y}) -->
  <text x="60" y="${TEXT_Y}" text-anchor="middle"
    font-family="'Space Mono','Courier New',monospace" font-weight="700" font-size="20"
    fill="${ACCENT}" filter="url(#glow)" opacity="0" letter-spacing="1">
    B&gt;
    <animate attributeName="opacity"
      values="0;0;0;0;1;0.6;1;0.8;1;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.3;0.38;0.42;0.46;0.5;0.54;0.58;0.85;1"/>
  </text>

  <!-- Cursor blink -->
  <rect x="${CURSOR_X}" y="${CURSOR_Y}" width="2" height="${CURSOR_H}"
    fill="${ACCENT}" opacity="0">
    <animate attributeName="opacity"
      values="0;0;0;0;1;0;1;0;1;0;1;0" dur="${DURATION}" repeatCount="indefinite"
      keyTimes="0;0.42;0.46;0.5;0.55;0.6;0.65;0.7;0.75;0.8;0.85;1"/>
  </rect>
</svg>`;

writeFileSync('public/brand-icon-animated.svg', animatedSVG);
console.log('Brand icon   → public/brand-icon-animated.svg');

// ── Loading spinner ────────────────────────────────────────────────────────────
// Rotating arc along the hex perimeter + pulsing center dot
const SPIN_DURATION = '1.6s';
const ARC = Math.round(PERIM * 0.28); // lit arc length ≈ 28% of perimeter
const GAP = PERIM - ARC; // dark gap

const loadingSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <filter id="lglow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="arcfade" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="1"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="120" height="120" fill="${BG}" rx="24"/>

  <!-- Dim hex track -->
  <polygon points="60,14 97,35 97,79 60,100 23,79 23,35"
    fill="none" stroke="rgba(201,168,124,0.12)" stroke-width="2" stroke-linejoin="round"/>

  <!-- Rotating arc: animates stroke-dashoffset from 0 → -${PERIM} (one full loop) -->
  <polygon points="60,14 97,35 97,79 60,100 23,79 23,35"
    fill="none" stroke="${ACCENT}" stroke-width="3"
    stroke-dasharray="${ARC} ${GAP}"
    stroke-dashoffset="0"
    stroke-linejoin="round"
    filter="url(#lglow)">
    <animate attributeName="stroke-dashoffset"
      from="0" to="-${PERIM}"
      dur="${SPIN_DURATION}" repeatCount="indefinite"
      calcMode="linear"/>
  </polygon>

  <!-- Trailing fade: slightly larger dash that's dimmer, offset back by ~20 units -->
  <polygon points="60,14 97,35 97,79 60,100 23,79 23,35"
    fill="none" stroke="${ACCENT}" stroke-width="5"
    stroke-dasharray="${Math.round(ARC * 0.6)} ${PERIM - Math.round(ARC * 0.6)}"
    stroke-dashoffset="${Math.round(ARC * 0.4)}"
    stroke-linejoin="round"
    opacity="0.25">
    <animate attributeName="stroke-dashoffset"
      from="${Math.round(ARC * 0.4)}" to="${Math.round(ARC * 0.4) - PERIM}"
      dur="${SPIN_DURATION}" repeatCount="indefinite"
      calcMode="linear"/>
  </polygon>

  <!-- Pulsing center dot -->
  <circle cx="60" cy="57" r="3" fill="${ACCENT}" filter="url(#lglow)">
    <animate attributeName="r" values="2;4;2" dur="${SPIN_DURATION}" repeatCount="indefinite"
      calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"/>
    <animate attributeName="opacity" values="0.5;1;0.5" dur="${SPIN_DURATION}" repeatCount="indefinite"
      calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"/>
  </circle>
</svg>`;

writeFileSync('public/brand-icon-loading.svg', loadingSVG);
console.log('Loading spin → public/brand-icon-loading.svg');

// ── Storyboard ────────────────────────────────────────────────────────────────
const FRAMES = [
  { label: 'f1 · blank', dashOffset: PERIM, hexOp: 0, fillOp: 0, textOp: 0, dotOp: 0 },
  {
    label: 'f2 · 25%',
    dashOffset: Math.round(PERIM * 0.75),
    hexOp: 0.6,
    fillOp: 0,
    textOp: 0,
    dotOp: 0,
  },
  {
    label: 'f3 · 50%',
    dashOffset: Math.round(PERIM * 0.5),
    hexOp: 0.8,
    fillOp: 0,
    textOp: 0,
    dotOp: 0,
  },
  {
    label: 'f4 · 75%',
    dashOffset: Math.round(PERIM * 0.25),
    hexOp: 1,
    fillOp: 0.3,
    textOp: 0,
    dotOp: 0,
  },
  { label: 'f5 · complete', dashOffset: 0, hexOp: 1, fillOp: 0.7, textOp: 0, dotOp: 1 },
  { label: 'f6 · text in', dashOffset: 0, hexOp: 1, fillOp: 1, textOp: 0.7, dotOp: 1 },
  { label: 'f7 · hold', dashOffset: 0, hexOp: 1, fillOp: 1, textOp: 1, dotOp: 1 },
  { label: 'f8 · fade out', dashOffset: 0, hexOp: 0.3, fillOp: 0.2, textOp: 0.2, dotOp: 0 },
];

const FW = 130;
const FPAD = 16;
const totalW = FRAMES.length * (FW + FPAD) + FPAD;
const totalH = 180;

let frames = '';
FRAMES.forEach((f, i) => {
  const ox = FPAD + i * (FW + FPAD);
  const oy = FPAD;
  const sc = (FW / 120).toFixed(3);

  frames += `<g transform="translate(${ox},${oy})">`;
  frames += `<rect width="${FW}" height="120" fill="#08070e" rx="14"/>`;
  frames += `<rect width="${FW}" height="120" rx="14" fill="none" stroke="rgba(201,168,124,0.15)" stroke-width="1"/>`;
  frames += `<g transform="scale(${sc})">`;
  frames += `<polygon points="60,22 91,39.5 91,74.5 60,92 29,74.5 29,39.5" fill="rgba(201,168,124,0.08)" opacity="${f.fillOp}"/>`;
  frames += `<polygon points="60,14 97,35 97,79 60,100 23,79 23,35" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-dasharray="${PERIM}" stroke-dashoffset="${f.dashOffset}" stroke-linejoin="round" opacity="${f.hexOp}"/>`;
  frames += `<circle cx="97" cy="35" r="3" fill="${ACCENT}" opacity="${f.dotOp}"/>`;
  if (f.textOp > 0) {
    frames += `<text x="60" y="${TEXT_Y}" text-anchor="middle" font-family="monospace" font-weight="700" font-size="20" fill="${ACCENT}" opacity="${f.textOp}" letter-spacing="1">B&gt;</text>`;
    frames += `<rect x="${CURSOR_X}" y="${CURSOR_Y}" width="2" height="${CURSOR_H}" fill="${ACCENT}" opacity="${f.textOp}"/>`;
  }
  frames += `</g>`;
  frames += `<text x="${FW / 2}" y="142" text-anchor="middle" font-family="monospace" font-size="8.5" fill="rgba(237,232,208,0.4)">${f.label}</text>`;
  frames += `</g>`;
});

const storyboard = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
  <rect width="100%" height="100%" fill="#050409"/>
  ${frames}
</svg>`;

writeFileSync('public/brand-frames-preview.svg', storyboard);
console.log('Storyboard   → public/brand-frames-preview.svg');
