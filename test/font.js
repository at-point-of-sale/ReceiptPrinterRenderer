import CodepageEncoder from '@point-of-sale/codepage-encoder';

import Font from '../src/font.js';
import Bitmap from '../src/bitmap.js';
import {isFormat} from '../tools/rasterize.js';
import {usedCodepoints} from '../tools/codepoints.js';
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

    it('should have a glyph for every code point of the katakana codepages in both fonts', function() {
      /*
         The half width katakana of JIS X 0201, which the second source of
         tools/generate.js supplies, and for Epson the twelve kanji and the
         postal mark of the same table, which no other codepage holds.

         Star's table has two bytes whose code point is U+FFFD itself, the
         entries of the codepage encoder for a position that is not a
         character; those are the fallback by definition and are left out.
      */

      for (const encoding of ['epson/katakana', 'star/katakana']) {
        const table = CodepageEncoder.getCodepoints(encoding, true);

        for (const name of ['12x24', '8x16']) {
          const size = Font.get(name);

          for (let byte = 0x20; byte <= 0xff; byte++) {
            const codepoint = table[byte];

            if (!codepoint || codepoint === 0xfffd) {
              continue;
            }

            assert.isTrue(
                size.has(codepoint),
                `${name} has no glyph for byte ${byte} of ${encoding}, code point ${codepoint}`,
            );

            assert.notDeepEqual(
                Array.from(size.lookup(codepoint).data),
                Array.from(size.fallback.data),
                `${name} draws the fallback for byte ${byte} of ${encoding}, code point ${codepoint}`,
            );
          }
        }
      }
    });

    /*
        The codepages of a script, which is every encoding of the codepage
        encoder that holds a code point of its Unicode block. They are looked
        up rather than listed, so that a codepage the encoder gains is covered
        here the day it arrives.
    */

    /**
     * The encodings that carry a block of code points
     *
     * @param  {number}     first   First code point of the block
     * @param  {number}     last    Last code point of the block
     * @return {string[]}           The names of the encodings
     */
    function encodingsOf(first, last) {
      return CodepageEncoder.getEncodings().filter((encoding) =>
        CodepageEncoder.getCodepoints(encoding, true)
            .some((codepoint) => codepoint >= first && codepoint <= last));
    }

    /*
        What a coverage check leaves out of a codepage table, and it is only
        the two things no glyph could ever be: the control codes, since a table
        maps byte 0x7F to U+007F, which is DEL, and U+FFFD, which is what the
        encoder puts where a table has no character at all and which is the
        fallback glyph by definition.

        The Unicode format characters are not left out. They are drawn as an
        empty cell, by tools/generate.js when no source has a glyph and by the
        rasterizer when one has, so they are covered like anything else and the
        check below sees a cell that is not the fallback.
    */

    const printable = (codepoint) => Boolean(codepoint) && codepoint >= 0x20 && codepoint !== 0x7f &&
      codepoint !== 0xfffd;

    /**
     * Assert that every printable code point of a set of encodings has a glyph
     * of its own in both fonts
     *
     * @param  {string[]}   encodings   The names of the encodings
     */
    function shouldCover(encodings) {
      assert.isAbove(encodings.length, 0);

      for (const encoding of encodings) {
        const table = CodepageEncoder.getCodepoints(encoding, true);

        for (const name of ['12x24', '8x16']) {
          const size = Font.get(name);

          for (let byte = 0x20; byte <= 0xff; byte++) {
            const codepoint = table[byte];

            if (!printable(codepoint)) {
              continue;
            }

            assert.isTrue(
                size.has(codepoint),
                `${name} has no glyph for byte ${byte} of ${encoding}, code point ${codepoint}`,
            );

            assert.notDeepEqual(
                Array.from(size.lookup(codepoint).data),
                Array.from(size.fallback.data),
                `${name} draws the fallback for byte ${byte} of ${encoding}, code point ${codepoint}`,
            );
          }
        }
      }
    }

    it('should have a glyph for every code point of the Hebrew codepages in both fonts', function() {
      /* The Hebrew of the third source: cp862 of both printer families,
         Windows-1255 of Epson's table, and the pages of Bixolon, Xprinter and
         the POS-8360 */

      const encodings = encodingsOf(0x590, 0x5ff);

      assert.includeMembers(encodings, ['cp862', 'windows1255']);

      shouldCover(encodings);
    });

    it('should have a glyph for every code point of the Thai codepages in both fonts', function() {
      /* The Thai of the fourth source: cp874 and Star's own cp874, the three
         Thai pages of Epson's table, thai42, thai11 and thai13, and the six
         thai pages the ESC/POS mappings carry between them */

      const encodings = encodingsOf(0xe00, 0xe7f);

      assert.includeMembers(encodings, ['cp874', 'star/cp874', 'thai11']);

      shouldCover(encodings);
    });

    it('should draw ink for every combining mark of the set in both fonts', function() {
      /*
         A glyph whose advance is zero is centred in its cell by its ink, see
         the rule of the face in tools/rasterize.js. Before that, Iosevka's
         five combining accents printed an empty cell, because a monospaced
         face draws them wholly to the left of an origin it gives them no
         advance from, and eight of the sixteen niqqud would have printed one
         in font B, because seven of them are under a dot wide and the middle
         of an even cell is a boundary between two dots.
      */

      const marks = [
        0x300, 0x301, 0x303, 0x309, 0x323,
        0x5b0, 0x5b1, 0x5b2, 0x5b3, 0x5b4, 0x5b5, 0x5b6, 0x5b7,
        0x5b8, 0x5b9, 0x5bb, 0x5bc, 0x5bd, 0x5bf, 0x5c1, 0x5c2,
        0xe31, 0xe34, 0xe35, 0xe36, 0xe37, 0xe38, 0xe39, 0xe3a,
        0xe47, 0xe48, 0xe49, 0xe4a, 0xe4b, 0xe4c, 0xe4d, 0xe4e,
      ];

      assert.equal(marks.length, 37);

      for (const name of ['12x24', '8x16']) {
        const size = Font.get(name);

        for (const codepoint of marks) {
          assert.isTrue(size.has(codepoint), `${name} has no glyph for ${codepoint.toString(16)}`);
          assert.isTrue(
              size.lookup(codepoint).data.some((byte) => byte !== 0),
              `${name} draws nothing for ${codepoint.toString(16)}`,
          );
        }
      }
    });

    it('should draw an empty cell for every Unicode format character of the set', function() {
      /* The two joiners of Iosevka's cmap, which printed a sliver of their
         right edge against the left wall of the cell, and the two bidi marks
         of Windows-1255, which no subset carries and which printed the
         fallback box until tools/generate.js drew their cell itself */

      const format = usedCodepoints().filter(isFormat);

      assert.deepEqual(format, [0x200c, 0x200d, 0x200e, 0x200f]);

      for (const name of ['12x24', '8x16']) {
        const size = Font.get(name);

        for (const codepoint of format) {
          assert.isTrue(size.has(codepoint), `${name} has no cell for ${codepoint.toString(16)}`);
          assert.isFalse(
              size.lookup(codepoint).data.some((byte) => byte !== 0),
              `${name} draws ink for ${codepoint.toString(16)}`,
          );
        }
      }
    });

    it('should draw the Hebrew and the Thai the way the fixtures were reviewed', function() {
      /* א of the 12 by 24 font, from the third source, fitted to the face and
         not measured for itself: 14 dots tall between the baseline and the
         cap, where the Latin is 17.6 */

      assert.deepEqual(toAscii(Font.get('12x24').lookup(0x5d0)).slice(4, 18), [
        '.###.....##.',
        '..###....##.',
        '...##....##.',
        '...###...##.',
        '...###..###.',
        '..#####.##..',
        '..##.#####..',
        '..##..###...',
        '.##...###...',
        '.##....##...',
        '.##....###..',
        '.##.....##..',
        '.##.....###.',
        '.##......##.',
      ]);

      /* And ก of the fourth, the same way */

      assert.deepEqual(toAscii(Font.get('12x24').lookup(0xe01)).slice(5, 18), [
        '...######...',
        '..########..',
        '.###....##..',
        '.###....##..',
        '..###...###.',
        '...##...###.',
        '..##....###.',
        '.###....###.',
        '.###....###.',
        '.###....###.',
        '.###....###.',
        '.###....###.',
        '.###....###.',
      ]);
    });

    /* The twelve kanji and the postal mark of Epson's katakana table, the only
       characters of a codepage the face draws on a full em */

    const WIDER_THAN_THE_FACE = [0x5186, 0x5e74, 0x6708, 0x65e5, 0x6642, 0x5206,
      0x79d2, 0x3012, 0x5e02, 0x533a, 0x753a, 0x6751, 0x4eba];

    /**
     * The leftmost and the rightmost column of a glyph that carry ink
     *
     * @param  {object}   glyph   The glyph
     * @return {number[]}         The two columns, or null when there is no ink
     */
    function inkColumns(glyph) {
      const art = toAscii(glyph);

      const first = Math.min(...art.map((line) => line.indexOf('#')).filter((column) => column >= 0));
      const last = Math.max(...art.map((line) => line.lastIndexOf('#')));

      return last < 0 ? null : [first, last];
    }

    it('should fit a glyph that is wider than the face into the cell', function() {
      /*
         A glyph of a full em is fitted by its own advance, so the whole of it
         is in the cell. Unfitted it keeps the scale of the face, which puts
         its em on two cells at the left edge of this one, so the cell holds
         its left half and the rest is clipped away: half of these would then
         have ink against the right edge and their own right side bearing
         nowhere, and none of them would be symmetric.
      */

      for (const [name, width] of [['12x24', 12], ['8x16', 8]]) {
        const size = Font.get(name);

        for (const codepoint of WIDER_THAN_THE_FACE) {
          const [first, last] = inkColumns(size.lookup(codepoint));

          /* The em is the cell, so the ink of a kanji, which fills most of its
             em, covers most of the cell and keeps a side bearing on both sides */

          assert.isAtMost(first, 2, `${name} starts ${codepoint.toString(16)} too far right`);
          assert.isAtLeast(last, width - 3, `${name} ends ${codepoint.toString(16)} too far left`);
          assert.isAtLeast(last - first + 1, width * 2 / 3,
              `${name} draws ${codepoint.toString(16)} too narrow`);
        }
      }
    });

    it('should draw a symmetric glyph of a full em symmetric in its cell', function() {
      /* 日 and 〒 are drawn symmetric about the middle of their em. A left half
         that was clipped at the right edge of the cell cannot be symmetric,
         so this is the fit itself and not the shape of the face */

      for (const [name, width] of [['12x24', 12], ['8x16', 8]]) {
        const size = Font.get(name);

        for (const codepoint of [0x65e5, 0x3012]) {
          const art = toAscii(size.lookup(codepoint));

          assert.deepEqual(
              art.map((line) => [...line].reverse().join('')),
              art,
              `${name} does not draw ${codepoint.toString(16)} symmetric in its ${width} dot cell`,
          );
        }
      }
    });

    it('should draw the kanji of the katakana table the way it was reviewed', function() {
      /* 日 of the 12 by 24 font, as the golden fixture of the katakana kanji
         was reviewed by eye: the frame of the character with its middle bar,
         two dots of every stroke vertically and one horizontally, which is
         what fitting a full em into half of one does */

      assert.deepEqual(toAscii(Font.get('12x24').lookup(0x65e5)), [
        '..########..',
        '..########..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..########..',
        '..########..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..#......#..',
        '..########..',
        '..########..',
        '..#......#..',
        '..#......#..',
        '............',
        '............',
        '............',
        '............',
      ]);
    });

    it('should draw the half width katakana inside the cell', function() {
      /* They are half width, so one of them is one cell wide like a letter and
         the fit above never touches them */

      for (const [name, width] of [['12x24', 12], ['8x16', 8]]) {
        const size = Font.get(name);

        for (const codepoint of [0xff71, 0xff76, 0xff9d, 0xff8a, 0xff97, 0xff9f]) {
          const [first, last] = inkColumns(size.lookup(codepoint));

          assert.isAtLeast(first, 0, `${name} draws nothing for ${codepoint.toString(16)}`);
          assert.isBelow(last, width, `${name} draws outside the cell for ${codepoint.toString(16)}`);
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
