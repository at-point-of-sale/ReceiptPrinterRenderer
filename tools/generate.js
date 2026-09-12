import fs from 'node:fs';
import {stringify} from 'javascript-stringify';

import Rasterizer from './rasterize.js';
import {boxGlyph, BOX_DRAWING} from './box-drawing.js';
import {usedCodepoints, REPLACEMENT_CHARACTER} from './codepoints.js';

/*
    Generates the packed resources in generated/ from the sources in data/:

    - generated/mapping.js    codepage mappings from data/mappings, the same
                              text format and output as ReceiptPrinterEncoder
    - generated/profiles.js   printer profiles from data/profiles
    - generated/fonts.js      packed glyph bitmaps, rasterized from the outline
                              font in data/fonts, added together with the painter

    See documentation/design.md for the formats.
*/

/**
 * The contents of generated/mapping.js, the codepage mappings per language
 *
 * @return {string}   The source of the module
 */
function generateMappings() {
  let output = 'const codepageMappings = {\n';

  for (const language of fs.readdirSync('data/mappings').sort()) {
    output += `\t'${language}': {\n`;

    for (const file of fs.readdirSync('data/mappings/' + language).sort()) {
      if (!file.endsWith('.txt')) {
        continue;
      }

      const lines = fs.readFileSync(`data/mappings/${language}/${file}`, 'utf8').split('\n');
      const name = file.replace(/\.txt$/, '').replace(/-legacy/g, '/legacy');
      const list = new Map();

      for (const line of lines) {
        if (line.length > 1 && line.charAt(0) != '#') {
          const [, key, value] = line.split(/\t/);
          list.set(parseInt(key, 16), value.trim());
        }
      }

      const mapping = new Array(Math.max(...list.keys()) + 1);

      for (const [key, value] of list) {
        mapping[key] = value;
      }

      output += `\t\t'${name}': ${stringify(mapping)},\n`;
    }

    output += '\t},\n';
  }

  output += '};\n\n';
  output += 'codepageMappings[\'esc-pos\'][\'zijang\'] = codepageMappings[\'esc-pos\'][\'pos-5890\'];\n\n';
  output += 'export default codepageMappings;\n';

  return output;
}

/**
 * The contents of generated/profiles.js, the defaults per printer family
 *
 * @return {string}   The source of the module
 */
function generateProfiles() {
  let output = 'const printerProfiles = {\n';

  for (const file of fs.readdirSync('data/profiles').sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }

    const definition = JSON.parse(fs.readFileSync('data/profiles/' + file, 'utf8'));
    output += `\t'${file.replace(/\.json$/, '')}': ${stringify(definition)},\n`;
  }

  output += '};\n\n';
  output += 'export default printerProfiles;\n';

  return output;
}

/*
    Packed font format, generated/fonts.js:

        {
          '12x24': {
            width: 12,            cell width in dots
            height: 24,           cell height in dots
            fallback: 0,          glyph number used for code points without a glyph
            index: {32: 1, ...},  code point to glyph number
            data: 'base64'        all glyphs, one after the other
          },
          '8x16': { ... }
        }

    A glyph is `height` rows of Math.ceil(width / 8) bytes. The most significant
    bit of the first byte of a row is the leftmost dot, a set bit is ink, the
    bits beyond the width are zero. Glyph n starts at byte
    n * height * Math.ceil(width / 8) of the decoded data, which makes a glyph a
    Bitmap as src/bitmap.js defines it, without copying.

    Only glyphs that can ever be printed are included: every code point that
    occurs in a codepage table of the codepage encoder, plus ASCII 0x20 to 0x7E.
    The fallback glyph is U+FFFD when the font has it, and a hollow box drawn
    here when it does not.

    The glyphs are rasterized from the outline font in data/fonts, Iosevka
    Medium, subset by tools/subset-font.js. The face is monospaced, so it is
    fitted by its advance width, see tools/rasterize.js: the advance of one
    character is exactly one cell, 12 dots for font A and 8 for font B, which
    puts the em of Iosevka, whose advance is half an em, on 24 and 16 dots, and
    the baseline on row 18 of font A and row 12 of font B. Nothing is squeezed
    horizontally, so the rhythm of the face survives dot for dot.
*/

/* The outline font the glyphs are rasterized from */

const SOURCE = 'data/fonts/iosevka-medium-subset.ttf';

/*
    The fraction of a dot the outline has to cover for the dot to be ink. This
    is the value for Iosevka Medium at these sizes: well under a half, which is
    dot gain, the way the heat of a thermal head bleeds into the dots around a
    stem. A higher value thins the face until the light strokes of a `%` break,
    a lower one closes the counters of `a` and `e`.
*/

const INK_THRESHOLD = 0.45;

/* Samples per dot on each axis when the coverage of a dot is measured */

const SAMPLES = 8;

/* The fonts that are packed, in the order they appear in the output, with the
   cell they are drawn in and the row their baseline sits on */

const FONTS = [
  {name: '12x24', width: 12, height: 24, baseline: 18},
  {name: '8x16', width: 8, height: 16, baseline: 12},
];

/*
    The box drawing and block characters, U+2500 to U+259F, are not taken from
    the outline font, they are drawn on the dot grid by tools/box-drawing.js,
    which says why. A code point in that range that it does not draw falls back
    to the glyph of the font, at the size of the face and clipped by the cell
    instead of squeezed to fit it, so that at least those land on the same dots
    as each other.
*/

/**
 * Draw a hollow box, the fallback glyph for a font without U+FFFD
 *
 * @param  {object}       font   Cell of the font
 * @return {Uint8Array}          Packed rows of the cell
 */
function packFallback(font) {
  const rowBytes = Math.ceil(font.width / 8);
  const cell = new Uint8Array(font.height * rowBytes);

  const left = 1;
  const right = font.width - 2;
  const top = Math.round(font.height / 6);
  const bottom = font.height - 1 - Math.round(font.height / 4);

  const dot = (x, y) => cell[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);

  for (let x = left; x <= right; x++) {
    dot(x, top);
    dot(x, bottom);
  }

  for (let y = top; y <= bottom; y++) {
    dot(left, y);
    dot(right, y);
  }

  return cell;
}

/**
 * Rasterize the outline font in data/fonts into the format documented above
 *
 * @return {string}   Contents of generated/fonts.js
 */
function generateFonts() {
  const codepoints = usedCodepoints();
  const rasterizer = new Rasterizer(SOURCE);

  let output = 'const fonts = {\n';

  for (const font of FONTS) {
    const metrics = rasterizer.metrics(font);

    const box = (codepoint) => codepoint >= BOX_DRAWING.first && codepoint <= BOX_DRAWING.last;

    const draw = (codepoint) => (box(codepoint) ? boxGlyph(codepoint, font.width, font.height) : null) ||
      rasterizer.glyph(codepoint, font, metrics, {
        threshold: INK_THRESHOLD,
        samples: SAMPLES,
        squeeze: !box(codepoint),
      });

    /* Glyph 0 is the fallback, the rest follows in code point order */

    const fallback = draw(REPLACEMENT_CHARACTER) || packFallback(font);

    const cells = [fallback];
    const index = {};

    for (const codepoint of codepoints) {
      if (codepoint === REPLACEMENT_CHARACTER) {
        continue;
      }

      const cell = draw(codepoint);

      if (!cell) {
        continue;
      }

      index[codepoint] = cells.length;
      cells.push(cell);
    }

    index[REPLACEMENT_CHARACTER] = 0;

    const data = Buffer.concat(cells).toString('base64');

    process.stdout.write(
        `${font.name}: ${cells.length} glyphs of ${codepoints.length} code points, ` +
        `em ${metrics.size} dots, cap ${metrics.cap}, descender ${metrics.descender}\n`,
    );

    output += `\t'${font.name}': {\n`;
    output += `\t\twidth: ${font.width},\n`;
    output += `\t\theight: ${font.height},\n`;
    output += '\t\tfallback: 0,\n';
    output += `\t\tindex: ${JSON.stringify(index)},\n`;
    output += `\t\tdata: '${data}',\n`;
    output += '\t},\n';
  }

  output += '};\n\n';
  output += 'export default fonts;\n';

  return output;
}

fs.mkdirSync('generated', {recursive: true});
fs.writeFileSync('generated/mapping.js', generateMappings());
fs.writeFileSync('generated/profiles.js', generateProfiles());
fs.writeFileSync('generated/fonts.js', generateFonts());
