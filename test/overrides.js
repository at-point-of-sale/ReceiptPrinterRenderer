import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import fonts from '../generated/fonts.js';
import Font from '../src/font.js';
import {
  readOverrides, validateOverrides, applyOverrides, countOverrides, OVERRIDES_FILE,
} from '../tools/overrides.js';
import {toAscii} from './helpers/ascii.js';
import {assert} from 'chai';

/*
    The hand made glyphs of data/fonts/overrides.json, which tools/generate.js
    lays over the rasterized ones. The overriding is tested on the packed fonts
    of generated/fonts.js, so no outline font is read and no glyph is rasterized
    here: a file goes in, a packed font comes out, and what the file names is
    the file's dots while everything else is the byte it was.

    See tools/overrides.js for the format and the reasons.
*/

/* The fonts that are packed, the way the generator hands them to the reader:
   the name of a cell, and the cell */

const CELLS = Object.entries(fonts).map(([name, font]) => ({
  name,
  width: font.width,
  height: font.height,
  baseline: font.baseline,
}));

/* A code point of the set, and one that is not in either font: the editor
   exports what its face holds, and a face may hold a glyph for a code point no
   codepage of this build can reach. U+0623 is Arabic, which no source has */

const INSIDE = 0x41;
const OUTSIDE = 0x0623;

/**
 * A cell of ASCII art with a border and a diagonal, which is nothing the
 * rasterizer would ever draw
 *
 * @param  {number}     width    Cell width in dots
 * @param  {number}     height   Cell height in dots
 * @return {string[]}            The rows of the cell
 */
function pattern(width, height) {
  const rows = [];

  for (let y = 0; y < height; y++) {
    let row = '';

    for (let x = 0; x < width; x++) {
      const edge = y === 0 || y === height - 1 || x === 0 || x === width - 1;
      row += edge || x === y % width ? '#' : '.';
    }

    rows.push(row);
  }

  return rows;
}

/**
 * The rows of one glyph of a packed font, as ASCII art
 *
 * @param  {object}     packed      A packed font
 * @param  {number}     codepoint   Unicode code point
 * @return {string[]}               The rows of the cell
 */
function rowsOf(packed, codepoint) {
  const font = new Font(packed);

  return toAscii(font.renderGlyph(font.lookup(codepoint)));
}

/**
 * The glyphs of a packed font, one Buffer each, so that two fonts can be
 * compared glyph by glyph
 *
 * @param  {object}     packed   A packed font
 * @return {Buffer[]}            The packed rows of every glyph, in glyph order
 */
function glyphsOf(packed) {
  const bytes = Buffer.from(packed.data, 'base64');
  const glyphBytes = Math.ceil(packed.width / 8) * packed.height;
  const glyphs = [];

  for (let offset = 0; offset < bytes.length; offset += glyphBytes) {
    glyphs.push(bytes.subarray(offset, offset + glyphBytes));
  }

  return glyphs;
}

/**
 * An overrides file of one 12 by 24 face, as the editor writes it
 *
 * @param  {object}   glyphs      The glyphs of that face, by code point
 * @param  {object}   [changes]   What to change about the file itself
 * @return {object}               The overrides
 */
function file(glyphs, changes = {}) {
  return {
    version: 1,
    fonts: ['iosevka-medium-subset.ttf'],
    commit: '4460626ac784c29ecb93e84dd19d770cedfc7de7',
    faces: {
      '12x24': {width: 12, height: 24, baseline: 18, glyphs},
    },
    ...changes,
  };
}

describe('Overrides', function() {
  let directory;

  /**
   * Write an overrides file to a directory of its own and read it back the way
   * the generator does
   *
   * @param  {object}    overrides   The overrides to write
   * @return {?object}               What the reader made of it
   */
  function roundtrip(overrides) {
    const target = path.join(directory, 'overrides.json');

    fs.writeFileSync(target, JSON.stringify(overrides, null, 2) + '\n');

    return readOverrides(target, CELLS);
  }

  before(function() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-overrides-'));
  });

  after(function() {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  describe('the file of the repository', function() {
    it('is well formed and holds no glyphs', function() {
      const overrides = readOverrides(OVERRIDES_FILE, CELLS);

      assert.isNotNull(overrides, `${OVERRIDES_FILE} is missing`);
      assert.equal(overrides.version, 1);
      assert.deepEqual(Object.keys(overrides.faces), CELLS.map((cell) => cell.name));
      assert.equal(countOverrides(overrides), 0);
    });

    it('leaves every glyph of both fonts the byte it was', function() {
      const overrides = readOverrides(OVERRIDES_FILE, CELLS);

      for (const cell of CELLS) {
        const laid = applyOverrides(fonts[cell.name], overrides.faces[cell.name]);

        assert.equal(laid.overridden, 0);
        assert.equal(laid.added, 0);
        assert.equal(laid.packed.data, fonts[cell.name].data, `${cell.name} data`);
        assert.deepEqual(laid.packed.index, fonts[cell.name].index, `${cell.name} index`);
      }
    });
  });

  describe('applying a file', function() {
    it('lays the rows of the file over the glyph of a code point the font has', function() {
      const rows = pattern(12, 24);
      const overrides = roundtrip(file({[INSIDE]: rows}));

      const laid = applyOverrides(fonts['12x24'], overrides.faces['12x24']);

      assert.equal(laid.overridden, 1);
      assert.equal(laid.added, 0);
      assert.deepEqual(rowsOf(laid.packed, INSIDE), rows);
      assert.notDeepEqual(rowsOf(fonts['12x24'], INSIDE), rows, 'the rasterized glyph was already the pattern');
    });

    it('adds a code point the font has no glyph for as a glyph of its own', function() {
      const rows = pattern(12, 24);
      const overrides = roundtrip(file({[OUTSIDE]: rows}));

      assert.isUndefined(fonts['12x24'].index[OUTSIDE], 'the font already has that code point');

      const laid = applyOverrides(fonts['12x24'], overrides.faces['12x24']);

      assert.equal(laid.overridden, 0);
      assert.equal(laid.added, 1);
      assert.equal(laid.packed.index[OUTSIDE], glyphsOf(fonts['12x24']).length);
      assert.deepEqual(rowsOf(laid.packed, OUTSIDE), rows);
    });

    it('changes nothing but the two glyphs it names', function() {
      const inside = pattern(12, 24);
      const outside = pattern(12, 24).slice().reverse();

      const overrides = roundtrip(file({[INSIDE]: inside, [OUTSIDE]: outside}));
      const laid = applyOverrides(fonts['12x24'], overrides.faces['12x24']);

      const before = glyphsOf(fonts['12x24']);
      const after = glyphsOf(laid.packed);

      assert.equal(laid.overridden, 1);
      assert.equal(laid.added, 1);
      assert.equal(after.length, before.length + 1, 'one glyph added');

      const overridden = fonts['12x24'].index[INSIDE];

      let changed = 0;

      for (let glyph = 0; glyph < before.length; glyph++) {
        if (before[glyph].equals(after[glyph])) {
          continue;
        }

        assert.equal(glyph, overridden, `glyph ${glyph} changed and is not the one the file names`);
        changed++;
      }

      assert.equal(changed, 1);

      /* Every code point keeps the glyph it had, and the one that was added is
         the only new entry of the index */

      for (const [codepoint, glyph] of Object.entries(fonts['12x24'].index)) {
        assert.equal(laid.packed.index[codepoint], glyph, `code point ${codepoint}`);
      }

      assert.deepEqual(
          Object.keys(laid.packed.index).filter((key) => !(key in fonts['12x24'].index)),
          [String(OUTSIDE)],
      );

      assert.deepEqual(rowsOf(laid.packed, INSIDE), inside);
      assert.deepEqual(rowsOf(laid.packed, OUTSIDE), outside);
    });

    it('leaves the font alone when a face holds no glyphs', function() {
      const overrides = roundtrip(file({}));
      const laid = applyOverrides(fonts['12x24'], overrides.faces['12x24']);

      assert.equal(laid.overridden, 0);
      assert.equal(laid.added, 0);
      assert.equal(laid.packed.data, fonts['12x24'].data);
      assert.deepEqual(laid.packed.index, fonts['12x24'].index);
    });

    it('lays the dots of the 8 by 16 face over the 8 by 16 font', function() {
      const rows = pattern(8, 16);

      const overrides = roundtrip(file({}, {
        faces: {'8x16': {width: 8, height: 16, baseline: 12, glyphs: {[INSIDE]: rows}}},
      }));

      const laid = applyOverrides(fonts['8x16'], overrides.faces['8x16']);

      assert.equal(laid.overridden, 1);
      assert.deepEqual(rowsOf(laid.packed, INSIDE), rows);
    });
  });

  describe('refusing a file', function() {
    it('refuses a version it does not read', function() {
      assert.throws(() => roundtrip(file({}, {version: 2})), /version 2/);
    });

    it('refuses a cell that is not one of the fonts', function() {
      const overrides = file({});

      overrides.faces['16x32'] = {width: 16, height: 32, baseline: 24, glyphs: {}};

      assert.throws(() => roundtrip(overrides), /a face of 16x32 dots/);
    });

    it('refuses a face that is not the cell of its key', function() {
      const overrides = file({});

      overrides.faces['12x24'].height = 26;

      assert.throws(() => roundtrip(overrides), /a face is under the key of its own cell/);
    });

    it('refuses a face that stands on another row than the font of this build', function() {
      const overrides = file({});

      overrides.faces['12x24'].baseline = 17;

      assert.throws(
          () => roundtrip(overrides),
          /the 12x24 face stands on baseline 17, and the 12x24 font of this build stands on row 18/,
      );
    });

    it('refuses a face of the wrong baseline when it is applied as well', function() {
      assert.throws(
          () => applyOverrides(fonts['8x16'], {width: 8, height: 16, baseline: 11, glyphs: {}}),
          /the 8x16 face stands on baseline 11, and the 8x16 font of this build stands on row 12/,
      );
    });

    it('refuses a row that is not the width of the cell', function() {
      const rows = pattern(12, 24);

      rows[5] = rows[5].slice(1);

      assert.throws(() => roundtrip(file({[INSIDE]: rows})), /row 5 .* is 11 dots wide/);
    });

    it('refuses a glyph that is not the height of the cell', function() {
      assert.throws(() => roundtrip(file({[INSIDE]: pattern(12, 23)})), /has 23 rows/);
    });

    it('refuses a character that is not ink and is not paper', function() {
      const rows = pattern(12, 24);

      rows[3] = 'x' + rows[3].slice(1);

      assert.throws(() => roundtrip(file({[INSIDE]: rows})), /holds 'x'/);
    });

    it('refuses a file that is not the format at all', function() {
      assert.throws(() => validateOverrides({version: 1}, CELLS), /no faces object/);
      assert.throws(() => validateOverrides(null, CELLS), /not an object/);
    });
  });

  describe('reading no file at all', function() {
    it('is not an error, and the fonts are the rasterized ones', function() {
      assert.isNull(readOverrides(path.join(directory, 'there-is-none.json'), CELLS));
    });
  });
});
