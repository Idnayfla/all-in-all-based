/**
 * Based Brand Font Generator
 * Generates a pixel/bitmap OTF font using opentype.js
 * Each character is defined as a 6x8 pixel grid of filled square blocks
 */

import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

// Font metrics
const UNITS_PER_EM = 800;
const ASCENDER = 700;
const DESCENDER = -100;
const CELL_SIZE = 100; // each pixel block = 100 units
const ADVANCE_WIDTH = 7 * CELL_SIZE; // 700 units — generous spacing

/**
 * Pixel bitmaps — 6 columns × 8 rows
 * Row 0 = top, Row 7 = bottom
 * 1 = filled block, 0 = empty
 */
const BITMAPS = {
  // Unicode codepoint → 8-row × 6-col grid
  0x42: [
    // B
    [1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x41: [
    // A
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 0],
  ],
  0x53: [
    // S
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x45: [
    // E
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x44: [
    // D
    [1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x62: [
    // b
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x61: [
    // a
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1],
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x73: [
    // s
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x65: [
    // e
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x64: [
    // d
    [0, 0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 1],
    [0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  0x2e: [
    // .
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0],
    [0, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
};

/**
 * Build an opentype.js Path from a 6x8 bitmap.
 * Each filled cell becomes a closed square contour.
 * Font Y axis is upward; row 0 (top of glyph) = highest Y value.
 */
function bitmapToPath(bitmap) {
  const path = new opentype.Path();

  for (let row = 0; row < bitmap.length; row++) {
    for (let col = 0; col < bitmap[row].length; col++) {
      if (bitmap[row][col] === 1) {
        const x = col * CELL_SIZE;
        // Y for the top edge of this cell in font coordinates (Y up)
        const y = (7 - row) * CELL_SIZE;

        // Closed square contour — winding order: counter-clockwise (standard for filled contours)
        path.moveTo(x, y);
        path.lineTo(x + CELL_SIZE, y);
        path.lineTo(x + CELL_SIZE, y - CELL_SIZE);
        path.lineTo(x, y - CELL_SIZE);
        path.closePath();
      }
    }
  }

  return path;
}

/**
 * Build a notdef glyph — empty rectangle outline so the font is valid
 */
function makeNotdefGlyph() {
  const path = new opentype.Path();
  const margin = 50;
  const top = ASCENDER - margin;
  const bottom = DESCENDER + margin;
  const left = margin;
  const right = ADVANCE_WIDTH - margin;

  path.moveTo(left, top);
  path.lineTo(right, top);
  path.lineTo(right, bottom);
  path.lineTo(left, bottom);
  path.closePath();

  // Inner rectangle (counter-clockwise for hole)
  const inset = 80;
  path.moveTo(left + inset, top - inset);
  path.lineTo(left + inset, bottom + inset);
  path.lineTo(right - inset, bottom + inset);
  path.lineTo(right - inset, top - inset);
  path.closePath();

  return new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: ADVANCE_WIDTH,
    path,
  });
}

// Build all glyphs
const glyphs = [makeNotdefGlyph()];

for (const [codepoint, bitmap] of Object.entries(BITMAPS)) {
  const unicode = parseInt(codepoint, 10);
  const charName = String.fromCharCode(unicode);

  const path = bitmapToPath(bitmap);

  const glyph = new opentype.Glyph({
    name: `uni${unicode.toString(16).toUpperCase().padStart(4, '0')}`,
    unicode,
    advanceWidth: ADVANCE_WIDTH,
    path,
  });

  glyphs.push(glyph);
}

// Build the font
const font = new opentype.Font({
  familyName: 'BasedBrand',
  styleName: 'Regular',
  unitsPerEm: UNITS_PER_EM,
  ascender: ASCENDER,
  descender: DESCENDER,
  glyphs,
});

// Write the OTF file using Node.js Buffer API
const outputDir = resolve(__dirname, '..', 'public', 'fonts');
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, 'based-brand.otf');

const arrayBuffer = font.toArrayBuffer();
const buffer = Buffer.from(arrayBuffer);
writeFileSync(outputPath, buffer);

// Verify file was written
import { statSync } from 'fs';
const stats = statSync(outputPath);
console.log(`Based Brand font generated successfully.`);
console.log(`Output: ${outputPath}`);
console.log(`File size: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KB)`);
console.log(`Glyphs: ${glyphs.length} (notdef + ${glyphs.length - 1} characters)`);
