import fs from 'node:fs';
import {stringify} from 'javascript-stringify';

import Rasterizer, {pathData, INK_THRESHOLD, SAMPLES} from './rasterize.js';
import {boxGlyph, BOX_DRAWING} from './box-drawing.js';
import {usedCodepoints, REPLACEMENT_CHARACTER} from './codepoints.js';
import Font from '../src/font.js';
import trace from '../src/svg/trace.js';

/*
    Generates the packed resources in generated/ from the sources in data/:

    - generated/mapping.js    codepage mappings from data/mappings, the same
                              text format and output as ReceiptPrinterEncoder
    - generated/profiles.js   printer profiles from data/profiles
    - generated/fonts.js      packed glyph bitmaps, rasterized from the outline
                              font in data/fonts, added together with the painter
    - generated/outlines.js   the outlines of the same glyphs as path data, for
                              the SVG output
    - generated/pdf417.js     the symbol characters of PDF417 from data/pdf417,
                              one array of module patterns per cluster

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

/**
 * The contents of generated/pdf417.js, the symbol characters of PDF417.
 *
 * The source is data/pdf417/clusters.txt, which says where the table comes
 * from: three clusters of 929 patterns, a pattern being the seventeen modules
 * of one symbol character as a number, the leftmost module in bit 16. The
 * cluster of a row is its row number modulo three, so the clusters are stored
 * in that order, 0, 3 and 6.
 *
 * @return {string}   The source of the module
 */
function generatePdf417() {
  const lines = fs.readFileSync('data/pdf417/clusters.txt', 'utf8').split('\n');
  const clusters = [];

  for (const line of lines) {
    const text = line.trim();

    if (text.length === 0 || text.charAt(0) === '#') {
      continue;
    }

    if (text.startsWith('cluster ')) {
      clusters.push([]);
      continue;
    }

    for (const value of text.split(/\s+/)) {
      clusters[clusters.length - 1].push(parseInt(value, 16));
    }
  }

  let output = 'const pdf417Clusters = [\n';

  for (const cluster of clusters) {
    output += `\t${stringify(cluster)},\n`;
  }

  output += '];\n\n';
  output += 'export default pdf417Clusters;\n';

  process.stdout.write(
      `pdf417: ${clusters.length} clusters of ${clusters.map((c) => c.length).join(', ')} symbol characters\n`,
  );

  return output;
}

/*
    Packed font format, generated/fonts.js:

        {
          '12x24': {
            width: 12,            cell width in dots
            height: 24,           cell height in dots
            baseline: 18,         row of the cell the glyphs stand on
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

/*
    Outline format, generated/outlines.js:

        {
          version: 1,
          cell: {width: 12, height: 24},   the cell the glyph paths are drawn in
          baseline: 18,                    row of that cell the glyphs stand on
          units: 10,                       path units per dot in glyphs and glyphsB
          glyphs: {65: 'M...Z', ...},      font A, by code point
          glyphsB: {...},                  font B, only where it is not two thirds of font A
          box: {'12x24': {9472: 'M...Z'},  the box drawing glyphs per cell, in whole dots
                '9x17': {...}, '9x24': {...}},
          fallback: 65533,                 the code point of the glyph drawn for the rest
        }

    A glyph path of `glyphs` and `glyphsB` is absolute M, L, Q, C and Z, in the
    frame of the cell with y pointing down, in units of a tenth of a dot, so it
    is placed under `scale(.1)`. A C stands only where a curve of the face is
    not a quadratic one to within a tenth of a dot, see tools/rasterize.js;
    there is none in the face of today, so these paths are M, L, Q and Z.
    A box path is M, Z and the relative h and v of the rectangles the tracer
    emits, in whole dots, and nothing else. The command letter is left out
    where it repeats, in both. The fill rule is nonzero, the rule TrueType is
    drawn with.

    A path may be the empty string, which the carriage return, the space and the
    no break space are: test a code point with `codepoint in glyphs`, not with
    the truth of what comes out.

    A path is not clipped by its cell and the bitmap of a glyph is. 93 of the
    glyphs of the face paint outside the 12 by 24 cell, five of them wholly,
    the combining accents a monospaced face gives no advance; a consumer clips
    every glyph to its cell, which is what the bitmap does for the printer.

    A glyph path is the same set of placed contours the bitmap of the glyph was
    filled from, see tools/rasterize.js: the advance of the face is one cell
    wide, the baseline sits on row 18, and a glyph that is taller than the cell
    is squeezed vertically by itself. The curves of the face are kept as they
    are, so an outline scales where the bitmap does not.

    `glyphs` holds an entry for every code point of tools/codepoints.js the face
    has, outside the box drawing range; a code point without an entry is drawn
    with the glyph of `fallback`, as the packed font does. Font B is fitted into
    its own 8 by 16 cell by its own metrics, which comes out as exactly two
    thirds of font A for every glyph whose vertical squeeze is the same in both
    cells; `glyphsB` holds the ones where it does not, in the frame of the 8 by
    16 cell and in the same units, and is empty while the two cells agree.

    `box` holds the box drawing and block characters, U+2500 to U+259F, which
    are not outlines at all: they are drawn on the dot grid, stretched to the
    edges of the cell by the painter, and differ per cell size, so they are
    traced out of the rendered cell of the packed font by src/svg/trace.js, in
    whole dots. The three cells are the ones the profiles use: 12 by 24 for font
    A, and 9 by 17 and 9 by 24 for font B.
*/

/* The outline font the glyphs are rasterized from */

const SOURCE = 'data/fonts/iosevka-medium-subset.ttf';

/* The fonts that are packed, in the order they appear in the output, with the
   cell they are drawn in and the row their baseline sits on */

const FONTS = [
  {name: '12x24', width: 12, height: 24, baseline: 18},
  {name: '8x16', width: 8, height: 16, baseline: 12},
];

/*
    Path units per dot in the glyph outlines. A tenth of a dot is finer than a
    printer can show and finer than the eighth of a dot the rasterizer samples
    at, and it keeps the file small.

    It is not fine enough to give the packed glyph back exactly when a path is
    filled again with the coverage rule below: that rule is a threshold, so a
    dot at the edge of a stroke sits on a knife edge and a stem that moves by
    half a unit takes a handful of dots with it. That is on purpose. The bitmap
    font is going to be tweaked by hand on the dot grid and drift from the face
    anyway, so the outlines are drawn to sit on the bitmaps, not to reproduce
    them; test/outlines.js fills every path again and reports what it costs.
*/

const OUTLINE_UNITS = 10;

/* The cells the outlines of the box drawing characters are traced for, with the
   font a printer draws them with: font A in its 12 by 24 cell, font B in the 9
   by 17 cell of an Epson and the 9 by 24 cell of a Star */

const OUTLINE_CELLS = [
  {name: '12x24', font: '12x24', width: 12, height: 24},
  {name: '9x17', font: '8x16', width: 9, height: 17},
  {name: '9x24', font: '8x16', width: 9, height: 24},
];

/* Font B is font A at two thirds, and keeps an outline of its own only when its
   contours are further than this from that, in dots */

const FONT_B_SCALE = 2 / 3;
const FONT_B_TOLERANCE = 0.01;

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
 * @param  {Rasterizer}   rasterizer   The outline font
 * @param  {number[]}     codepoints   The code points to draw
 * @return {object}                    The source of generated/fonts.js and the packed fonts themselves
 */
function generateFonts(rasterizer, codepoints) {
  const packed = {};

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
    output += `\t\tbaseline: ${font.baseline},\n`;
    output += '\t\tfallback: 0,\n';
    output += `\t\tindex: ${JSON.stringify(index)},\n`;
    output += `\t\tdata: '${data}',\n`;
    output += '\t},\n';

    packed[font.name] = {
      width: font.width,
      height: font.height,
      baseline: font.baseline,
      fallback: 0,
      index,
      data,
    };
  }

  output += '};\n\n';
  output += 'export default fonts;\n';

  return {output, packed};
}

/**
 * Whether two sets of placed contours are the same shape, one of them scaled
 *
 * @param  {Array}     contours    Contours as the rasterizer placed them
 * @param  {Array}     reference   Contours to compare them with
 * @param  {number}    scale       Factor the reference is scaled by first
 * @param  {number}    tolerance   How far a coordinate may be off, in dots
 * @return {boolean}               True when every coordinate agrees
 */
function sameContours(contours, reference, scale, tolerance) {
  if (contours.length !== reference.length) {
    return false;
  }

  for (let contour = 0; contour < contours.length; contour++) {
    if (contours[contour].length !== reference[contour].length) {
      return false;
    }

    for (let index = 0; index < contours[contour].length; index++) {
      const command = contours[contour][index];
      const other = reference[contour][index];

      if (command.type !== other.type) {
        return false;
      }

      for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
        if (command.type === 'Z') {
          continue;
        }

        if (Math.abs(command[key] - other[key] * scale) > tolerance) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * The outlines of the glyphs of the packed fonts, in the format documented
 * above: the same placed contours the bitmaps were filled from, written out as
 * path data, and the box drawing characters traced out of their rendered cells
 *
 * @param  {Rasterizer}   rasterizer   The outline font
 * @param  {number[]}     codepoints   The code points to draw
 * @param  {object}       packed       The packed fonts, as generateFonts made them
 * @return {string}                    Contents of generated/outlines.js
 */
function generateOutlines(rasterizer, codepoints, packed) {
  const [cellA, cellB] = FONTS;

  const metricsA = rasterizer.metrics(cellA);
  const metricsB = rasterizer.metrics(cellB);

  const boxed = (codepoint) => codepoint >= BOX_DRAWING.first && codepoint <= BOX_DRAWING.last;

  const glyphs = {};
  const glyphsB = {};

  /* The fallback glyph as well, which is not always one of the code points a
     codepage can reach */

  const list = [...new Set([...codepoints, REPLACEMENT_CHARACTER])].sort((a, b) => a - b);

  for (const codepoint of list) {
    if (boxed(codepoint)) {
      continue;
    }

    const contoursA = rasterizer.contours(codepoint, cellA, metricsA, {squeeze: true});

    if (!contoursA) {
      /* The face has no glyph for this code point, and neither has the packed
         font: a printer draws the fallback glyph for it */

      continue;
    }

    glyphs[codepoint] = pathData(contoursA, OUTLINE_UNITS);

    const contoursB = rasterizer.contours(codepoint, cellB, metricsB, {squeeze: true});

    if (!sameContours(contoursB, contoursA, FONT_B_SCALE, FONT_B_TOLERANCE)) {
      glyphsB[codepoint] = pathData(contoursB, OUTLINE_UNITS);
    }
  }

  /* A font without U+FFFD draws a hollow box, which is dots and not an outline,
     so it is traced like a box drawing character, in the units of the glyphs */

  if (!rasterizer.has(REPLACEMENT_CHARACTER)) {
    glyphs[REPLACEMENT_CHARACTER] = trace(
        {width: cellA.width, height: cellA.height, data: packFallback(cellA)},
        OUTLINE_UNITS,
    );

    glyphsB[REPLACEMENT_CHARACTER] = trace(
        {width: cellB.width, height: cellB.height, data: packFallback(cellB)},
        OUTLINE_UNITS,
    );
  }

  /* The box drawing characters are drawn on the dot grid and stretched to the
     edges of the cell by the painter, so they are traced out of the cell the
     painter renders, per cell size */

  const box = {};

  for (const cell of OUTLINE_CELLS) {
    const font = new Font(packed[cell.font]);
    const paths = {};

    for (const codepoint of codepoints) {
      if (!boxed(codepoint)) {
        continue;
      }

      const bitmap = font.renderGlyph(font.lookup(codepoint), {
        cellWidth: cell.width,
        cellHeight: cell.height,
        stretch: true,
      });

      paths[codepoint] = trace(bitmap);
    }

    box[cell.name] = paths;
  }

  let output = 'const outlines = {\n';

  output += '\tversion: 1,\n';
  output += `\tcell: {width: ${cellA.width}, height: ${cellA.height}},\n`;
  output += `\tbaseline: ${cellA.baseline},\n`;
  output += `\tunits: ${OUTLINE_UNITS},\n`;
  output += `\tglyphs: ${JSON.stringify(glyphs)},\n`;
  output += `\tglyphsB: ${JSON.stringify(glyphsB)},\n`;
  output += '\tbox: {\n';

  for (const cell of OUTLINE_CELLS) {
    output += `\t\t'${cell.name}': ${JSON.stringify(box[cell.name])},\n`;
  }

  output += '\t},\n';
  output += `\tfallback: ${REPLACEMENT_CHARACTER},\n`;
  output += '};\n\n';
  output += 'export default outlines;\n';

  process.stdout.write(
      `outlines: ${Object.keys(glyphs).length} glyphs, ${Object.keys(glyphsB).length} of them refitted for font B, ` +
      `${Object.keys(box[OUTLINE_CELLS[0].name]).length} box drawing characters in ` +
      `${OUTLINE_CELLS.length} cells, ${Math.round(output.length / 1000)} kB\n`,
  );

  return output;
}

const rasterizer = new Rasterizer(SOURCE);
const codepoints = usedCodepoints();
const fonts = generateFonts(rasterizer, codepoints);

fs.mkdirSync('generated', {recursive: true});
fs.writeFileSync('generated/mapping.js', generateMappings());
fs.writeFileSync('generated/profiles.js', generateProfiles());
fs.writeFileSync('generated/pdf417.js', generatePdf417());
fs.writeFileSync('generated/fonts.js', fonts.output);
fs.writeFileSync('generated/outlines.js', generateOutlines(rasterizer, codepoints, fonts.packed));
