import Font from '../src/font.js';
import Bitmap from '../src/bitmap.js';
import {toAscii, fromAscii} from './helpers/ascii.js';
import {assert} from 'chai';

/* Draw code points next to each other in cells of a given size, the way the
   painter puts the characters of a line next to each other */

function strip(font, codepoints, cellWidth, cellHeight, options = {}) {
  const result = Bitmap.create(cellWidth * codepoints.length, cellHeight);

  codepoints.forEach((codepoint, index) => {
    const cell = font.renderGlyph(font.lookup(codepoint), {cellWidth, cellHeight, ...options});
    Bitmap.blit(cell, result, index * cellWidth, 0);
  });

  return result;
}

/* Draw code points below each other, the way the painter stacks lines */

function stack(font, codepoints, cellWidth, cellHeight, options = {}) {
  const result = Bitmap.create(cellWidth, cellHeight * codepoints.length);

  codepoints.forEach((codepoint, index) => {
    const cell = font.renderGlyph(font.lookup(codepoint), {cellWidth, cellHeight, ...options});
    Bitmap.blit(cell, result, 0, index * cellHeight);
  });

  return result;
}

/* The row of a bitmap with the most ink, which is the rule of a strip */

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

    it('should have the characters of cp437 that only the small font has', function() {
      for (const codepoint of [0x3b1, 0x192, 0x2302, 0x20a7, 0x221e]) {
        assert.isTrue(font.has(codepoint), `missing glyph for ${codepoint}`);
      }
    });

    it('should draw a borrowed character instead of the fallback box', function() {
      assert.notDeepEqual(
          Array.from(font.lookup(0x3b1).data),
          Array.from(font.fallback.data),
      );
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

    it('should draw the fallback glyph as a hollow box', function() {
      const art = toAscii(font.fallback);

      assert.deepEqual(art[4], '.##########.');
      assert.deepEqual(art[10], '.#........#.');
      assert.deepEqual(art[17], '.##########.');
    });
  });

  describe('renderGlyph() of the letter A', function() {
    const font = Font.get('12x24');
    const cell = font.renderGlyph(font.lookup(0x41), {});

    it('should look like an A', function() {
      assert.deepEqual(toAscii(cell), [
        '............',
        '............',
        '............',
        '............',
        '...######...',
        '..##....##..',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##########.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
        '.##......##.',
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

      assert.deepEqual(toAscii(cell)[2], '.#####...');
      assert.deepEqual(toAscii(cell)[16], '.........');
    });

    it('should centre the glyph in a 9x24 cell, four rows above and below', function() {
      const cell = font.renderGlyph(glyph, {cellWidth: 9, cellHeight: 24});
      const art = toAscii(cell);

      assert.deepEqual(art.slice(0, 4), new Array(4).fill('.........'));
      assert.deepEqual(art.slice(20), new Array(4).fill('.........'));
      assert.deepEqual(art.slice(4, 20), toAscii(glyph).map((line) => line + '.'));
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

      assert.deepEqual(art[11], '...#############################....');
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

    const options = {cellWidth: 5, cellHeight: 6};

    it('should centre the glyph in the cell without styles', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, options)), [
        '.....',
        '.##..',
        '#..#.',
        '####.',
        '#..#.',
        '.....',
      ]);
    });

    it('should overstrike the glyph when bold', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, bold: true})), [
        '.....',
        '.###.',
        '##.##',
        '#####',
        '##.##',
        '.....',
      ]);
    });

    it('should draw one row across the cell when underlined', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, underline: 1})), [
        '.....',
        '.##..',
        '#..#.',
        '####.',
        '#..#.',
        '#####',
      ]);
    });

    it('should draw two rows across the cell when underlined twice', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, underline: 2})), [
        '.....',
        '.##..',
        '#..#.',
        '####.',
        '#####',
        '#####',
      ]);
    });

    it('should draw the cell white on black when inverted', function() {
      assert.deepEqual(toAscii(font.renderGlyph(glyph, {...options, invert: true})), [
        '#####',
        '#..##',
        '.##.#',
        '....#',
        '.##.#',
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

      assert.deepEqual(Array.from(cell.data.subarray(0, 1)), [0b11111000]);
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
        '..........',
        '..........',
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
