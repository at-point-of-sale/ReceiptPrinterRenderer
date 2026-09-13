import {assert} from 'chai';

import outlines from '../generated/outlines.js';
import fonts from '../generated/fonts.js';
import Font from '../src/font.js';
import Bitmap from '../src/bitmap.js';
import {flatten, fill, SEGMENTS, INK_THRESHOLD, SAMPLES} from '../tools/rasterize.js';
import {usedCodepoints, REPLACEMENT_CHARACTER} from '../tools/codepoints.js';
import {BOX_DRAWING} from '../tools/box-drawing.js';

/*
    The outlines of generated/outlines.js are filled again here, with the
    flatten and the fill of tools/rasterize.js and the samples and the coverage
    threshold tools/generate.js rasterizes the bitmap fonts with, and the result
    is compared with the packed glyph the generator made in the same pass.

    The two are not expected to be equal. A path is written in whole tenths of
    a dot, so a stem lands up to a twentieth of a dot from where the rasterizer
    had it, and the fill is a coverage threshold, so a dot at the edge of a
    stroke can fall on the other side of it. The bitmap font is going to be
    tweaked by hand on the dot grid as well, and will drift from the face on
    purpose, so this is a report of how well an outline sits on its bitmap and
    not a proof that the two agree: the bound below is loose enough to say that
    a glyph is still the glyph, and the totals are printed at the end. What the
    vector output is judged on is the agreement of a whole receipt, which
    Section 4 measures with a rasterizer.
*/

/*
    The number of dots a filled outline may differ from its packed glyph by.
    The worst glyph of the two fonts, the four arrows below excepted, is 13 dots
    of the 288 of a 12 by 24 cell, so this is the round number above it: it
    catches a glyph that moved, not a dot that changed its mind at the coverage
    threshold.
*/

const TOLERANCE = 16;

/*
    The glyphs whose filled outline is not their bitmap, with the reason.

    The four vertical arrows of the face are wider than the face, so they are
    fitted by their own advance, see the fit in tools/rasterize.js. Their stem
    is 74 of the 1000 units of the em and sits on the middle of it, so in the
    cell it runs from 5.556 to 6.444 dots: 0.444 of each of the two columns it
    straddles, which is under the 0.45 the threshold asks for. It is ink all
    the same, because coverage is measured with samples and not with geometry:
    of the eight sample columns of a dot, four fall inside the stem, which is
    0.5. The path, written in whole tenths of a dot, runs from 5.6 to 6.4, and
    only three of the eight fall inside it, which is 0.375, so the stem is ink
    in the bitmap and white in the refill: the whole stem, twenty two to thirty
    four dots of it. It is the knife edge the file above describes, at its
    worst, and not a glyph that moved; the arrow head, which is what the fit
    gave these glyphs back, is in both.

    An outline is drawn at any size and a dot is a dot, so the SVG output of
    these four is a stem like any other. The bound is the round number above
    the worst of the four, as the tolerance above is for the rest, and it is
    here so that the four are named and counted rather than hidden under a
    looser tolerance for all 780.
*/

const KNIFE_EDGE = [0x2191, 0x2193, 0x2195, 0x21a8];

const KNIFE_EDGE_TOLERANCE = 40;

/* The cells of the profiles, with the font a printer draws them with */

const CELLS = [
  {name: '12x24', font: '12x24', width: 12, height: 24},
  {name: '9x17', font: '8x16', width: 9, height: 17},
  {name: '9x24', font: '8x16', width: 9, height: 24},
];

/*
    What lies outside the 12 by 24 cell. A path is not clipped and the bitmap of
    a glyph is, so a glyph whose ink leaves its cell, a combining accent that a
    font gives no advance, paints outside the cell in SVG unless the writer
    clips it, which is what Section 4 has it do. The numbers are recorded here
    so that a regeneration that moves them is visible; the list is in the notes
    of Section 3. They dropped from 93, 41 and 5 when the glyphs that are wider
    than the face, the em dash and the ellipsis among them, were fitted into the
    cell instead of clipped by it.
*/

const OUTSIDE_THE_CELL = {
  total: 59,
  far: 7,
  whole: ['U+0300', 'U+0301', 'U+0303', 'U+0309', 'U+0323'],
};

/* Font B is drawn as font A at two thirds, unless it has an outline of its own */

const FONT_B_SCALE = 2 / 3;

/* How many numbers every path command takes */

const ARITY = {M: 2, L: 2, Q: 4, C: 6, h: 1, v: 1, Z: 0};

/**
 * Parse SVG path data into contours of the commands flatten() takes, in dots.
 *
 * Absolute M, L, Q, C and Z, which the glyph paths are written with, and the
 * relative h and v of the traced box drawing characters. A command letter that
 * repeats may be left out, as it may in SVG.
 *
 * @param  {string}   data      SVG path data
 * @param  {number}   units     Path units per dot
 * @return {Array}              One array of commands per contour
 */
function parsePath(data, units) {
  const tokens = data.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) || [];

  const contours = [];

  let contour = null;
  let command = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const value = (index) => Number(tokens[index]) / units;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (/[A-Za-z]/.test(token)) {
      assert.property(ARITY, token, `unknown path command ${token}`);

      command = token;

      if (command === 'Z') {
        assert.isNotNull(contour, 'a Z outside a contour');

        contours.push(contour);
        contour = null;
        x = startX;
        y = startY;
      }

      continue;
    }

    assert.isNotNull(command, 'a number before the first command');

    /* A repeated set of numbers repeats the command, and a repeat of a move is
       a line, as it is in SVG */

    if (command === 'M' && contour && contour.length >= 1) {
      command = 'L';
    }

    const arity = ARITY[command];

    assert.isAtMost(index + arity, tokens.length, 'a command without its numbers');

    if (command === 'M') {
      assert.isNull(contour, 'a contour that was not closed');

      x = startX = value(index);
      y = startY = value(index + 1);
      contour = [{type: 'M', x, y}];
    } else {
      assert.isNotNull(contour, 'a command outside a contour');

      if (command === 'L') {
        x = value(index);
        y = value(index + 1);
        contour.push({type: 'L', x, y});
      } else if (command === 'h') {
        x += value(index);
        contour.push({type: 'L', x, y});
      } else if (command === 'v') {
        y += value(index);
        contour.push({type: 'L', x, y});
      } else if (command === 'Q') {
        contour.push({type: 'Q', x1: value(index), y1: value(index + 1), x: value(index + 2), y: value(index + 3)});
        x = value(index + 2);
        y = value(index + 3);
      } else if (command === 'C') {
        contour.push({
          type: 'C',
          x1: value(index), y1: value(index + 1),
          x2: value(index + 2), y2: value(index + 3),
          x: value(index + 4), y: value(index + 5),
        });
        x = value(index + 4);
        y = value(index + 5);
      }
    }

    index += arity - 1;
  }

  assert.isNull(contour, 'a contour that was not closed');

  return contours;
}

/**
 * Scale the contours of a path, the way the SVG writer draws font B with the
 * outline of font A
 *
 * @param  {Array}    contours   Contours as parsePath returned them
 * @param  {number}   scale      Factor to scale them by
 * @return {Array}               The scaled contours
 */
function scaleContours(contours, scale) {
  return contours.map((contour) => contour.map((command) => {
    const scaled = {type: command.type};

    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
      if (typeof command[key] === 'number') {
        scaled[key] = command[key] * scale;
      }
    }

    return scaled;
  }));
}

/**
 * Fill a path into a cell, the way the rasterizer filled the glyph
 *
 * @param  {Array}    contours   Contours as parsePath returned them
 * @param  {number}   width      Cell width in dots
 * @param  {number}   height     Cell height in dots
 * @return {object}              The cell as a bitmap
 */
function fillPath(contours, width, height) {
  return {
    width,
    height,
    data: fill(flatten(contours, SEGMENTS), width, height, SAMPLES, INK_THRESHOLD),
  };
}

/**
 * The number of dots two bitmaps of the same size differ by
 *
 * @param  {object}   one      A bitmap
 * @param  {object}   other    Another bitmap of the same size
 * @return {number}            The number of dots that differ
 */
function difference(one, other) {
  let dots = 0;

  for (let y = 0; y < one.height; y++) {
    for (let x = 0; x < one.width; x++) {
      if (Bitmap.getPixel(one, x, y) !== Bitmap.getPixel(other, x, y)) {
        dots++;
      }
    }
  }

  return dots;
}

/**
 * The box the ink of a set of contours covers, in dots
 *
 * @param  {Array}    contours   Contours as parsePath returned them
 * @return {object}              The box, or null when there is no ink
 */
function bounds(contours) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;

  for (const polygon of flatten(contours, SEGMENTS)) {
    for (const [x, y] of polygon) {
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
    }
  }

  return x1 === Infinity ? null : {x1, y1, x2, y2};
}

/**
 * A code point as U+XXXX
 *
 * @param  {number}   codepoint   Unicode code point
 * @return {string}               The code point in the usual notation
 */
function name(codepoint) {
  return 'U+' + codepoint.toString(16).toUpperCase().padStart(4, '0');
}

const codepoints = usedCodepoints();
const boxed = (codepoint) => codepoint >= BOX_DRAWING.first && codepoint <= BOX_DRAWING.last;

/* What the fill of every outline cost in dots, for the summary at the end */

const report = [];

describe('Outlines', function() {
  describe('the file', function() {
    it('should be version 1', function() {
      assert.equal(outlines.version, 1);
    });

    it('should be drawn in the cell of font A', function() {
      assert.deepEqual(outlines.cell, {width: 12, height: 24});
      assert.equal(outlines.cell.width, fonts['12x24'].width);
      assert.equal(outlines.cell.height, fonts['12x24'].height);
    });

    it('should stand on the baseline of font A', function() {
      assert.equal(outlines.baseline, 18);
      assert.equal(outlines.baseline, fonts['12x24'].baseline);
    });

    it('should be in tenths of a dot', function() {
      assert.equal(outlines.units, 10);
    });

    it('should fall back on the replacement character', function() {
      assert.equal(outlines.fallback, REPLACEMENT_CHARACTER);
      assert.property(outlines.glyphs, String(REPLACEMENT_CHARACTER));
    });

    it('should hold the three cells of the profiles', function() {
      assert.deepEqual(Object.keys(outlines.box), CELLS.map((cell) => cell.name));
    });
  });

  describe('the code points', function() {
    const font = Font.get('12x24');

    it('should have an outline or a box for every code point of the font', function() {
      const missing = codepoints.filter((codepoint) => font.has(codepoint) &&
        !(boxed(codepoint) ? outlines.box['12x24'][codepoint] !== undefined :
          outlines.glyphs[codepoint] !== undefined));

      assert.deepEqual(missing.map(name), []);
    });

    it('should have no outline for a code point the font does not have', function() {
      const extra = Object.keys(outlines.glyphs)
          .map(Number)
          .filter((codepoint) => codepoint !== REPLACEMENT_CHARACTER && !font.has(codepoint));

      assert.deepEqual(extra.map(name), []);
    });

    it('should leave the box drawing characters to the box set', function() {
      const overlap = Object.keys(outlines.glyphs).map(Number).filter(boxed);

      assert.deepEqual(overlap.map(name), []);
    });

    it('should have every box drawing character of the code points in every cell', function() {
      const wanted = codepoints.filter(boxed);

      assert.equal(wanted.length, 75);

      for (const cell of CELLS) {
        const missing = wanted.filter((codepoint) => outlines.box[cell.name][codepoint] === undefined);

        assert.deepEqual(missing.map(name), [], `in the ${cell.name} cell`);
      }
    });

    it('should hold a font B outline only for a code point that has one of font A', function() {
      const extra = Object.keys(outlines.glyphsB).filter((codepoint) => !(codepoint in outlines.glyphs));

      assert.deepEqual(extra, []);
    });
  });

  describe('the paths', function() {
    it('should parse, with a move, a close and a command the parser knows', function() {
      const paths = [
        ...Object.values(outlines.glyphs),
        ...Object.values(outlines.glyphsB),
        ...CELLS.flatMap((cell) => Object.values(outlines.box[cell.name])),
      ];

      assert.isAbove(paths.length, 700);

      for (const path of paths) {
        assert.doesNotThrow(() => parsePath(path, outlines.units), `in ${path}`);
      }
    });

    it('should read a move of more than one pair as a move and lines', function() {
      assert.deepEqual(parsePath('M0 0 100 0 100 100Z', 10), [[
        {type: 'M', x: 0, y: 0},
        {type: 'L', x: 10, y: 0},
        {type: 'L', x: 10, y: 10},
      ]]);
    });

    it('should read the relative lines and the repeated commands of a traced path', function() {
      assert.deepEqual(parsePath('M1 2h3v4h-3ZM0 0h1v1h-1Z', 1), [
        [
          {type: 'M', x: 1, y: 2},
          {type: 'L', x: 4, y: 2},
          {type: 'L', x: 4, y: 6},
          {type: 'L', x: 1, y: 6},
        ],
        [
          {type: 'M', x: 0, y: 0},
          {type: 'L', x: 1, y: 0},
          {type: 'L', x: 1, y: 1},
          {type: 'L', x: 0, y: 1},
        ],
      ]);
    });

    it('should not read a command it does not know', function() {
      assert.throws(() => parsePath('M0 0A1 1 0 0 1 2 2Z', 10));
    });

    it('should be empty for the glyphs the face draws nothing for', function() {
      const font = Font.get('12x24');

      const empty = Object.entries(outlines.glyphs)
          .filter(([, path]) => path === '')
          .map(([codepoint]) => Number(codepoint));

      /* The carriage return, the space and the no break space. A combining
         accent is not among them: it has an outline, which sits outside the
         cell of a font that gives it no advance, so its packed glyph is blank
         while its path is not */

      assert.deepEqual(empty.map(name), [name(0x0d), name(0x20), name(0xa0)]);

      for (const codepoint of empty) {
        assert.isFalse(font.lookup(codepoint).data.some((byte) => byte !== 0), name(codepoint));
      }
    });
  });

  describe('the cell', function() {
    it('should report the glyphs whose outline paints outside it', function() {
      const width = outlines.cell.width;
      const height = outlines.cell.height;

      const outside = [];
      const whole = [];

      for (const [key, path] of Object.entries(outlines.glyphs)) {
        const box = bounds(parsePath(path, outlines.units));

        if (!box) {
          continue;
        }

        const over = Math.max(-box.x1, box.x2 - width, -box.y1, box.y2 - height);

        if (over > 0) {
          outside.push([Number(key), over]);
        }

        if (box.x2 <= 0 || box.x1 >= width || box.y2 <= 0 || box.y1 >= height) {
          whole.push(Number(key));
        }
      }

      const far = outside.filter(([, over]) => over > 2);

      report.push(`outside the cell: ${outside.length} glyphs, ${far.length} by more than two dots, ` +
        `${whole.length} of them wholly outside`);

      /* A bitmap cell clips and a path does not, so the SVG writer clips every
         glyph to its cell, see the notes of Section 3. The numbers are pinned
         so that a regeneration that changes them shows up here */

      assert.equal(outside.length, OUTSIDE_THE_CELL.total, 'glyphs outside the cell');
      assert.equal(far.length, OUTSIDE_THE_CELL.far, 'glyphs more than two dots outside the cell');
      assert.deepEqual(whole.map(name), OUTSIDE_THE_CELL.whole, 'glyphs wholly outside the cell');
    });
  });

  describe('the glyphs of font A', function() {
    it('should fill to within a few dots of the packed glyphs of the 12x24 font', function() {
      const font = Font.get('12x24');
      const failed = [];

      let total = 0;
      let worst = 0;
      let moved = 0;

      for (const [key, path] of Object.entries(outlines.glyphs)) {
        const codepoint = Number(key);
        const cell = fillPath(parsePath(path, outlines.units), 12, 24);
        const dots = difference(cell, font.lookup(codepoint));

        total += dots;
        worst = Math.max(worst, dots);

        if (dots > 2) {
          moved++;
        }

        if (dots > (KNIFE_EDGE.includes(codepoint) ? KNIFE_EDGE_TOLERANCE : TOLERANCE)) {
          failed.push(`${name(codepoint)} by ${dots} dots`);
        }
      }

      report.push(`font A: ${total} dots over ${Object.keys(outlines.glyphs).length} glyphs, ` +
        `worst ${worst}, ${moved} of them over two dots, ` +
        `${KNIFE_EDGE.length} of them on the knife edge`);

      assert.deepEqual(failed, []);
    });
  });

  describe('the glyphs of font B', function() {
    it('should fill to within a few dots of the packed glyphs of the 8x16 font', function() {
      const font = Font.get('8x16');
      const failed = [];

      let total = 0;
      let worst = 0;
      let moved = 0;

      for (const [key, path] of Object.entries(outlines.glyphs)) {
        const codepoint = Number(key);
        const own = outlines.glyphsB[codepoint];

        const contours = own === undefined ?
          scaleContours(parsePath(path, outlines.units), FONT_B_SCALE) :
          parsePath(own, outlines.units);

        const cell = fillPath(contours, 8, 16);
        const dots = difference(cell, font.lookup(codepoint));

        total += dots;
        worst = Math.max(worst, dots);

        if (dots > 2) {
          moved++;
        }

        if (dots > TOLERANCE) {
          failed.push(`${name(codepoint)} by ${dots} dots`);
        }
      }

      report.push(`font B: ${total} dots over ${Object.keys(outlines.glyphs).length} glyphs, ` +
        `worst ${worst}, ${moved} of them over two dots, ` +
        `${Object.keys(outlines.glyphsB).length} refitted`);

      assert.deepEqual(failed, []);
    });
  });

  describe('the glyphs of the katakana codepage', function() {
    /* The sixty three half width katakana of JIS X 0201, which the second
       source supplies, and the thirteen characters of Epson's table that a
       Japanese face draws on a full em, which the horizontal fit scales into
       the cell */

    const kana = [];

    for (let codepoint = 0xff61; codepoint <= 0xff9f; codepoint++) {
      kana.push(codepoint);
    }

    const wide = [0x5186, 0x5e74, 0x6708, 0x65e5, 0x6642, 0x5206, 0x79d2,
      0x3012, 0x5e02, 0x533a, 0x753a, 0x6751, 0x4eba];

    it('should have an outline for every half width katakana', function() {
      const missing = kana.filter((codepoint) => outlines.glyphs[codepoint] === undefined);

      assert.deepEqual(missing.map(name), []);
      assert.equal(kana.length, 63);
    });

    it('should have an outline for the thirteen characters of the wider face', function() {
      const missing = wide.filter((codepoint) => outlines.glyphs[codepoint] === undefined);

      assert.deepEqual(missing.map(name), []);
    });

    it('should keep a glyph that is wider than the face inside its cell', function() {
      /* The fit is the cell over the advance of the glyph with no offset, so
         the ink of one of these sits inside the cell where an unfitted glyph
         of twice the advance would paint a cell to either side of it */

      for (const codepoint of wide) {
        const box = bounds(parsePath(outlines.glyphs[codepoint], outlines.units));

        assert.isAtLeast(box.x1, 0, name(codepoint));
        assert.isAtMost(box.x2, outlines.cell.width, name(codepoint));

        /* And it uses the cell it was given, rather than sitting in the middle
           of it at the size of the face */

        assert.isAbove(box.x2 - box.x1, outlines.cell.width / 2, name(codepoint));
      }
    });

    it('should fill to the packed glyphs of both fonts within the tolerance', function() {
      const a = Font.get('12x24');
      const b = Font.get('8x16');

      const failed = [];

      for (const codepoint of [...kana, ...wide]) {
        const contours = parsePath(outlines.glyphs[codepoint], outlines.units);

        const dotsA = difference(fillPath(contours, 12, 24), a.lookup(codepoint));
        const dotsB = difference(fillPath(scaleContours(contours, FONT_B_SCALE), 8, 16), b.lookup(codepoint));

        if (dotsA > TOLERANCE || dotsB > TOLERANCE) {
          failed.push(`${name(codepoint)} by ${dotsA} and ${dotsB} dots`);
        }
      }

      assert.deepEqual(failed, []);
    });
  });

  describe('the box drawing characters', function() {
    for (const cell of CELLS) {
      it(`should fill to the cells of the ${cell.name} cell exactly`, function() {
        const font = new Font(fonts[cell.font]);
        const failed = [];

        for (const [key, path] of Object.entries(outlines.box[cell.name])) {
          const codepoint = Number(key);

          const bitmap = font.renderGlyph(font.lookup(codepoint), {
            cellWidth: cell.width,
            cellHeight: cell.height,
            stretch: true,
          });

          const filled = fillPath(parsePath(path, 1), cell.width, cell.height);
          const dots = difference(filled, bitmap);

          if (dots !== 0) {
            failed.push(`${name(codepoint)} by ${dots} dots`);
          }
        }

        assert.deepEqual(failed, []);
      });
    }

    it('should be rectangles on whole dots', function() {
      for (const cell of CELLS) {
        for (const path of Object.values(outlines.box[cell.name])) {
          assert.match(path, /^(M\d+ \d+h\d+v\d+h-\d+Z)*$/, `in the ${cell.name} cell`);
        }
      }
    });
  });

  after(function() {
    for (const line of report) {
      process.stdout.write(`      ${line}\n`);
    }
  });
});
