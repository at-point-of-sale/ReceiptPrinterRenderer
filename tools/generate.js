import fs from 'node:fs';
import {stringify} from 'javascript-stringify';
import CodepageEncoder from '@point-of-sale/codepage-encoder';

/*
    Generates the packed resources in generated/ from the sources in data/:

    - generated/mapping.js    codepage mappings from data/mappings, the same
                              text format and output as ReceiptPrinterEncoder
    - generated/profiles.js   printer profiles from data/profiles
    - generated/fonts.js      packed glyph bitmaps from the BDF fonts in
                              data/fonts, added together with the painter

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

    Spleen 12x24 has fewer glyphs than Spleen 8x16, it misses the Greek and
    mathematical tail of cp437 among others. A font with a `borrow` font takes
    the glyphs it does not have from that font, centred in its own cell, so that
    font A prints the same characters as font B instead of a row of fallback
    boxes.
*/

/* The fonts that are packed, in the order they appear in the output */

const FONTS = [
  {name: '12x24', file: 'data/fonts/spleen-12x24.bdf', borrow: '8x16'},
  {name: '8x16', file: 'data/fonts/spleen-8x16.bdf'},
];

const REPLACEMENT_CHARACTER = 0xfffd;

/**
 * Parse a BDF font into its bounding box and its glyphs
 *
 * @param  {string}   source   Contents of the BDF file
 * @return {object}            Bounding box of the font and a map of code point to glyph
 */
function parseBdf(source) {
  const font = {width: 0, height: 0, x: 0, y: 0, glyphs: new Map()};

  let codepoint = null;
  let box = null;
  let rows = null;

  for (const line of source.split('\n')) {
    const value = line.trim();

    if (value.startsWith('FONTBOUNDINGBOX ')) {
      const [width, height, x, y] = value.split(/\s+/).slice(1).map(Number);
      Object.assign(font, {width, height, x, y});
    } else if (value.startsWith('ENCODING ')) {
      codepoint = parseInt(value.slice(9), 10);
    } else if (value.startsWith('BBX ')) {
      box = value.split(/\s+/).slice(1).map(Number);
    } else if (value === 'BITMAP') {
      rows = [];
    } else if (value.startsWith('STARTCHAR')) {
      codepoint = null;
      box = null;
      rows = null;
    } else if (value === 'ENDCHAR') {
      /* A character without an ENCODING, or without a bitmap, is not a glyph */

      if (rows && box && codepoint !== null && codepoint >= 0) {
        font.glyphs.set(codepoint, {box, rows});
      }

      codepoint = null;
      box = null;
      rows = null;
    } else if (rows) {
      rows.push(value);
    }
  }

  return font;
}

/**
 * Pack one BDF glyph into the rows of the font cell
 *
 * @param  {object}       font    Font as parseBdf returned it
 * @param  {object}       glyph   One glyph of that font
 * @return {Uint8Array}           Packed rows of the cell
 */
function packGlyph(font, glyph) {
  const rowBytes = Math.ceil(font.width / 8);
  const cell = new Uint8Array(font.height * rowBytes);

  const [width, height, x, y] = glyph.box;

  /* The BDF origin is the baseline, the cell origin is the top left corner */

  const top = font.y + font.height - (y + height);
  const left = x - font.x;

  for (let row = 0; row < height; row++) {
    const target = top + row;

    if (target < 0 || target >= font.height) {
      continue;
    }

    const bits = glyph.rows[row];

    for (let column = 0; column < width; column++) {
      const byte = parseInt(bits.substr((column >> 3) * 2, 2), 16);

      if (!(byte & (0x80 >> (column & 7)))) {
        continue;
      }

      const dot = left + column;

      if (dot < 0 || dot >= font.width) {
        continue;
      }

      cell[target * rowBytes + (dot >> 3)] |= 0x80 >> (dot & 7);
    }
  }

  return cell;
}

/**
 * Draw a glyph of another font in the cell of this font, centred, so that a
 * font can borrow the glyphs it does not have itself
 *
 * @param  {object}       font    Font that borrows the glyph
 * @param  {object}       donor   Font as parseBdf returned it, the one that has the glyph
 * @param  {object}       glyph   One glyph of the donor font
 * @return {Uint8Array}           Packed rows of the cell of the borrowing font
 */
function borrowGlyph(font, donor, glyph) {
  const source = packGlyph(donor, glyph);
  const sourceBytes = Math.ceil(donor.width / 8);

  const rowBytes = Math.ceil(font.width / 8);
  const cell = new Uint8Array(font.height * rowBytes);

  const left = Math.floor((font.width - donor.width) / 2);
  const top = Math.floor((font.height - donor.height) / 2);

  for (let row = 0; row < donor.height; row++) {
    const target = top + row;

    if (target < 0 || target >= font.height) {
      continue;
    }

    for (let column = 0; column < donor.width; column++) {
      if (!(source[row * sourceBytes + (column >> 3)] & (0x80 >> (column & 7)))) {
        continue;
      }

      const dot = left + column;

      if (dot < 0 || dot >= font.width) {
        continue;
      }

      cell[target * rowBytes + (dot >> 3)] |= 0x80 >> (dot & 7);
    }
  }

  return cell;
}

/**
 * Draw a hollow box, the fallback glyph for fonts without U+FFFD
 *
 * @param  {object}       font   Font as parseBdf returned it
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
 * Every code point that can occur in a codepage of the codepage encoder, plus
 * printable ASCII, which every codepage shares
 *
 * @return {number[]}   Sorted list of code points
 */
function usedCodepoints() {
  const used = new Set();

  for (const encoding of CodepageEncoder.getEncodings()) {
    for (const codepoint of CodepageEncoder.getCodepoints(encoding, true)) {
      if (codepoint) {
        used.add(codepoint);
      }
    }
  }

  for (let codepoint = 0x20; codepoint <= 0x7e; codepoint++) {
    used.add(codepoint);
  }

  return [...used].sort((a, b) => a - b);
}

/**
 * Pack the BDF fonts in data/fonts into the format documented above
 *
 * @return {string}   Contents of generated/fonts.js
 */
function generateFonts() {
  const codepoints = usedCodepoints();

  /* Every font is parsed first, because a font can borrow from another one */

  const parsed = new Map(FONTS.map(({name, file}) => [name, parseBdf(fs.readFileSync(file, 'utf8'))]));

  let output = 'const fonts = {\n';

  for (const {name, borrow} of FONTS) {
    const font = parsed.get(name);
    const donor = borrow ? parsed.get(borrow) : null;

    /* Glyph 0 is the fallback, the rest follows in code point order */

    const fallback = font.glyphs.has(REPLACEMENT_CHARACTER) ?
      packGlyph(font, font.glyphs.get(REPLACEMENT_CHARACTER)) :
      packFallback(font);

    const cells = [fallback];
    const index = {};

    for (const codepoint of codepoints) {
      if (codepoint === REPLACEMENT_CHARACTER) {
        continue;
      }

      let cell = null;

      if (font.glyphs.has(codepoint)) {
        cell = packGlyph(font, font.glyphs.get(codepoint));
      } else if (donor && donor.glyphs.has(codepoint)) {
        cell = borrowGlyph(font, donor, donor.glyphs.get(codepoint));
      } else {
        continue;
      }

      index[codepoint] = cells.length;
      cells.push(cell);
    }

    index[REPLACEMENT_CHARACTER] = 0;

    const data = Buffer.concat(cells).toString('base64');

    output += `\t'${name}': {\n`;
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
