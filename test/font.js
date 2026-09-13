import CodepageEncoder from '@point-of-sale/codepage-encoder';

import Font from '../src/font.js';
import Bitmap from '../src/bitmap.js';
import {toAscii, fromAscii} from './helpers/ascii.js';
import {assert} from 'chai';

/* Draw code points next to each other in cells of a given size, the way the
   painter puts the characters of a line next to each other */

/**
 * A row of cells
 *
 * @param  {object}     font         The font to draw with
 * @param  {number[]}   codepoints   The code points to draw
 * @param  {number}     cellWidth    Width of a cell in dots
 * @param  {number}     cellHeight   Height of a cell in dots
 * @param  {object}     [options]    Style options for renderGlyph
 * @return {object}                  The bitmap
 */
function strip(font, codepoints, cellWidth, cellHeight, options = {}) {
  const result = Bitmap.create(cellWidth * codepoints.length, cellHeight);

  codepoints.forEach((codepoint, index) => {
    const cell = font.renderGlyph(font.lookup(codepoint), {cellWidth, cellHeight, ...options});
    Bitmap.blit(cell, result, index * cellWidth, 0);
  });

  return result;
}

/* Draw code points below each other, the way the painter stacks lines */

/**
 * A column of cells
 *
 * @param  {object}     font         The font to draw with
 * @param  {number[]}   codepoints   The code points to draw
 * @param  {number}     cellWidth    Width of a cell in dots
 * @param  {number}     cellHeight   Height of a cell in dots
 * @param  {object}     [options]    Style options for renderGlyph
 * @return {object}                  The bitmap
 */
function stack(font, codepoints, cellWidth, cellHeight, options = {}) {
  const result = Bitmap.create(cellWidth, cellHeight * codepoints.length);

  codepoints.forEach((codepoint, index) => {
    const cell = font.renderGlyph(font.lookup(codepoint), {cellWidth, cellHeight, ...options});
    Bitmap.blit(cell, result, 0, index * cellHeight);
  });

  return result;
}

/* The row of a bitmap with the most ink, which is the rule of a strip */

/**
 * The row of a bitmap with the most black dots
 *
 * @param  {object}   bitmap   The bitmap to look at
 * @return {string}            That row, as ASCII art
 */
function busiestRow(bitmap) {
  return toAscii(bitmap)
      .map((line) => ({line, ink: line.split('#').length - 1}))
      .sort((a, b) => b.ink - a.ink)[0].line;
}

describe('Font', function() {
  describe('get()', function() {
    it('should have the two built in fonts', function() {
      assert.includeMembers(Font.names, ['12x24', '8x16']);
    });

    it('should report the size of the cell', function() {
      const font = Font.get('12x24');

      assert.equal(font.width, 12);
      assert.equal(font.height, 24);
    });

    it('should decode a built in font only once', function() {
      assert.strictEqual(Font.get('12x24'), Font.get('12x24'));
    });

    it('should not accept a font it does not have', function() {
      assert.throws(() => Font.get('7x13'));
    });
  });

  describe('a font of your own', function() {
    /* Two glyphs of 4 by 2 dots, a full cell and a checkerboard */

    const packed = {
      width: 4,
      height: 2,
      fallback: 0,
      index: {65: 1},
      data: 'APDwAA==',
    };

    it('should take the packed format of the generated fonts', function() {
      const font = new Font(packed);

      assert.equal(font.width, 4);
      assert.deepEqual(toAscii(font.lookup(65)), ['####', '....']);
      assert.deepEqual(toAscii(font.fallback), ['....', '####']);
    });

    it('should not accept data that is not a font', function() {
      assert.throws(() => new Font({width: 4, height: 2}), /font data/i);
    });

    it('should not accept a glyph number outside the data', function() {
      assert.throws(() => new Font({...packed, fallback: 7}), /no glyph 7/);
    });
  });

  describe('isBoxDrawing()', function() {
    it('should cover the box drawing and block characters', function() {
      assert.isTrue(Font.isBoxDrawing(0x2500));
      assert.isTrue(Font.isBoxDrawing(0x2551));
      assert.isTrue(Font.isBoxDrawing(0x259f));
    });

    it('should not cover anything else', function() {
      assert.isFalse(Font.isBoxDrawing(0x41));
      assert.isFalse(Font.isBoxDrawing(0x24ff));
      assert.isFalse(Font.isBoxDrawing(0x25a0));
    });
  });

  describe('lookup()', function() {
    const font = Font.get('12x24');

    it('should have the printable ASCII characters', function() {
      for (let codepoint = 0x20; codepoint <= 0x7e; codepoint++) {
        assert.isTrue(font.has(codepoint), `missing glyph for ${codepoint}`);
      }
    });

    it('should have the box drawing characters the encoder uses', function() {
      for (const codepoint of [0x2500, 0x2502, 0x250c, 0x2510, 0x2514, 0x2518]) {
        assert.isTrue(font.has(codepoint), `missing glyph for ${codepoint}`);
      }
    });

    it('should have the Greek and the symbols of the tail of cp437', function() {
      for (const codepoint of [0x3b1, 0x192, 0x2302, 0x20a7, 0x221e]) {
        assert.isTrue(font.has(codepoint), `missing glyph for ${codepoint}`);
      }
    });

    it('should draw a glyph of its own for those, not the fallback', function() {
      assert.notDeepEqual(
          Array.from(font.lookup(0x3b1).data),
          Array.from(font.fallback.data),
      );
    });

    it('should have a glyph for every code point of cp437 in both fonts', function() {
      const table = CodepageEncoder.getCodepoints('cp437', true);

      for (const name of ['12x24', '8x16']) {
        const size = Font.get(name);

        for (let byte = 0x20; byte <= 0xff; byte++) {
          const codepoint = table[byte];

          assert.isTrue(size.has(codepoint), `${name} has no glyph for byte ${byte}, code point ${codepoint}`);

          assert.notDeepEqual(
              Array.from(size.lookup(codepoint).data),
              Array.from(size.fallback.data),
              `${name} draws the fallback for byte ${byte}, code point ${codepoint}`,
          );
        }
      }
    });

    it('should return a glyph of the size of the cell', function() {
      const glyph = font.lookup(0x41);

      assert.equal(glyph.width, 12);
      assert.equal(glyph.height, 24);
      assert.equal(glyph.data.length, 48);
    });

    it('should return different glyphs for different code points', function() {
      assert.notDeepEqual(
          Array.from(font.lookup(0x41).data),
          Array.from(font.lookup(0x42).data),
      );
    });

    it('should return the fallback glyph for a code point it does not have', function() {
      assert.deepEqual(
          Array.from(font.lookup(0x4e00).data),
          Array.from(font.fallback.data),
      );
    });

    it('should return the fallback glyph for the replacement character', function() {
      assert.deepEqual(
          Array.from(font.lookup(0xfffd).data),
          Array.from(font.fallback.data),
      );
    });

    it('should not find the properties of Object in the index', function() {
      assert.isFalse(font.has('constructor'));
      assert.isFalse(font.has('toString'));

      assert.deepEqual(
          Array.from(font.lookup('constructor').data),
          Array.from(font.fallback.data),
      );
    });

    it('should draw the fallback glyph as the replacement character of the font', function() {
      const art = toAscii(font.fallback);

      /* U+FFFD of Iosevka, a question mark in a diamond */

      assert.deepEqual(art[2], '.....##.....');
      assert.deepEqual(art[11], '..########..');
      assert.deepEqual(art[17], '.....##.....');
    });
  });

  describe('baseline and cellBaseline()', function() {
    it('should carry the baseline of the built in fonts', function() {
      assert.equal(Font.get('12x24').baseline, 18);
      assert.equal(Font.get('8x16').baseline, 12);
    });

    it('should put the baseline of a cell at the fraction of its height the font has', function() {
      const a = Font.get('12x24');
      const b = Font.get('8x16');

      /* The cell of font A, and the same cell at double height */

      assert.equal(a.cellBaseline(24), 18);
      assert.equal(a.cellBaseline(48), 36);

      /* The glyphs of font B, the 9x17 cell of an Epson and the 9x24 cell of a
         Star, which is where font A has its baseline as well */

      assert.equal(b.cellBaseline(16), 12);
      assert.equal(b.cellBaseline(17), 12);
      assert.equal(b.cellBaseline(24), 18);
    });

    it('should give a font without a baseline three quarters of its height', function() {
      const packed = {
        width: 8,
        height: 8,
        fallback: 0,
        index: {65: 0},
        data: Buffer.alloc(8).toString('base64'),
      };

      assert.equal(new Font(packed).baseline, 6);
    });
  });

  describe('renderGlyph() of the letter A', function() {
    const font = Font.get('12x24');
    const cell = font.renderGlyph(font.lookup(0x41), {});

    it('should look like an A', function() {
      assert.deepEqual(toAscii(cell), [
        '.....##.....',
        '....####....',
        '....####....',
        '....####....',
        '....####....',
        '....####....',
        '...######...',
        '...##..##...',
        '...##..##...',
        '...##..##...',
        '...##..##...',
        '..###..###..',
        '..########..',
        '..########..',
        '..##....##..',
        '.###....###.',
        '.###....###.',
        '.##......##.',
        '............',
        '............',
        '............',
        '............',
        '............',
        '............',
      ]);
    });
  });

  describe('renderGlyph() of an 8x16 glyph in a larger cell', function() {
    const font = Font.get('8x16');
    const glyph = font.lookup(0x41);

    it('should keep the spare column on the right in a 9x17 cell', function() {
      const cell = font.renderGlyph(glyph, {cellWidth: 9, cellHeight: 17});

      assert.equal(cell.width, 9);
      assert.equal(cell.height, 17);

      assert.deepEqual(toAscii(cell)[2], '...##....');
      assert.deepEqual(toAscii(cell)[8], '.######..');
      assert.deepEqual(toAscii(cell)[16], '.........');
    });

    it('should stand the glyph on the baseline of a 9x24 cell, six rows below the top', function() {
      const cell = font.renderGlyph(glyph, {cellWidth: 9, cellHeight: 24});
      const art = toAscii(cell);

      /* The baseline of a 24 row cell of this font is row 18, the baseline of
         the glyph is row 12, so the glyph starts on row 6 and its own baseline
         lands on row 18, where a 12x24 font has its baseline too */

      assert.equal(font.cellBaseline(24), 18);

      assert.deepEqual(art.slice(0, 6), new Array(6).fill('.........'));
      assert.deepEqual(art.slice(22), new Array(2).fill('.........'));
      assert.deepEqual(art.slice(6, 22), toAscii(glyph).map((line) => line + '.'));
    });
  });

  describe('renderGlyph() of box drawing characters', function() {
    const single = [0x250c, 0x2500, 0x2500, 0x2510];
    const double = [0x2554, 0x2550, 0x2550, 0x2557];

    it('should draw one unbroken rule in a 9x17 cell', function() {
      const font = Font.get('8x16');
      const art = toAscii(strip(font, single, 9, 17, {stretch: true}));

      assert.deepEqual(art[7], '...#############################....');
    });

    it('should draw one unbroken rule in a 9x24 cell', function() {
      const font = Font.get('8x16');
      const art = toAscii(strip(font, single, 9, 24, {stretch: true}));

      assert.deepEqual(art[13], '...#############################....');
    });

    it('should break the rule when the glyphs are not stretched', function() {
      const font = Font.get('8x16');
      const art = busiestRow(strip(font, single, 9, 17));

      assert.notMatch(art, /^\.*#+\.*$/);
    });

    for (const [name, cellWidth, cellHeight] of [['9x17', 9, 17], ['9x24', 9, 24]]) {
      it(`should join the double line characters in a ${name} cell`, function() {
        const font = Font.get('8x16');
        const art = busiestRow(strip(font, double, cellWidth, cellHeight, {stretch: true}));

        assert.match(art, /^\.*#+\.*$/);
      });
    }

    it('should join the double line characters in a 12x24 cell', function() {
      const font = Font.get('12x24');
      const art = busiestRow(strip(font, double, 12, 24, {stretch: true}));

      assert.match(art, /^\.*#+\.*$/);
    });

    it('should draw an unbroken vertical line down a column of cells', function() {
      for (const [font, codepoint, cellWidth, cellHeight] of [
        [Font.get('8x16'), 0x2502, 9, 17],
        [Font.get('8x16'), 0x2551, 9, 24],
        [Font.get('12x24'), 0x2502, 12, 24],
      ]) {
        const bitmap = stack(font, [codepoint, codepoint, codepoint], cellWidth, cellHeight, {stretch: true});
        const art = toAscii(bitmap);

        assert.include(art[0], '#');
        assert.deepEqual(art, new Array(art.length).fill(art[0]));
      }
    });

    it('should not stretch a glyph that fills its cell', function() {
      const font = Font.get('8x16');

      assert.deepEqual(
          toAscii(font.renderGlyph(font.lookup(0x2500), {cellWidth: 8, cellHeight: 16, stretch: true})),
          toAscii(font.lookup(0x2500)),
      );
    });
  });

  describe('renderGlyph() with styles', function() {
    const font = Font.get('12x24');

    const glyph = fromAscii([
      '.##.',
      '#..#',
      '####',
      '#..#',
    ]);

    /* The glyph is not a glyph of this font, so it brings its own baseline: it
       is four rows tall and has no descender, which puts its baseline on row 4.
       The baseline of the six row cell is row 4 as well, so the glyph starts at
       the top of it */

    const options = {cellWidth: 5, cellHeight: 6, baseline: 4};

    it('should stand the glyph on the baseline of the cell without styles', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, options)), [
        '.##..',
        '#..#.',
        '####.',
        '#..#.',
        '.....',
        '.....',
      ]);
    });

    it('should overstrike the glyph when bold', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, bold: true})), [
        '.###.',
        '##.##',
        '#####',
        '##.##',
        '.....',
        '.....',
      ]);
    });

    it('should draw one row across the cell when underlined', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, underline: 1})), [
        '.##..',
        '#..#.',
        '####.',
        '#..#.',
        '.....',
        '#####',
      ]);
    });

    it('should draw two rows across the cell when underlined twice', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, underline: 2})), [
        '.##..',
        '#..#.',
        '####.',
        '#..#.',
        '#####',
        '#####',
      ]);
    });

    it('should draw the cell white on black when inverted', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, invert: true})), [
        '#..##',
        '.##.#',
        '....#',
        '.##.#',
        '#####',
        '#####',
      ]);
    });

    it('should not underline an inverted cell, as a printer does not', function() {
      assert.deepEqual(
          toAscii(font.renderGlyph(glyph, {...options, underline: 2, invert: true})),
          toAscii(font.renderGlyph(glyph, {...options, invert: true})),
      );
    });

    it('should not leave ink beyond the width when inverted', function() {
      const cell = font.renderGlyph(glyph, {...options, invert: true});

      assert.deepEqual(Array.from(cell.data.subarray(0, 1)), [0b10011000]);
    });

    it('should not leave ink beyond the width when inverted and scaled', function() {
      const cell = font.renderGlyph(glyph, {...options, widthMultiplier: 2, invert: true});

      assert.equal(cell.width, 10);
      assert.deepEqual(
          Array.from(cell.data).filter((value, index) => index % 2 === 1).map((value) => value & 0x3f),
          new Array(cell.height).fill(0),
      );
    });

    it('should repeat the dots when scaled', function() {
      const cell = font.renderGlyph(glyph, {
        ...options,
        widthMultiplier: 2,
        heightMultiplier: 2,
      });

      assert.equal(cell.width, 10);
      assert.equal(cell.height, 12);

      assert.deepEqual(toAscii(cell), [
        '..####....',
        '..####....',
        '##....##..',
        '##....##..',
        '########..',
        '########..',
        '##....##..',
        '##....##..',
        '..........',
        '..........',
        '..........',
        '..........',
      ]);
    });

    it('should keep the underline one dot thick when scaled', function() {
      const cell = font.renderGlyph(glyph, {
        ...options,
        heightMultiplier: 2,
        underline: 1,
      });

      const art = toAscii(cell);

      assert.deepEqual(art[10], '.....');
      assert.deepEqual(art[11], '#####');
    });
  });
});
