import Bitmap from '../src/bitmap.js';
import {toAscii, fromAscii} from './helpers/ascii.js';
import {assert} from 'chai';

describe('Bitmap', function() {
  describe('create()', function() {
    const bitmap = Bitmap.create(12, 3);

    it('should pad the rows to whole bytes', function() {
      assert.equal(bitmap.data.length, 6);
    });

    it('should be all white', function() {
      assert.deepEqual(Array.from(bitmap.data), [0, 0, 0, 0, 0, 0]);
    });

    it('should not accept a negative size', function() {
      assert.throws(() => Bitmap.create(-1, 4), /non-negative/);
    });

    it('should accept a size of zero', function() {
      assert.deepEqual(Bitmap.create(0, 0), {width: 0, height: 0, data: new Uint8Array(0)});
    });
  });

  describe('rowBytes()', function() {
    it('should round up to whole bytes', function() {
      assert.deepEqual([0, 1, 8, 9, 384, 576].map(Bitmap.rowBytes), [0, 1, 1, 2, 48, 72]);
    });
  });

  describe('getPixel() and setPixel()', function() {
    const bitmap = Bitmap.create(10, 2);

    Bitmap.setPixel(bitmap, 0, 0, 1);
    Bitmap.setPixel(bitmap, 9, 1, 1);
    Bitmap.setPixel(bitmap, 3, 0, 1);
    Bitmap.setPixel(bitmap, 3, 0, 0);

    it('should set the most significant bit for the leftmost dot', function() {
      assert.equal(bitmap.data[0], 0x80);
    });

    it('should read back what was set', function() {
      assert.equal(Bitmap.getPixel(bitmap, 0, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 9, 1), 1);
    });

    it('should read back a cleared dot as white', function() {
      assert.equal(Bitmap.getPixel(bitmap, 3, 0), 0);
    });

    it('should report dots outside the bitmap as white', function() {
      assert.equal(Bitmap.getPixel(bitmap, -1, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 10, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 0, 2), 0);
    });

    it('should ignore dots outside the bitmap', function() {
      assert.doesNotThrow(() => Bitmap.setPixel(bitmap, 20, 20, 1));
    });
  });

  describe('blit()', function() {
    const source = fromAscii([
      '##..',
      '.##.',
      '..##',
    ]);

    it('should draw the source at the offset', function() {
      const destination = Bitmap.create(10, 5);
      Bitmap.blit(source, destination, 3, 1);

      assert.deepEqual(toAscii(destination), [
        '..........',
        '...##.....',
        '....##....',
        '.....##...',
        '..........',
      ]);
    });

    it('should combine with the destination instead of replacing it', function() {
      const destination = fromAscii([
        '####',
        '....',
        '....',
      ]);

      Bitmap.blit(source, destination, 0, 0);

      assert.deepEqual(toAscii(destination), [
        '####',
        '.##.',
        '..##',
      ]);
    });

    it('should clip at the right and the bottom edge', function() {
      const destination = Bitmap.create(5, 2);
      Bitmap.blit(source, destination, 3, 1);

      assert.deepEqual(toAscii(destination), [
        '.....',
        '...##',
      ]);
    });

    it('should clip at the left and the top edge', function() {
      const destination = Bitmap.create(5, 3);
      Bitmap.blit(source, destination, -1, -1);

      assert.deepEqual(toAscii(destination), [
        '##...',
        '.##..',
        '.....',
      ]);
    });

    it('should draw nothing when the source falls outside the destination', function() {
      const destination = Bitmap.create(5, 3);
      Bitmap.blit(source, destination, 5, 0);
      Bitmap.blit(source, destination, -4, 0);
      Bitmap.blit(source, destination, 0, 3);

      assert.deepEqual(Array.from(destination.data), [0, 0, 0]);
    });

    it('should not copy the padding bits of the source', function() {
      /* A source with ink in the bits beyond its width, which a caller that
         packs its own rows can produce */

      const dirty = Bitmap.create(5, 1);
      dirty.data[0] = 0xff;

      const destination = Bitmap.create(16, 1);
      Bitmap.blit(dirty, destination, 3, 0);

      assert.deepEqual(toAscii(destination), ['...#####........']);
      assert.deepEqual(Array.from(destination.data), [0b00011111, 0b00000000]);
    });

    it('should leave the padding bits of the destination alone', function() {
      const destination = Bitmap.create(12, 1);
      destination.data[1] = 0x0f;

      Bitmap.blit(fromAscii(['####']), destination, 0, 0);

      assert.deepEqual(toAscii(destination), ['####........']);
      assert.deepEqual(Array.from(destination.data), [0b11110000, 0x0f]);
    });

    it('should clip a source that is wider than the destination', function() {
      const source = fromAscii(['##.#####.###########']);
      const destination = Bitmap.create(8, 1);

      Bitmap.blit(source, destination, -5, 0);

      assert.deepEqual(toAscii(destination), ['###.####']);
    });

    it('should draw across byte boundaries', function() {
      const destination = Bitmap.create(24, 1);
      Bitmap.blit(fromAscii(['####']), destination, 6, 0);

      assert.deepEqual(toAscii(destination), ['......####..............']);
    });
  });

  describe('extractRows()', function() {
    const bitmap = fromAscii([
      '#...',
      '.#..',
      '..#.',
      '...#',
    ]);

    it('should return the requested rows', function() {
      assert.deepEqual(toAscii(Bitmap.extractRows(bitmap, 1, 2)), ['.#..', '..#.']);
    });

    it('should stop at the bottom of the bitmap', function() {
      assert.deepEqual(toAscii(Bitmap.extractRows(bitmap, 3, 10)), ['...#']);
    });

    it('should copy the rows instead of referring to them', function() {
      const rows = Bitmap.extractRows(bitmap, 0, 1);
      Bitmap.setPixel(rows, 3, 0, 1);

      assert.equal(Bitmap.getPixel(bitmap, 3, 0), 0);
    });
  });

  describe('packRows()', function() {
    it('should take the least significant bit as the rightmost dot', function() {
      const bitmap = Bitmap.packRows(4, [0b1001, 0b0110]);

      assert.deepEqual(toAscii(bitmap), ['#..#', '.##.']);
    });

    it('should pad the rows to whole bytes', function() {
      const bitmap = Bitmap.packRows(12, [0b111100001111]);

      assert.deepEqual(Array.from(bitmap.data), [0xf0, 0xf0]);
    });

    it('should accept bigints for rows wider than 32 dots', function() {
      const bitmap = Bitmap.packRows(40, [0xf0f0f0f0f0n]);

      assert.deepEqual(Array.from(bitmap.data), [0xf0, 0xf0, 0xf0, 0xf0, 0xf0]);
    });

    it('should not accept numbers for rows wider than 32 dots', function() {
      assert.throws(() => Bitmap.packRows(40, [1]), /bigint/);
    });
  });

  describe('scale()', function() {
    const bitmap = fromAscii([
      '#..#',
      '.##.',
    ]);

    it('should repeat every dot horizontally', function() {
      assert.deepEqual(toAscii(Bitmap.scale(bitmap, 2, 1)), [
        '##....##',
        '..####..',
      ]);
    });

    it('should repeat every dot vertically', function() {
      assert.deepEqual(toAscii(Bitmap.scale(bitmap, 1, 2)), [
        '#..#',
        '#..#',
        '.##.',
        '.##.',
      ]);
    });

    it('should repeat in both directions at once', function() {
      assert.deepEqual(toAscii(Bitmap.scale(bitmap, 2, 2)), [
        '##....##',
        '##....##',
        '..####..',
        '..####..',
      ]);
    });

    it('should return the bitmap itself when nothing changes', function() {
      assert.strictEqual(Bitmap.scale(bitmap, 1, 1), bitmap);
    });

    it('should scale a bitmap that is not a whole number of bytes wide', function() {
      assert.deepEqual(toAscii(Bitmap.scale(fromAscii(['#.#.#']), 3, 1)), ['###...###...###']);
    });

    it('should not accept a multiplier that is not a positive integer', function() {
      assert.throws(() => Bitmap.scale(bitmap, 0, 1), /positive integers/);
      assert.throws(() => Bitmap.scale(bitmap, 1, 1.5), /positive integers/);
    });
  });

  describe('split()', function() {
    const bitmap = fromAscii(['#...', '.#..', '..#.', '...#', '#..#']);

    it('should return the bitmap itself when it fits', function() {
      assert.deepEqual(Bitmap.split(bitmap, 5), [bitmap]);
    });

    it('should cut on a row boundary and lose nothing', function() {
      const pieces = Bitmap.split(bitmap, 2);

      assert.equal(pieces.length, 3);
      assert.deepEqual(pieces.map((piece) => piece.height), [2, 2, 1]);
      assert.deepEqual(
          pieces.map(toAscii).flat(),
          ['#...', '.#..', '..#.', '...#', '#..#'],
      );
    });

    it('should not accept a height of zero', function() {
      assert.throws(() => Bitmap.split(bitmap, 0));
    });
  });

  describe('trimRow()', function() {
    const bitmap = fromAscii([
      '#############...................',
      '................................',
      '...............................#',
    ]);

    it('should drop the white bytes at the end of the row', function() {
      assert.deepEqual(Array.from(Bitmap.trimRow(bitmap, 0)), [0xff, 0xf8]);
    });

    it('should return one byte for an all white row', function() {
      assert.deepEqual(Array.from(Bitmap.trimRow(bitmap, 1)), [0x00]);
    });

    it('should keep the row when its last dot is black', function() {
      assert.deepEqual(Array.from(Bitmap.trimRow(bitmap, 2)), [0x00, 0x00, 0x00, 0x01]);
    });

    it('should return one white byte for a bitmap without width', function() {
      assert.deepEqual(Array.from(Bitmap.trimRow(Bitmap.create(0, 4), 0)), [0x00]);
    });
  });

  describe('fromRaster()', function() {
    it('should read one row after another, eight dots per byte', function() {
      assert.deepEqual(toAscii(Bitmap.fromRaster(Uint8Array.from([0x80, 0x01, 0xff, 0x00]), 16, 2)), [
        '#..............#',
        '########........',
      ]);
    });

    it('should pad every row to whole bytes', function() {
      assert.deepEqual(toAscii(Bitmap.fromRaster(Uint8Array.from([0xf0, 0x0f]), 4, 2)), ['####', '....']);
    });

    it('should leave the rest white when the data is too short', function() {
      assert.deepEqual(toAscii(Bitmap.fromRaster(Uint8Array.from([0xff]), 8, 3)), ['########', '........', '........']);
    });

    it('should clear the padding dots past the width of every row', function() {
      const bitmap = Bitmap.fromRaster(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 11, 2);

      assert.deepEqual(toAscii(bitmap), ['###########', '###########']);

      /* The five dots past the width are padding and have to be white, which
         is the invariant every other operation relies on */

      assert.deepEqual(Array.from(bitmap.data), [0xff, 0xe0, 0xff, 0xe0]);
    });
  });

  describe('fromColumns()', function() {
    it('should read one column after another, the top dot in the most significant bit', function() {
      assert.deepEqual(toAscii(Bitmap.fromColumns(Uint8Array.from([0x80, 0x40, 0x20, 0x10]), 4, 8)), [
        '#...',
        '.#..',
        '..#.',
        '...#',
        '....',
        '....',
        '....',
        '....',
      ]);
    });

    it('should read the bytes of a column under each other', function() {
      assert.deepEqual(toAscii(Bitmap.fromColumns(Uint8Array.from([0x80, 0x01, 0x00, 0x80]), 2, 16)), [
        '#.',
        ...new Array(7).fill('..'),
        '.#',
        ...new Array(6).fill('..'),
        '#.',
      ]);
    });

    it('should be the transpose of the raster format', function() {
      const raster = Bitmap.fromRaster(Uint8Array.from([0b10110010, 0b01001101]), 8, 2);
      const columns = Bitmap.fromColumns(Uint8Array.from([0x80, 0x40, 0x80, 0x80, 0x40, 0x40, 0x80, 0x40]), 8, 2);

      assert.deepEqual(toAscii(columns), toAscii(raster));
    });

    it('should leave the rest white when the data is too short', function() {
      assert.deepEqual(toAscii(Bitmap.fromColumns(Uint8Array.from([0xff]), 3, 8)), [
        ...new Array(8).fill('#..'),
      ]);
    });
  });

  describe('rotate180()', function() {
    const bitmap = fromAscii([
      '#..#',
      '.##.',
      '#...',
    ]);

    it('should turn a bitmap upside down', function() {
      assert.deepEqual(toAscii(Bitmap.rotate180(bitmap)), [
        '...#',
        '.##.',
        '#..#',
      ]);
    });

    it('should return the same bitmap when it is done twice', function() {
      assert.deepEqual(toAscii(Bitmap.rotate180(Bitmap.rotate180(bitmap))), toAscii(bitmap));
    });

    it('should rotate a bitmap that is not a whole number of bytes wide', function() {
      assert.deepEqual(toAscii(Bitmap.rotate180(fromAscii(['#....#..#..']))), ['..#..#....#']);
    });

    it('should leave an empty bitmap empty', function() {
      assert.deepEqual(Bitmap.rotate180(Bitmap.create(0, 0)), Bitmap.create(0, 0));
    });
  });
});
