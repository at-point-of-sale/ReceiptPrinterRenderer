import {assert} from 'chai';

import outlines from '../generated/outlines.js';
import fonts from '../generated/fonts.js';
import Font from '../src/font.js';
import Bitmap from '../src/bitmap.js';

/*
    What generated/outlines.js and generated/fonts.js say about each other.

    Both files are made in ReceiptPrinterFontEditor and this repository holds no
    code that makes or remakes them, see Section 21 of the implementation plan,
    so what is checked here is what the two files alone can prove: that the
    outlines cover the glyphs of the packed font, that every path parses with
    the small parser below, that the box drawing characters are the dots of the
    rendered cell of the packed font in each of the three cells of the profiles,
    and where a glyph paints outside its cell, which is reported and not pinned.

    How well a filled outline reproduces its packed glyph is the editor's
    measurement and not this repository's: an outline is written in whole tenths
    of a dot and filled with a coverage threshold, and the bitmap is tweaked by
    hand on the dot grid and drifts from the face on purpose. What the vector
    output is judged on here is the agreement of a whole receipt, which
    test/svg.js measures with a rasterizer.
*/

/* The code points the box drawing and block characters live in, which are drawn
   on the dot grid and kept in the box set of the outlines rather than in glyphs */

const BOX_DRAWING = {first: 0x2500, last: 0x259f};

/* The character drawn for a code point without a glyph */

const REPLACEMENT_CHARACTER = 0xfffd;

/* The cells of the profiles, with the font a printer draws them with */

const CELLS = [
  {name: '12x24', font: '12x24', width: 12, height: 24},
  {name: '9x17', font: '8x16', width: 9, height: 17},
  {name: '9x24', font: '8x16', width: 9, height: 24},
];

/* How many straight segments a curve of a path is flattened into to measure
   where its ink lies */

const SEGMENTS = 10;

/* How many numbers every path command takes */

const ARITY = {M: 2, L: 2, Q: 4, C: 6, h: 1, v: 1, Z: 0};

/**
 * Parse SVG path data into contours, in dots.
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
 * Flatten the contours of a path into polygons, the curves sampled at SEGMENTS
 * points each, so that the ink of a path can be measured
 *
 * @param  {Array}    contours   Contours as parsePath returned them
 * @return {Array}               One array of [x, y] points per contour
 */
function flatten(contours) {
  return contours.map((contour) => {
    const points = [];

    let x = 0;
    let y = 0;

    for (const command of contour) {
      if (command.type === 'M' || command.type === 'L') {
        points.push([command.x, command.y]);
      } else {
        for (let step = 1; step <= SEGMENTS; step++) {
          const t = step / SEGMENTS;
          const u = 1 - t;

          if (command.type === 'Q') {
            points.push([
              u * u * x + 2 * u * t * command.x1 + t * t * command.x,
              u * u * y + 2 * u * t * command.y1 + t * t * command.y,
            ]);
          } else {
            points.push([
              u * u * u * x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
              u * u * u * y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y,
            ]);
          }
        }
      }

      x = command.x;
      y = command.y;
    }

    return points;
  });
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
 * Fill a box drawing path into a cell.
 *
 * A box path is the rectangles the tracer merged the black runs of a cell into,
 * in whole dots and all wound the same way, so painting each of them is the
 * whole of the fill: there is no curve in one and no hole.
 *
 * @param  {Array}    contours   Contours of a box path, as parsePath returned them
 * @param  {number}   width      Cell width in dots
 * @param  {number}   height     Cell height in dots
 * @return {object}              The cell as a bitmap
 */
function fillRectangles(contours, width, height) {
  const bitmap = Bitmap.create(width, height);

  for (const contour of contours) {
    assert.lengthOf(contour, 4, 'a box path that is not a rectangle');

    const xs = contour.map((command) => command.x);
    const ys = contour.map((command) => command.y);

    for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
      for (let x = Math.min(...xs); x < Math.max(...xs); x++) {
        Bitmap.setPixel(bitmap, x, y, 1);
      }
    }
  }

  return bitmap;
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

  for (const polygon of flatten(contours)) {
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

/* The code points the packed font holds, which is what the outlines are
   measured against: the font is the one the editor exported and this file has
   no other list to compare it with */

const codepoints = Object.keys(fonts['12x24'].index).map(Number).sort((a, b) => a - b);
const boxed = (codepoint) => codepoint >= BOX_DRAWING.first && codepoint <= BOX_DRAWING.last;

/* What was counted along the way, for the summary at the end */

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

      /* The carriage return, the space and the no break space, and the four
         Unicode format characters of the set: every one of those is an empty
         cell whatever outline a source has for it, and an empty cell when no
         source has one at all, so their path is empty too. A combining accent is not among them: it has an
         outline, and since the centring it sits in its cell, so both its path
         and its packed glyph carry the mark */

      assert.deepEqual(
          empty.map(name),
          [name(0x0d), name(0x20), name(0xa0), name(0x200c), name(0x200d), name(0x200e), name(0x200f)],
      );

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

      /* A bitmap cell clips and a path does not, so the SVG writer clips every
         glyph to its cell, see the notes of Section 3. How many glyphs leave
         the cell is a property of the font that was exported, not of this
         repository, so it is counted and printed and nothing is pinned on it */

      report.push(`outside the cell: ${outside.length} glyphs, ${far.length} by more than two dots, ` +
        `${whole.length} of them wholly outside`);
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
  });

  describe('the glyphs of the Hebrew and the Thai codepages', function() {
    /* The 51 Hebrew and the 87 Thai code points of the set, which the third
       and the fourth source supply, the baht sign excepted, which Iosevka has
       and which therefore still comes from the face */

    const hebrew = codepoints.filter((codepoint) => codepoint >= 0x590 && codepoint <= 0x5ff);
    const thai = codepoints.filter((codepoint) => codepoint >= 0xe00 && codepoint <= 0xe7f);

    it('should have an outline for every one of them', function() {
      assert.equal(hebrew.length, 51);
      assert.equal(thai.length, 87);

      const missing = [...hebrew, ...thai].filter((codepoint) => outlines.glyphs[codepoint] === undefined);

      assert.deepEqual(missing.map(name), []);
    });

    it('should keep every one of them inside its cell', function() {
      /*
         The sources are fitted to the face and most of their letters are drawn
         wider than the advance the face is fitted by, so the wide glyph rule
         catches them the way it catches a kanji.

         Two are caught by the ink rule instead. U+0E33, the Thai sara am, is a
         spacing character of an advance of 415 units whose ink runs from -279
         to 337, because the nikhahit half of it is drawn over the consonant in
         front of it: its advance is narrower than the face's, so the wide
         glyph rule does not fire, and it is not zero, so the centring does not
         either, and the nikhahit fell off the left edge of the cell until a
         glyph whose ink lies outside its own advance was fitted by its ink.
         U+0E44, the sara ai maimalai, overhangs by nine units, a fifth of a
         dot, which is the side bearing of a face that lets its vowels lean on
         the letter beside them.
      */

      const outside = [];

      for (const codepoint of [...hebrew, ...thai]) {
        const box = bounds(parsePath(outlines.glyphs[codepoint], outlines.units));

        if (box && (box.x1 < 0 || box.x2 > outlines.cell.width)) {
          outside.push(codepoint);
        }
      }

      assert.deepEqual(outside.map(name), []);
    });
  });

  describe('the combining marks', function() {
    /*
       The glyphs whose advance is zero: Iosevka's five combining accents, the
       sixteen niqqud of Hebrew and the sixteen vowel and tone marks of Thai.
       They are centred in their cell by their ink, on a dot centre, which is
       the rule of the face of ReceiptPrinterFontEditor.

       They are the only glyphs of the file that font B refits. The phase of
       the centring is half a dot past the middle dot of the cell, which is 6.5
       dots in the 12 dot cell and 4.5 in the 8 dot one, and 4.5 is not two
       thirds of 6.5: a centred mark is therefore in a different place in the
       two cells by design, and `glyphsB` is where it says so. Every other
       glyph of font B is still font A at two thirds exactly.
    */

    const MARKS = [
      0x300, 0x301, 0x303, 0x309, 0x323,
      0x5b0, 0x5b1, 0x5b2, 0x5b3, 0x5b4, 0x5b5, 0x5b6, 0x5b7,
      0x5b8, 0x5b9, 0x5bb, 0x5bc, 0x5bd, 0x5bf, 0x5c1, 0x5c2,
      0xe31, 0xe34, 0xe35, 0xe36, 0xe37, 0xe38, 0xe39, 0xe3a,
      0xe47, 0xe48, 0xe49, 0xe4a, 0xe4b, 0xe4c, 0xe4d, 0xe4e,
    ];

    it('should be the glyphs font B refits, and no others', function() {
      assert.deepEqual(Object.keys(outlines.glyphsB).map(Number).sort((a, b) => a - b), MARKS);
    });

    it('should draw the ink of every one of them inside the cell', function() {
      for (const codepoint of MARKS) {
        const box = bounds(parsePath(outlines.glyphs[codepoint], outlines.units));

        assert.isNotNull(box, name(codepoint));
        assert.isAtLeast(box.x1, 0, name(codepoint));
        assert.isAtMost(box.x2, outlines.cell.width, name(codepoint));
      }
    });

    it('should centre the ink of every one of them on the dot centre of the cell', function() {
      /* floor(width / 2) + 0.5, which is 6.5 of the 12 dot cell, to within the
         tenth of a dot the paths are written in */

      for (const codepoint of MARKS) {
        const box = bounds(parsePath(outlines.glyphs[codepoint], outlines.units));

        assert.closeTo((box.x1 + box.x2) / 2, Math.floor(outlines.cell.width / 2) + 0.5, 0.1, name(codepoint));
      }
    });

    it('should print something in both fonts, which five of them did not before', function() {
      for (const [size, font] of [['12x24', Font.get('12x24')], ['8x16', Font.get('8x16')]]) {
        for (const codepoint of MARKS) {
          assert.isTrue(
              font.lookup(codepoint).data.some((byte) => byte !== 0),
              `${size} draws nothing for ${name(codepoint)}`,
          );
        }
      }
    });
  });

  describe('the Unicode format characters', function() {
    /* A format character is an instruction to whatever lays out the text and
       never a character on the paper, so the font draws one as an empty cell
       and its path is empty. The set holds the two joiners, which Iosevka drew
       straddling its origin and which printed as a sliver against the left
       wall of the cell */

    const FORMAT = [0x200c, 0x200d];

    it('should draw an empty cell and an empty path for every one of them', function() {
      for (const codepoint of FORMAT) {
        assert.equal(outlines.glyphs[codepoint], '', name(codepoint));
        assert.isUndefined(outlines.glyphsB[codepoint], name(codepoint));

        for (const [size, font] of [['12x24', Font.get('12x24')], ['8x16', Font.get('8x16')]]) {
          assert.isTrue(font.has(codepoint), `${size} has no cell for ${name(codepoint)}`);
          assert.isFalse(
              font.lookup(codepoint).data.some((byte) => byte !== 0),
              `${size} draws ink for ${name(codepoint)}`,
          );
        }
      }
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

          const filled = fillRectangles(parsePath(path, 1), cell.width, cell.height);
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
