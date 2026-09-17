import Painter from '../src/painter.js';
import Bitmap from '../src/bitmap.js';
import profiles from '../generated/profiles.js';
import {stitch} from '../src/formats/stitch.js';
import {toAscii, fromAscii} from './helpers/ascii.js';
import {assert} from 'chai';

/* A narrow printer, eight columns of font A, so that a line fits on screen */

const WIDTH = 96;

/**
 * A painter for the Epson profile
 *
 * @param  {object}   [options]   Options on top of the width and the profile
 * @return {Painter}              The painter
 */
function painter(options) {
  return new Painter(Object.assign({width: WIDTH, profile: profiles.epson}, options || {}));
}

/**
 * An all black bitmap, so that the edges of a block are easy to find
 *
 * @param  {number}   width    Width in dots
 * @param  {number}   height   Height in dots
 * @return {object}            The bitmap
 */
function black(width, height) {
  const bitmap = Bitmap.create(width, height);

  bitmap.data.fill(0xff);

  return bitmap;
}

/**
 * A rectangle of a bitmap, so that a cell of a line can be compared with the
 * same cell elsewhere, and the print area of a page with the same content in
 * another direction
 *
 * @param  {object}   bitmap   The bitmap to cut from
 * @param  {number}   x        Left edge of the rectangle
 * @param  {number}   y        Top row of the rectangle
 * @param  {number}   width    Width of the rectangle
 * @param  {number}   height   Height of the rectangle
 * @return {object}            The rectangle
 */
function crop(bitmap, x, y, width, height) {
  const result = Bitmap.create(width, height);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      Bitmap.setPixel(result, column, row, Bitmap.getPixel(bitmap, x + column, y + row));
    }
  }

  return result;
}

/**
 * The cell of a character on a line of its own, so that a test can look for
 * that character somewhere on the paper without pinning the shape of the font
 *
 * @param  {string}   character   The character to draw
 * @return {object}               The 12 by 24 cell of font A
 */
function cellOf(character) {
  const paper = painter();

  paper.text(character);
  paper.lineFeed();

  return crop(stitch(paper.end(), {width: WIDTH}), 0, 0, 12, 24);
}

describe('Painter', function() {
  describe('options', function() {
    it('should report the width', function() {
      assert.equal(painter().width, WIDTH);
    });

    it('should report the columns of font A', function() {
      assert.equal(painter().columns, 8);
      assert.equal(new Painter({width: 576, profile: profiles.epson}).columns, 48);
    });

    it('should report the profile', function() {
      assert.equal(painter().profile, profiles.epson);
    });

    it('should not accept a width that is not a multiple of eight', function() {
      assert.throws(() => painter({width: 100}), /multiple of 8/);
    });

    it('should not accept a painter without a profile', function() {
      assert.throws(() => new Painter({width: WIDTH}), /profile/);
    });

    it('should not accept a line spacing that is not a positive integer', function() {
      assert.throws(() => painter({lineSpacing: 0}), /Line spacing/);
      assert.throws(() => painter({lineSpacing: -1}), /Line spacing/);
      assert.throws(() => painter({lineSpacing: 30.5}), /Line spacing/);
      assert.throws(() => painter({lineSpacing: '30'}), /Line spacing/);
    });

    it('should not accept a feed threshold that is not a positive integer', function() {
      assert.throws(() => painter({feedThreshold: 0}), /Feed threshold/);
      assert.throws(() => painter({feedThreshold: -1}), /Feed threshold/);
      assert.throws(() => painter({feedThreshold: 1.5}), /Feed threshold/);
    });

    it('should not accept a maximum height that is not a positive integer', function() {
      assert.throws(() => painter({maxHeight: 0}), /Maximum height/);
      assert.throws(() => painter({maxHeight: 10.5}), /Maximum height/);
    });

    it('should take the line spacing of the options over the one of the profile', function() {
      const paper = painter({lineSpacing: 40});

      paper.lineFeed();

      assert.equal(paper.end()[0].height, 40);
    });
  });

  describe('line height', function() {
    it('should advance an empty line by the line spacing', function() {
      const paper = painter();

      paper.lineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should advance a line of text by the line spacing', function() {
      const paper = painter();

      paper.text('Hi');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 30);
    });

    it('should make a line of double height text 48 dots tall', function() {
      const paper = painter();

      paper.style({height: 2});
      paper.text('Hi');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 48);
    });

    it('should follow the line spacing when it is set to 24 dots', function() {
      const paper = painter();

      paper.lineSpacing(24);
      paper.text('Hi');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 24);
    });

    it('should never be shorter than the tallest cell on the line', function() {
      const paper = painter();

      paper.lineSpacing(24);
      paper.style({height: 3});
      paper.text('Hi');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 72);
    });

    it('should restore the default line spacing with null', function() {
      const paper = painter();

      paper.lineSpacing(24);
      paper.lineSpacing(null);
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 30);
    });

    it('should feed more than one line at a time', function() {
      const paper = painter();

      paper.lineFeed(3);

      assert.equal(paper.end()[0].height, 90);
    });

    it('should feed a number of dot rows', function() {
      const paper = painter();

      paper.feed(17);

      assert.equal(paper.end()[0].height, 17);
    });

    it('should not print a line that never got its line feed', function() {
      const paper = painter();

      paper.text('Hi');

      assert.deepEqual(paper.end(), []);
    });

    it('should print the same line when the line feed is there', function() {
      const paper = painter();

      paper.text('Hi');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 30);
    });

    it('should keep the lines that were committed before the unfinished one', function() {
      const paper = painter();

      paper.text('Hi');
      paper.lineFeed();
      paper.text('Ho');

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should not add a line at the end of the stream when nothing is pending', function() {
      assert.deepEqual(painter().end(), []);
    });
  });

  describe('the baseline of a line', function() {
    /* The text cells of a line share the baseline of the font, whatever their
       size: the ascent of a cell is the baseline of the cell times the height
       multiplier and the rest of the cell is its descent, the line is as tall
       as the largest ascent plus the largest descent, and a cell is drawn with
       its baseline on the baseline of the line. That is what an Epson prints */

    it('should put a single height cell on the baseline of a double height line', function() {
      const mixed = painter();
      const alone = painter();

      mixed.text('A');
      mixed.style({height: 2});
      mixed.text('B');
      mixed.lineFeed();

      alone.lineSpacing(24);
      alone.text('A');
      alone.lineFeed();

      const line = stitch(mixed.end(), {width: WIDTH});
      const cell = stitch(alone.end(), {width: WIDTH});

      /* The double height cell is 48 rows with an ascent of 36 and a descent of
         12, the single height one 24 rows with an ascent of 18 and a descent of
         6, so the line is 48 rows and the small cell starts on row 36 - 18 and
         occupies rows 18 to 41, with the descender space of the tall cell in
         the six rows below it */

      assert.equal(line.height, 48);

      assert.deepEqual(toAscii(crop(line, 0, 18, 12, 24)), toAscii(crop(cell, 0, 0, 12, 24)));
      assert.deepEqual(toAscii(crop(line, 0, 0, 12, 18)), toAscii(Bitmap.create(12, 18)));
      assert.deepEqual(toAscii(crop(line, 0, 42, 12, 6)), toAscii(Bitmap.create(12, 6)));
    });

    it('should put the underline of a single height cell on the bottom row of its own cell', function() {
      const paper = painter();

      paper.style({underline: 1});
      paper.text('A');
      paper.style({underline: 0, height: 2});
      paper.text('B');
      paper.lineFeed();

      const line = stitch(paper.end(), {width: WIDTH});

      assert.equal(line.height, 48);

      /* The underline is the bottom row of the cell, which sits on rows 18 to
         41, so it is row 41 and the descender space below it stays white */

      for (let x = 0; x < 12; x++) {
        assert.equal(Bitmap.getPixel(line, x, 41), 1, `dot ${x},41`);
        assert.equal(Bitmap.getPixel(line, x, 42), 0, `dot ${x},42`);
        assert.equal(Bitmap.getPixel(line, x, 47), 0, `dot ${x},47`);
        assert.equal(Bitmap.getPixel(line, x, 17), 0, `dot ${x},17`);
      }
    });

    it('should share the baseline between font A and font B on an Epson', function() {
      const mixed = painter();
      const alone = painter();

      mixed.lineSpacing(24);
      mixed.text('A');
      mixed.font('B');
      mixed.text('B');
      mixed.lineFeed();

      alone.lineSpacing(17);
      alone.font('B');
      alone.text('B');
      alone.lineFeed();

      const line = stitch(mixed.end(), {width: WIDTH});
      const cell = stitch(alone.end(), {width: WIDTH});

      /* The font A cell is 24 rows with an ascent of 18, the font B cell of an
         Epson is 17 rows with an ascent of 12, so the line is 18 + 6 rows and
         the font B cell sits on rows 6 to 22 */

      assert.equal(line.height, 24);

      assert.deepEqual(toAscii(crop(line, 12, 6, 9, 17)), toAscii(crop(cell, 0, 0, 9, 17)));
      assert.deepEqual(toAscii(crop(line, 12, 0, 9, 6)), toAscii(Bitmap.create(9, 6)));
      assert.deepEqual(toAscii(crop(line, 12, 23, 9, 1)), toAscii(Bitmap.create(9, 1)));
    });

    it('should share the baseline between font A and font B on a Star', function() {
      const mixed = painter({profile: profiles.star});
      const alone = painter({profile: profiles.star});

      mixed.lineSpacing(24);
      mixed.text('A');
      mixed.font('B');
      mixed.text('B');
      mixed.lineFeed();

      alone.lineSpacing(24);
      alone.font('B');
      alone.text('B');
      alone.lineFeed();

      const line = stitch(mixed.end(), {width: WIDTH});
      const cell = stitch(alone.end(), {width: WIDTH});

      /* The font B cell of a Star is 24 rows with an ascent of 18, the same as
         font A, so the line is 24 rows, not 26, and the cell starts at the top */

      assert.equal(line.height, 24);

      assert.deepEqual(toAscii(crop(line, 12, 0, 9, 24)), toAscii(crop(cell, 0, 0, 9, 24)));
    });

    it('should put a strip on the bottom of a double height line', function() {
      const paper = painter();

      paper.style({height: 2});
      paper.text('A');
      paper.style({height: 1});
      paper.strip(black(10, 8));
      paper.lineFeed();

      const line = stitch(paper.end(), {width: WIDTH});

      assert.equal(line.height, 48);

      /* The strip of eight rows sits at the cursor, on rows 40 to 47 */

      assert.equal(Bitmap.getPixel(line, 12, 39), 0);
      assert.equal(Bitmap.getPixel(line, 12, 40), 1);
      assert.equal(Bitmap.getPixel(line, 21, 47), 1);
      assert.equal(Bitmap.getPixel(line, 22, 47), 0);
    });

    it('should leave a line whose cells are all the same height where it was', function() {
      const spaced = painter();
      const tight = painter();

      spaced.text('Hi');
      spaced.lineFeed();

      tight.lineSpacing(24);
      tight.text('Hi');
      tight.lineFeed();

      const line = stitch(spaced.end(), {width: WIDTH});
      const cell = stitch(tight.end(), {width: WIDTH});

      /* The gap of the line spacing is the six rows below the cells, so the
         cells are the top 24 rows of the 30 dot line */

      assert.equal(line.height, 30);
      assert.deepEqual(toAscii(crop(line, 0, 0, WIDTH, 24)), toAscii(cell));
    });
  });

  describe('the reverse feed', function() {
    it('should print the pending line before it moves the paper back', function() {
      const paper = painter();

      paper.lineSpacing(24);
      paper.text('A');
      paper.reverseLineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 24);
    });

    it('should draw the line behind it over the line it moved back over', function() {
      const paper = painter();
      const same = painter();

      paper.lineSpacing(24);
      paper.text('A');
      paper.reverseLineFeed();
      paper.position(12);
      paper.text('B');
      paper.lineFeed();

      same.lineSpacing(24);
      same.text('AB');
      same.lineFeed();

      assert.deepEqual(
          toAscii(stitch(paper.end(), {width: WIDTH})),
          toAscii(stitch(same.end(), {width: WIDTH})),
      );
    });

    it('should move back no further than the rows it still holds', function() {
      const paper = painter();
      const same = painter();

      paper.lineSpacing(24);
      paper.text('A');
      paper.lineFeed();
      paper.text('B');
      paper.reverseFeed(1000);
      paper.position(12);
      paper.text('C');
      paper.lineFeed();

      same.lineSpacing(24);
      same.text('AC');
      same.lineFeed();
      same.text('B');
      same.lineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 48);

      assert.deepEqual(
          toAscii(stitch(items, {width: WIDTH})),
          toAscii(stitch(same.end(), {width: WIDTH})),
      );
    });

    it('should not move back into the rows that were flushed to an item', function() {
      const paper = painter({commands: ['cut']});

      paper.lineSpacing(24);
      paper.text('A');
      paper.lineFeed();
      paper.command({type: 'cut', value: 'full'});
      paper.text('B');
      paper.reverseLineFeed(2);
      paper.text('C');
      paper.lineFeed();

      const items = paper.end();

      assert.deepEqual(items.map((item) => item.type), ['image', 'cut', 'image']);
      assert.equal(items[0].height, 24);
      assert.equal(items[2].height, 24);
    });

    it('should not count a row as blank once ink is drawn over it', function() {
      const paper = painter({commands: ['feed'], feedThreshold: 40});

      paper.feed(48);
      paper.reverseFeed(48);
      paper.text('A');
      paper.lineFeed();

      const items = paper.end();

      assert.deepEqual(items.map((item) => item.type), ['image']);
      assert.equal(items[0].height, 48);
    });

    it('should ignore a move that is not a positive number of dots', function() {
      const paper = painter();

      paper.lineSpacing(24);
      paper.text('A');
      paper.lineFeed();
      paper.reverseFeed(0);
      paper.reverseFeed(-10);
      paper.reverseFeed(1.5);
      paper.text('B');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 48);
    });
  });

  describe('wrapping', function() {
    it('should wrap a line that is longer than the print width', function() {
      const paper = painter();

      paper.text('123456789');
      paper.lineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 60);
    });

    it('should keep the content of both lines', function() {
      const paper = painter();

      paper.text('AAAAAAAAB');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The ninth character is the only ink on the second line, and it is in
         the first cell of that line */

      let first = 0;
      let beyond = 0;

      for (let y = 30; y < 60; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (Bitmap.getPixel(bitmap, x, y)) {
            if (x < 12) {
              first++;
            } else {
              beyond++;
            }
          }
        }
      }

      assert.isAbove(first, 0);
      assert.equal(beyond, 0);
    });
  });

  describe('alignment', function() {
    it('should put a left aligned line against the left edge', function() {
      const paper = painter();

      paper.align('left');
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 87, 10), 0);
    });

    it('should put a right aligned line against the right edge', function() {
      const paper = painter();

      paper.align('right');
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 0);
      assert.equal(Bitmap.getPixel(bitmap, 87, 10), 1);
    });

    it('should centre a centred line', function() {
      const paper = painter();

      paper.align('center');
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 0);
      assert.equal(Bitmap.getPixel(bitmap, 45, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 87, 10), 0);
    });

    it('should not accept an alignment it does not know', function() {
      assert.throws(() => painter().align('middle'));
    });
  });

  describe('strip()', function() {
    it('should place a strip at the cursor', function() {
      const paper = painter();

      paper.text('A');
      paper.strip(black(10, 8));
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The strip stands on the baseline of the line, the bottom edge of the
         24 dot cell before it, so its eight rows are 16 to 23 */

      assert.equal(Bitmap.getPixel(bitmap, 11, 16), 0);
      assert.equal(Bitmap.getPixel(bitmap, 12, 16), 1);
      assert.equal(Bitmap.getPixel(bitmap, 21, 16), 1);
      assert.equal(Bitmap.getPixel(bitmap, 22, 16), 0);
      assert.equal(Bitmap.getPixel(bitmap, 12, 23), 1);
      assert.equal(Bitmap.getPixel(bitmap, 12, 15), 0);
      assert.equal(Bitmap.getPixel(bitmap, 12, 24), 0);
    });

    it('should make the line as tall as the strip when the strip is taller', function() {
      const paper = painter();

      paper.strip(black(10, 40));
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 40);
    });
  });

  describe('block()', function() {
    it('should draw a block on a line of its own', function() {
      const paper = painter();

      paper.block(black(WIDTH, 10));

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 10);
    });

    it('should commit the pending line first', function() {
      const paper = painter();

      paper.text('A');
      paper.block(black(WIDTH, 10));

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 40);
    });

    it('should align a block the way the current alignment says', function() {
      const paper = painter();

      paper.align('center');
      paper.block(black(48, 10));

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 23, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 24, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 71, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 72, 0), 0);
    });

    it('should align a block to the right', function() {
      const paper = painter();

      paper.align('right');
      paper.block(black(48, 10));

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 47, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 48, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 95, 0), 1);
    });
  });

  describe('define(), forget() and print()', function() {
    it('should draw an image that was defined as a block', function() {
      const paper = painter();

      paper.define('nv:65:66', black(48, 10));

      assert.isTrue(paper.print('nv:65:66'));

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 10);
    });

    it('should print nothing at all for a key that was never defined', function() {
      const paper = painter();

      paper.text('A');

      assert.isFalse(paper.print('nv:65:66'));

      /* The pending line is not committed either: a printer without the image
         does nothing at all with the command, and the A is still in the line
         buffer when the stream ends, so it never prints */

      assert.deepEqual(paper.end(), []);
    });

    it('should scale the image by repeating its dots', function() {
      const paper = painter();

      paper.define('dl:67:68', black(24, 10));
      paper.print('dl:67:68', {scale: {x: 2, y: 2}});

      const items = paper.end();
      const bitmap = stitch(items, {width: WIDTH});

      assert.equal(items[0].height, 20);
      assert.equal(Bitmap.getPixel(bitmap, 47, 19), 1);
      assert.equal(Bitmap.getPixel(bitmap, 48, 19), 0);
    });

    it('should align the image the way the current alignment says', function() {
      const paper = painter();

      paper.define('dl:67:68', black(48, 10));
      paper.align('right');
      paper.print('dl:67:68');

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 47, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 48, 0), 1);
    });

    it('should delete an image with a definition without a bitmap', function() {
      const paper = painter();

      paper.define('nv:65:66', black(48, 10));
      paper.define('nv:65:66', null);

      assert.isFalse(paper.print('nv:65:66'));
    });

    it('should delete every image of a prefix with forget()', function() {
      const paper = painter();

      paper.define('nv:65:66', black(48, 10));
      paper.define('nv:67:68', black(48, 10));
      paper.define('dl:65:66', black(48, 10));

      paper.forget('nv:');

      assert.isFalse(paper.print('nv:65:66'));
      assert.isFalse(paper.print('nv:67:68'));
      assert.isTrue(paper.print('dl:65:66'));
    });

    it('should keep the definitions through a reset and a discard', function() {
      const paper = painter();

      paper.define('nv:65:66', black(48, 10));

      paper.reset();
      paper.discard();

      assert.isTrue(paper.print('nv:65:66'));
    });
  });

  describe('barcodes and QR codes', function() {
    it('should draw a barcode as a block of its own', function() {
      const paper = painter();

      /* Ninety five modules of one dot, which is the widest barcode that fits
         on this narrow printer */

      paper.barcode({symbology: 'ean13', data: '4006381333931', moduleWidth: 1, height: 40});

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 40);
      assert.equal(Bitmap.getPixel(bitmap, 0, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 1, 39), 0);
      assert.equal(Bitmap.getPixel(bitmap, 94, 39), 1);
      assert.equal(Bitmap.getPixel(bitmap, 95, 0), 0);
    });

    it('should draw nothing for bars that are wider than the print area', function() {
      const paper = painter();

      /* Ninety five modules of two dots do not fit on this narrow printer */

      paper.barcode({symbology: 'ean13', data: '4006381333931', moduleWidth: 2, height: 40});

      assert.deepEqual(paper.end(), []);
    });

    it('should draw nothing for a QR code that is wider than the print area', function() {
      const paper = painter();

      paper.qrcode({data: new TextEncoder().encode('test'), moduleSize: 8, errorLevel: 'M'});

      assert.deepEqual(paper.end(), []);
    });

    it('should draw nothing when there is no data to encode', function() {
      const paper = painter();

      paper.qrcode({data: new Uint8Array(0), moduleSize: 3, errorLevel: 'M'});

      assert.deepEqual(paper.end(), []);
    });

    it('should draw nothing for data the symbology cannot carry, and say so', function() {
      const paper = painter();

      paper.text('Hi');

      assert.isFalse(paper.barcode({symbology: 'ean13', data: 'nonsense', moduleWidth: 2, height: 40}));

      paper.lineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should say a barcode was drawn, and say so for one that does not fit either', function() {
      const paper = painter();

      /* The data is valid in both, the second is refused for its width alone,
         which is not a reason to print the data as text */

      assert.isTrue(paper.barcode({symbology: 'ean13', data: '4006381333931', moduleWidth: 1, height: 40}));
      assert.isTrue(paper.barcode({symbology: 'ean13', data: '4006381333931', moduleWidth: 2, height: 40}));
    });

    it('should draw nothing for a symbology it does not know', function() {
      const paper = painter();

      paper.barcode({symbology: 'pharmacode', data: '1234', moduleWidth: 2, height: 40});

      assert.deepEqual(paper.end(), []);
    });

    it('should add a line of text below the bars', function() {
      const paper = painter();

      paper.barcode({
        symbology: 'ean13',
        data: '4006381333931',
        moduleWidth: 1,
        height: 40,
        hri: {position: 'below', font: 'A'},
      });

      const items = paper.end();

      /* The bars, the four dot gap and one line of font A cells */

      assert.equal(items[0].height, 40 + 4 + 24);
    });

    /*
        Where the human readable text goes, read off the display list of a wide
        painter: section 23 of the implementation plan, measured on an Epson
        TM-T70. A cell of font A is twelve dots wide in the Epson profile.
    */

    const CELL = 12;

    /**
     * The operations of the one block a barcode lays out
     *
     * @param  {object}   request   The barcode to draw
     * @return {object[]}           The operations of the block
     */
    function block(request) {
      const paper = new Painter({width: 576, profile: profiles.epson});

      paper.collect();
      paper.barcode(request);

      const list = paper.end();

      assert.equal(list.entries.length, 1, 'the barcode is one block');

      return list.entries[0].operations;
    }

    /**
     * The left edge of every text cell of a block, in the order they were laid
     * out, relative to the left edge of the leftmost operation of the block
     *
     * @param  {object[]}   operations   The operations of the block
     * @return {number[]}                The positions
     */
    function cells(operations) {
      const left = Math.min(...operations.map((operation) => operation.x));

      return operations
          .filter((operation) => operation.type === 'text')
          .map((operation) => operation.x - left);
    }

    it('should put the digits of a UPC-A in two groups under the modules that encode them', function() {
      const operations = block({
        symbology: 'upca', data: '012345678901', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      /* A group of six cells is 72 dots and a range of 42 modules is 126, so a
         group starts 27 dots into its range: at 3 * 3 + 27 and at 50 * 3 + 27 */

      const starts = [0, 6].map((index) => cells(operations)[index]);

      assert.deepEqual(starts, [36, 177]);
      assert.equal(cells(operations).length, 12);
    });

    it('should put the digits of an EAN-8 in two groups of four', function() {
      const operations = block({
        symbology: 'ean8', data: '96385074', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      /* Four cells are 48 dots and a range of 28 modules is 84, so a group
         starts 18 dots into its range: at 3 * 3 + 18 and at 36 * 3 + 18 */

      const starts = [0, 4].map((index) => cells(operations)[index]);

      assert.deepEqual(starts, [27, 126]);
    });

    it('should leave an EAN-13 as one centred run', function() {
      const operations = block({
        symbology: 'ean13', data: '4006381333931', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      const positions = cells(operations);

      /* Thirteen cells, every one a cell width behind the one before it */

      assert.equal(positions.length, 13);
      assert.deepEqual(
          positions.map((x, index) => x - positions[0]),
          positions.map((x, index) => index * CELL),
      );
    });

    it('should spread the characters of a Code 39 over the bars, a whole interval at each end', function() {
      const operations = block({
        symbology: 'code39', data: 'ABC 012', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      /* `*ABC 012*` is nine cells, and the bars are 9 * 16 - 1 = 143 modules of
         three dots, 429. The bars are divided into ten intervals of 42.9 dots
         and a character is centred on each of the nine interior points */

      const positions = cells(operations);
      const pitch = 429 / 10;

      assert.equal(positions.length, 9);
      assert.deepEqual(
          positions,
          positions.map((x, index) => Math.round((index + 1) * pitch - CELL / 2)),
      );

      /* Which leaves the same margin on both sides, a whole interval wide */

      assert.closeTo(positions[0] + CELL / 2, pitch, 0.5);
      assert.closeTo(429 - (positions[8] + CELL / 2), pitch, 0.5);
    });

    it('should centre the run of a spread symbology when the text is wider than the bars', function() {
      /* A Codabar of seven characters is 71 modules, 71 dots at a module width
         of one, and seven cells of font A are 84: the spread has no room and
         the text falls back to the centred run of every other symbology */

      const operations = block({
        symbology: 'codabar', data: 'A12345A', moduleWidth: 1, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      const positions = cells(operations);

      assert.equal(positions.length, 7);
      assert.deepEqual(
          positions.map((x) => x - positions[0]),
          positions.map((x, index) => index * CELL),
      );
    });

    it('should draw the start and the stop character of a Code 93 as a hollow box', function() {
      const operations = block({
        symbology: 'code93', data: 'TEST93', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      /* Six characters between two boxes, so six text cells and, on top of the
         bars, the four rectangles of each box */

      assert.equal(cells(operations).length, 6);

      const boxes = operations.filter((operation) => operation.type === 'rect' && operation.y >= 40);

      assert.equal(boxes.length, 8);

      /* Half a cell wide and a third of a cell high, in lines of one dot: six
         by eight dots for the 12 by 24 cell of font A */

      const first = boxes.slice(0, 4);

      assert.deepEqual(first.map((rectangle) => rectangle.width), [6, 6, 1, 1]);
      assert.deepEqual(first.map((rectangle) => rectangle.height), [1, 1, 6, 6]);
      assert.equal(first[1].y - first[0].y, 7);
      assert.equal(first[3].x - first[0].x, 5);
    });

    it('should put the box on the middle of a digit, not on the middle of the cell', function() {
      const operations = block({
        symbology: 'code93', data: 'TEST93', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      /* The cell of font A is 24 rows with its baseline on row 18, so the
         middle of a digit is row 9 and an eight dot box covers rows 5 to 12 of
         the cell. The cells start at the top of the text line, which is the
         height of the bars plus the four dot gap */

      const top = 40 + 4;
      const boxes = operations.filter((operation) => operation.type === 'rect' && operation.y >= 40);

      assert.equal(boxes[0].y - top, 5);
      assert.equal(boxes[1].y - top, 12);
    });

    it('should count the boxes of a Code 93 as characters of the spread', function() {
      const operations = block({
        symbology: 'code93', data: 'TEST93', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      /* Eight cells over 91 modules of three dots: nine intervals of 273 / 9
         dots, and the first box is centred on the first interior point */

      const left = Math.min(...operations.map((operation) => operation.x));
      const pitch = 273 / 9;
      const first = operations.filter((operation) => operation.type === 'rect' && operation.y >= 40)[0];

      /* The box is centred in its cell, three dots in for a six dot box */

      assert.equal(first.x - left - 3, Math.round(pitch - CELL / 2));
      assert.equal(cells(operations)[0], Math.round(2 * pitch - CELL / 2));
    });

    it('should print the text of a Code 93 as it was sent, lower case included', function() {
      const operations = block({
        symbology: 'code93', data: '012abcd', moduleWidth: 3, height: 40,
        hri: {position: 'below', font: 'A'},
      });

      const text = operations
          .filter((operation) => operation.type === 'text')
          .map((operation) => String.fromCodePoint(operation.fields ? operation.fields.codepoint : operation.codepoint))
          .join('');

      assert.equal(text, '012abcd');
    });

    it('should draw a QR code as a block of its own', function() {
      const paper = painter();

      paper.qrcode({data: new TextEncoder().encode('test'), moduleSize: 3, errorLevel: 'M'});

      const items = paper.end();

      assert.equal(items[0].height, 21 * 3);
    });

    it('should draw nothing for data that does not fit in a QR code', function() {
      const paper = painter();

      paper.qrcode({data: new Uint8Array(4000).fill(0x41), moduleSize: 3, errorLevel: 'H'});

      assert.deepEqual(paper.end(), []);
    });

    it('should draw a PDF417 as a block of its own', function() {
      const paper = painter();

      paper.pdf417({
        data: new TextEncoder().encode('RENDER'),
        columns: 1,
        moduleWidth: 1,
        rowHeight: 3,
        errorLevel: 2,
      });

      const items = paper.end();

      /* Twelve codewords in one column, and a row is three modules of one dot */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 12 * 3);
    });

    it('should align a PDF417 the way the current alignment says', function() {
      const symbol = (align) => {
        const paper = painter();

        paper.align(align);
        paper.pdf417({
          data: new TextEncoder().encode('RENDER'),
          columns: 1,
          moduleWidth: 1,
          rowHeight: 3,
          errorLevel: 2,
          truncated: true,
        });

        return stitch(paper.end(), {width: WIDTH});
      };

      /* A truncated symbol of one column is 17 * 3 + 1 dots wide and every row
         of it starts with the eight bars of the start pattern */

      assert.equal(Bitmap.getPixel(symbol('left'), 0, 0), 1);
      assert.equal(Bitmap.getPixel(symbol('right'), 0, 0), 0);
      assert.equal(Bitmap.getPixel(symbol('right'), WIDTH - 52, 0), 1);
      assert.equal(Bitmap.getPixel(symbol('center'), (WIDTH - 52) >> 1, 0), 1);
    });

    it('should draw nothing for a PDF417 that is wider than the print area', function() {
      const paper = painter();

      paper.pdf417({data: new TextEncoder().encode('RENDER'), columns: 4, moduleWidth: 2, rowHeight: 3});

      assert.deepEqual(paper.end(), []);
    });

    it('should draw nothing when there is no data for a PDF417', function() {
      const paper = painter();

      paper.pdf417({data: new Uint8Array(0), moduleWidth: 1, rowHeight: 3});

      assert.deepEqual(paper.end(), []);
    });

    it('should draw nothing for data that does not fit in a PDF417', function() {
      const paper = painter();

      paper.pdf417({
        data: new Uint8Array(4000).fill(0x41),
        columns: 1,
        moduleWidth: 1,
        rowHeight: 3,
        errorLevel: 2,
      });

      assert.deepEqual(paper.end(), []);
    });
  });

  describe('blank rows', function() {
    it('should turn a run of blank rows into a feed item', function() {
      const paper = painter({commands: ['feed']});

      paper.block(black(WIDTH, 10));
      paper.lineFeed(2);
      paper.block(black(WIDTH, 10));

      assert.deepEqual(paper.end(), [
        {type: 'image', width: WIDTH, height: 10, data: black(WIDTH, 10).data},
        {type: 'feed', height: 60},
        {type: 'image', width: WIDTH, height: 10, data: black(WIDTH, 10).data},
      ]);
    });

    it('should leave a run shorter than the threshold in the image', function() {
      const paper = painter({commands: ['feed']});

      paper.block(black(WIDTH, 10));
      paper.feed(20);
      paper.block(black(WIDTH, 10));

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 40);
    });

    it('should follow the feed threshold', function() {
      const paper = painter({commands: ['feed'], feedThreshold: 60});

      paper.block(black(WIDTH, 10));
      paper.lineFeed();
      paper.block(black(WIDTH, 10));
      paper.lineFeed(2);
      paper.block(black(WIDTH, 10));

      assert.deepEqual(
          paper.end().map((item) => `${item.type}:${item.height}`),
          ['image:50', 'feed:60', 'image:10'],
      );
    });

    it('should keep the blank rows in the image when feed is not supported', function() {
      const paper = painter();

      paper.block(black(WIDTH, 10));
      paper.lineFeed(2);
      paper.block(black(WIDTH, 10));

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 80);
    });

    it('should turn blank rows at the start and the end into feed items', function() {
      const paper = painter({commands: ['feed']});

      paper.lineFeed();
      paper.block(black(WIDTH, 10));
      paper.lineFeed();

      assert.deepEqual(
          paper.end().map((item) => `${item.type}:${item.height}`),
          ['feed:30', 'image:10', 'feed:30'],
      );
    });

    it('should never emit an image of no height', function() {
      const paper = painter({commands: ['feed']});

      paper.lineFeed();

      assert.deepEqual(paper.end().map((item) => item.type), ['feed']);
    });
  });

  describe('maxHeight', function() {
    it('should split an image into consecutive pieces', function() {
      const paper = painter({maxHeight: 24});

      paper.block(black(WIDTH, 100));

      const items = paper.end();

      assert.deepEqual(items.map((item) => item.height), [24, 24, 24, 24, 4]);
    });

    it('should lose nothing when it splits', function() {
      const split = painter({maxHeight: 24});
      const whole = painter();

      for (const paper of [split, whole]) {
        paper.text('Hello');
        paper.lineFeed();
        paper.block(black(WIDTH, 40));
      }

      assert.deepEqual(
          Array.from(stitch(split.end(), {width: WIDTH}).data),
          Array.from(stitch(whole.end(), {width: WIDTH}).data),
      );
    });
  });

  describe('command()', function() {
    it('should emit a command the driver supports', function() {
      const paper = painter({commands: ['cut']});

      paper.block(black(WIDTH, 10));
      paper.command({type: 'cut', value: 'partial'});

      assert.deepEqual(
          paper.end().map((item) => item.type),
          ['image', 'cut'],
      );
    });

    it('should drop a command the driver does not support', function() {
      const paper = painter();

      paper.block(black(WIDTH, 10));
      paper.command({type: 'pulse', device: 0, on: 100, off: 500});

      assert.deepEqual(paper.end().map((item) => item.type), ['image']);
    });

    it('should not split the image on a command it drops', function() {
      const paper = painter();

      paper.block(black(WIDTH, 10));
      paper.command({type: 'cut', value: 'partial'});
      paper.block(black(WIDTH, 10));

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 20);
    });

    it('should not break a run of blank rows on a command it drops', function() {
      const paper = painter({commands: ['feed']});

      paper.block(black(WIDTH, 10));
      paper.lineFeed();
      paper.command({type: 'cut', value: 'partial'});
      paper.lineFeed();
      paper.block(black(WIDTH, 10));

      assert.deepEqual(
          paper.end().map((item) => `${item.type}:${item.height}`),
          ['image:10', 'feed:60', 'image:10'],
      );
    });

    it('should keep a line that is half composed', function() {
      const paper = painter({commands: ['pulse']});

      paper.text('AB');
      paper.command({type: 'pulse', device: 0, on: 100, off: 500});
      paper.text('CD');
      paper.lineFeed();

      const items = paper.end();

      assert.deepEqual(items.map((item) => item.type), ['pulse', 'image']);
      assert.equal(items[1].height, 30);
    });
  });

  describe('reset()', function() {
    it('should restore the styles without losing the paper', function() {
      const paper = painter();

      paper.block(black(WIDTH, 10));
      paper.style({height: 2});
      paper.reset();
      paper.text('A');
      paper.lineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 40);
    });
  });

  describe('discard()', function() {
    it('should throw away the rows and the items', function() {
      const paper = painter({commands: ['cut']});

      paper.block(black(WIDTH, 10));
      paper.command({type: 'cut', value: 'partial'});
      paper.block(black(WIDTH, 10));
      paper.text('A');

      paper.discard();

      assert.deepEqual(paper.end(), []);
    });

    it('should restore the styles', function() {
      const paper = painter();

      paper.style({height: 2});
      paper.align('right');
      paper.discard();
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 30);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
    });
  });

  describe('end()', function() {
    it('should reset the styles for the next stream', function() {
      const paper = painter();

      paper.style({height: 2});
      paper.align('right');
      paper.lineSpacing(24);
      paper.font('B');
      paper.text('A');
      paper.end();

      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 30);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
    });
  });

  describe('spacing()', function() {
    it('should leave the space behind every cell', function() {
      const paper = painter();

      paper.spacing(4);
      paper.text('AA');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The second cell starts one cell plus four dots from the left */

      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3 + 16, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3 + 12, 10), 0);
    });

    it('should scale the space with the width multiplier', function() {
      const paper = painter({width: 576});

      paper.spacing(4);
      paper.style({width: 2});
      paper.text('AA');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: 576});

      /* The cell of 24 dots and the space of eight behind it: the second cell
         is the first one 32 dots to the right */

      for (let x = 0; x < 24; x++) {
        for (let y = 0; y < 48; y++) {
          assert.equal(
              Bitmap.getPixel(bitmap, x + 32, y),
              Bitmap.getPixel(bitmap, x, y),
              `dot ${x}, ${y}`,
          );
        }
      }
    });

    it('should not count the space of the last cell in the alignment', function() {
      const spaced = painter();
      const plain = painter();

      spaced.align('right');
      spaced.spacing(4);
      spaced.text('A');
      spaced.lineFeed();

      plain.align('right');
      plain.text('A');
      plain.lineFeed();

      assert.deepEqual(spaced.end(), plain.end());
    });

    it('should refuse a spacing that is not a positive number of dots', function() {
      const paper = painter();

      paper.spacing(4);
      paper.spacing(-1);
      paper.text('AA');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 3 + 16, 10), 1);
    });

    it('should carry the spacing on the cells of a placeholder as well', function() {
      const paper = painter();

      paper.collect();
      paper.spacing(4);
      paper.text('A');
      paper.placeholder(2);
      paper.lineFeed();

      const operations = paper.end().entries[0].operations;

      assert.deepEqual(operations.map((operation) => operation.spacing), [4, 4, 4]);
      assert.deepEqual(operations.map((operation) => operation.x), [0, 16, 32]);
      assert.deepEqual(operations.map((operation) => operation.width), [12, 12, 12]);
    });

    it('should leave the space behind a plain cell white', function() {
      const paper = painter();

      paper.spacing(4);
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      for (let y = 0; y < 30; y++) {
        for (let x = 12; x < 16; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 0, `dot ${x}, ${y}`);
        }
      }
    });

    it('should paint the space behind an inverted cell black, the last cell of the line too', function() {
      const paper = painter();

      paper.spacing(4);
      paper.style({invert: true});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The only cell of the line is its last one, and the four dots behind it
         are black over the whole height of the cell, which is what the Epson
         printout of the escpost fixture shows */

      for (let y = 0; y < 24; y++) {
        for (let x = 12; x < 16; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 1, `dot ${x}, ${y}`);
        }
      }

      /* The gap of the line spacing below the cell stays white, and so does the
         paper behind the spacing */

      for (let x = 12; x < 16; x++) {
        assert.equal(Bitmap.getPixel(bitmap, x, 24), 0, `dot ${x}, 24`);
      }

      for (let y = 0; y < 30; y++) {
        assert.equal(Bitmap.getPixel(bitmap, 16, y), 0, `dot 16, ${y}`);
      }
    });

    it('should draw the underline through the space behind an underlined cell', function() {
      const paper = painter();

      paper.spacing(4);
      paper.style({underline: 2});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The two bottom rows of the cell, rows 22 and 23, run on over the four
         dots of the spacing; the row above them and the row below them do not,
         and neither does the paper behind the spacing */

      for (let x = 12; x < 16; x++) {
        assert.equal(Bitmap.getPixel(bitmap, x, 21), 0, `dot ${x}, 21`);
        assert.equal(Bitmap.getPixel(bitmap, x, 22), 1, `dot ${x}, 22`);
        assert.equal(Bitmap.getPixel(bitmap, x, 23), 1, `dot ${x}, 23`);
        assert.equal(Bitmap.getPixel(bitmap, x, 24), 0, `dot ${x}, 24`);
      }

      assert.equal(Bitmap.getPixel(bitmap, 16, 23), 0);
    });

    it('should draw the upperline through the space behind an upperlined cell', function() {
      const paper = painter();

      paper.spacing(4);
      paper.style({upperline: 1});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      for (let x = 12; x < 16; x++) {
        assert.equal(Bitmap.getPixel(bitmap, x, 0), 1, `dot ${x}, 0`);
        assert.equal(Bitmap.getPixel(bitmap, x, 1), 0, `dot ${x}, 1`);
      }

      assert.equal(Bitmap.getPixel(bitmap, 16, 0), 0);
    });

    it('should draw no line through the space behind an inverted cell', function() {
      const underlined = painter();
      const plain = painter();

      const styles = [[underlined, {invert: true, underline: 2, upperline: 1}], [plain, {invert: true}]];

      for (const [paper, style] of styles) {
        paper.spacing(4);
        paper.style(style);
        paper.text('A');
        paper.lineFeed();
      }

      assert.deepEqual(underlined.end(), plain.end());
    });

    it('should draw no line through the space behind a cell turned by ESC V', function() {
      const underlined = painter();
      const plain = painter();

      const styles = [[underlined, {rotate: true, underline: 2, upperline: 1}], [plain, {rotate: true}]];

      for (const [paper, style] of styles) {
        paper.spacing(4);
        paper.style(style);
        paper.text('A');
        paper.lineFeed();
      }

      assert.deepEqual(underlined.end(), plain.end());

      /* The turned cell is 24 dots wide and 12 tall, and the four dots of the
         spacing behind it stay white over all of it */

      const bitmap = stitch(plain.end(), {width: WIDTH});

      for (let y = 0; y < 30; y++) {
        for (let x = 24; x < 28; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 0, `dot ${x}, ${y}`);
        }
      }
    });

    it('should paint the space behind a turned cell that is inverted', function() {
      const paper = painter();

      paper.spacing(4);
      paper.style({rotate: true, invert: true});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      for (let y = 0; y < 12; y++) {
        for (let x = 24; x < 28; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 1, `dot ${x}, ${y}`);
        }
      }

      for (let x = 24; x < 28; x++) {
        assert.equal(Bitmap.getPixel(bitmap, x, 12), 0, `dot ${x}, 12`);
      }
    });

    it('should cut the spacing of the last cell at the right edge of the print area', function() {
      const paper = painter({width: 576});

      paper.collect();
      paper.margins({left: 24, width: 96});
      paper.align('right');
      paper.spacing(4);
      paper.style({invert: true});
      paper.text('AB');
      paper.lineFeed();

      /* The area runs from 24 to 120 and a right aligned line ends on its right
         edge, so the last cell has no room for its four dots and the one in
         front of it has all four */

      const operations = paper.end().entries[0].operations;

      assert.deepEqual(operations.map((operation) => operation.x), [92, 108]);
      assert.deepEqual(operations.map((operation) => operation.spacing), [4, 0]);
    });

    it('should leave the margin beside the print area white under reverse', function() {
      const paper = painter({width: 576});

      paper.margins({left: 24, width: 96});
      paper.align('right');
      paper.spacing(4);
      paper.style({invert: true});
      paper.text('AB');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: 576});

      /* The spacing between the two cells is painted */

      for (let y = 0; y < 24; y++) {
        for (let x = 104; x < 108; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 1, `dot ${x}, ${y}`);
        }
      }

      /* And nothing at all is printed to the right of the area */

      for (let y = 0; y < 30; y++) {
        for (let x = 120; x < 576; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 0, `dot ${x}, ${y}`);
        }
      }
    });

    it('should leave the gaps of a tab and of a position white under reverse', function() {
      const paper = painter({width: 576});

      paper.spacing(4);
      paper.style({invert: true});
      paper.text('A');
      paper.tab();
      paper.text('B');
      paper.position(300);
      paper.text('C');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: 576});

      /* A stop of the default tabs is eight characters of font A, which is
         eight cells of twelve dots and eight spacings of four, 128 dots */

      for (const x of [12, 15, 140, 143, 312, 315]) {
        assert.equal(Bitmap.getPixel(bitmap, x, 10), 1, `dot ${x}, 10`);
      }

      /* The dots the tab and the position skipped are not spacing and stay
         white, up to the cell the cursor landed on */

      for (const x of [16, 64, 127, 144, 220, 299, 316, 400]) {
        assert.equal(Bitmap.getPixel(bitmap, x, 10), 0, `dot ${x}, 10`);
      }
    });
  });

  describe('position()', function() {
    it('should move the cursor', function() {
      const paper = painter();

      paper.position(24);
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 27, 10), 1);
      assert.equal(paper.cursor, 0);
    });

    it('should report where the cursor is', function() {
      const paper = painter();

      paper.text('AB');

      assert.equal(paper.cursor, 24);

      paper.position(48);

      assert.equal(paper.cursor, 48);
    });

    it('should ignore a position beyond the print area', function() {
      const paper = painter();

      paper.text('A');
      paper.position(WIDTH + 1);

      assert.equal(paper.cursor, 12);
    });

    it('should ignore a position that is not a number of dots', function() {
      const paper = painter();

      paper.position(-1);
      paper.position(1.5);

      assert.equal(paper.cursor, 0);
    });
  });

  describe('tabs() and tab()', function() {
    it('should move to the next stop of eight characters by default', function() {
      const paper = painter({width: 576});

      paper.text('A');
      paper.tab();

      assert.equal(paper.cursor, 96);
    });

    it('should move to the stops it was given, in characters', function() {
      const paper = painter();

      paper.tabs([2, 4]);
      paper.tab();

      assert.equal(paper.cursor, 24);

      paper.tab();

      assert.equal(paper.cursor, 48);
    });

    it('should do nothing past the last stop', function() {
      const paper = painter();

      paper.tabs([2]);
      paper.tab();
      paper.tab();

      assert.equal(paper.cursor, 24);
    });

    it('should put the cursor past the print area when the stop is outside it', function() {
      const paper = painter();

      paper.tabs([8]);
      paper.tab();

      /* One dot beyond the area, so that the next cell wraps to a new line */

      assert.equal(paper.cursor, WIDTH + 1);

      paper.text('A');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 60);
    });

    it('should take the character width of the current font', function() {
      const paper = painter();

      paper.font('B');
      paper.tabs([2]);
      paper.tab();

      assert.equal(paper.cursor, 18);
    });

    it('should stop at a stop that does not ascend', function() {
      const paper = painter();

      paper.tabs([2, 1, 4]);
      paper.tab();
      paper.tab();

      assert.equal(paper.cursor, 24);
    });

    it('should cancel every stop for an empty list', function() {
      const paper = painter({width: 576});

      paper.tabs([2]);
      paper.tabs([]);
      paper.tab();

      assert.equal(paper.cursor, 0);
    });

    it('should go back to the default stops for null', function() {
      const paper = painter({width: 576});

      paper.tabs([]);
      paper.tabs(null);
      paper.tab();

      assert.equal(paper.cursor, 96);
    });

    it('should go back to the default stops on a reset', function() {
      const paper = painter({width: 576});

      paper.tabs([]);
      paper.reset();
      paper.tab();

      assert.equal(paper.cursor, 96);
    });

    it('should count the character spacing in the width of a character', function() {
      const paper = painter({width: 576});

      paper.spacing(4);
      paper.tabs([2]);
      paper.tab();

      assert.equal(paper.cursor, 32);
    });
  });

  describe('margins()', function() {
    it('should start the line at the left margin', function() {
      const paper = painter();

      paper.margins({left: 12});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 15, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 0);
    });

    it('should align inside the print area', function() {
      const paper = painter();

      paper.margins({left: 12, width: 24});
      paper.align('right');
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 27, 10), 1);
    });

    it('should wrap at the print area', function() {
      const paper = painter();

      paper.margins({width: 24});
      paper.text('AAA');
      paper.lineFeed();

      assert.equal(paper.end()[0].height, 60);
    });

    it('should clamp a print area that does not fit on the paper', function() {
      const clamped = painter();
      const full = painter();

      clamped.margins({width: WIDTH * 2});
      clamped.align('right');
      clamped.text('A');
      clamped.lineFeed();

      full.align('right');
      full.text('A');
      full.lineFeed();

      assert.deepEqual(clamped.end(), full.end());
    });

    it('should be ignored while a line is being composed', function() {
      const margin = painter();
      const plain = painter();

      for (const paper of [margin, plain]) {
        paper.text('A');

        if (paper === margin) {
          paper.margins({left: 12});
        }

        paper.lineFeed();
        paper.text('A');
        paper.lineFeed();
      }

      assert.deepEqual(margin.end(), plain.end());
    });

    it('should be ignored when the cursor was moved on an empty line', function() {
      const margin = painter();
      const plain = painter();

      for (const paper of [margin, plain]) {
        paper.position(12);

        if (paper === margin) {
          paper.margins({left: 12});
        }

        paper.text('A');
        paper.lineFeed();
      }

      assert.deepEqual(margin.end(), plain.end());
    });

    it('should not apply to a block that asks for the paper', function() {
      const paper = painter();

      paper.margins({left: 8, width: 16});
      paper.block(black(WIDTH, 4), {margins: false});

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 0, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, WIDTH - 1, 0), 1);
    });

    it('should apply to a block as well', function() {
      const paper = painter();

      paper.margins({left: 8, width: 16});
      paper.block(black(16, 4));

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 7, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 8, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 23, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 24, 0), 0);
    });

    it('should be reset by reset()', function() {
      const paper = painter();

      paper.margins({left: 12});
      paper.reset();
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
    });
  });

  describe('upperline and upside down', function() {
    it('should draw the upperline along the top of the cell', function() {
      const paper = painter();

      paper.style({upperline: 2});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 0, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 11, 1), 1);
      assert.equal(Bitmap.getPixel(bitmap, 12, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 0, 2), 0);
    });

    it('should rotate a committed line by 180 degrees', function() {
      const upright = painter();
      const rotated = painter();

      upright.text('Ab');
      upright.lineFeed();

      rotated.style({upsideDown: true});
      rotated.text('Ab');
      rotated.lineFeed();

      assert.deepEqual(
          toAscii(stitch(rotated.end(), {width: WIDTH})),
          toAscii(Bitmap.rotate180(stitch(upright.end(), {width: WIDTH}))),
      );
    });

    it('should rotate a block by 180 degrees', function() {
      const paper = painter();
      const block = fromAscii(['####', '#...', '#...']);

      paper.style({upsideDown: true});
      paper.block(block);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, WIDTH - 1, 2), 1);
      assert.equal(Bitmap.getPixel(bitmap, WIDTH - 4, 2), 1);
      assert.equal(Bitmap.getPixel(bitmap, WIDTH - 1, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, WIDTH - 4, 0), 0);
    });

    it('should keep the order of the lines', function() {
      const paper = painter();

      paper.style({upsideDown: true});
      paper.text('A');
      paper.lineFeed();
      paper.block(black(WIDTH, 4));

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 34);
      assert.equal(Bitmap.getPixel(bitmap, 0, 32), 1);
    });
  });

  describe('placeholder()', function() {
    it('should draw the fallback glyph of the font', function() {
      const paper = painter();
      const fallback = painter();

      paper.placeholder(2);
      paper.lineFeed();

      fallback.text('��');
      fallback.lineFeed();

      assert.deepEqual(paper.end(), fallback.end());
    });

    it('should draw nothing for a count of zero', function() {
      const paper = painter();
      const empty = painter();

      paper.placeholder(0);
      paper.lineFeed();
      empty.lineFeed();

      assert.deepEqual(paper.end(), empty.end());
    });
  });
  describe('defineGlyph(), hasGlyph() and glyph()', function() {
    /* A glyph of four by eight black dots, which is smaller than a cell of
       either font, so where it lands in the cell is visible */

    const CORNER = black(4, 8);

    it('should draw a downloaded glyph as a cell of the current font', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);

      assert.isTrue(paper.glyph(0x41));

      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 12; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), x < 4 && y < 8 ? 1 : 0, `dot ${x},${y}`);
        }
      }

      /* The cell of the font, so the character behind it starts at twelve */

      assert.equal(bitmap.height, 30);
    });

    it('should report a code it has no glyph for and place nothing', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);

      assert.isTrue(paper.hasGlyph(0x41));
      assert.isFalse(paper.hasGlyph(0x42));
      assert.isFalse(paper.glyph(0x42));

      paper.lineFeed();

      assert.equal(stitch(paper.end(), {width: WIDTH}).height, 30);
    });

    it('should keep a set per font', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);
      paper.font('B');

      assert.isFalse(paper.hasGlyph(0x41));

      paper.defineGlyph(0x41, black(4, 4));

      assert.isTrue(paper.hasGlyph(0x41));

      paper.font('A');

      assert.isTrue(paper.hasGlyph(0x41));
    });

    it('should cancel a definition with a bitmap of null', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);
      paper.defineGlyph(0x41, null);

      assert.isFalse(paper.hasGlyph(0x41));
    });

    it('should redefine a code without keeping the cell of the definition before it', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);
      paper.glyph(0x41);
      paper.lineFeed();

      paper.defineGlyph(0x41, black(8, 16));
      paper.glyph(0x41);
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 6, 30 + 12), 1);
      assert.equal(Bitmap.getPixel(bitmap, 6, 4), 0);
    });

    it('should throw the definitions away on reset()', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);
      paper.reset();

      assert.isFalse(paper.hasGlyph(0x41));
    });

    it('should keep the multibyte glyphs in a set of their own, two cells wide', function() {
      const paper = painter();

      paper.defineGlyph(0x9821, black(24, 24), {multibyte: true});

      assert.isFalse(paper.hasGlyph(0x9821));
      assert.isTrue(paper.hasGlyph(0x9821, {multibyte: true}));

      paper.glyph(0x9821, {multibyte: true});
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), 1, `dot ${x},${y}`);
        }
      }

      assert.equal(Bitmap.getPixel(bitmap, 24, 0), 0);
    });

    it('should style and scale a downloaded glyph the way it styles a built in one', function() {
      const paper = painter();

      paper.defineGlyph(0x41, CORNER);
      paper.style({width: 2, height: 2});
      paper.glyph(0x41);
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 24; x++) {
          assert.equal(Bitmap.getPixel(bitmap, x, y), x < 8 && y < 16 ? 1 : 0, `dot ${x},${y}`);
        }
      }
    });

    it('should clip a glyph that is larger than the cell', function() {
      const paper = painter();

      paper.defineGlyph(0x41, black(24, 48));
      paper.glyph(0x41);
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 11, 23), 1);
      assert.equal(Bitmap.getPixel(bitmap, 12, 0), 0);
      assert.equal(bitmap.height, 30);
    });
  });

  describe('the rotation of ESC V', function() {
    it('should turn every cell a quarter turn clockwise', function() {
      const rotated = painter();
      const upright = painter();

      rotated.style({rotate: true});
      rotated.text('A');
      rotated.lineFeed();

      upright.text('A');
      upright.lineFeed();

      const left = stitch(rotated.end(), {width: WIDTH});
      const right = stitch(upright.end(), {width: WIDTH});

      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 24; x++) {
          /* The top left dot of a cell becomes its top right one, so the
             dot at x, y of the rotated cell is the dot at y, 23 - x of the
             upright one */

          assert.equal(
              Bitmap.getPixel(left, x, y),
              Bitmap.getPixel(right, y, 23 - x),
              `dot ${x},${y}`,
          );
        }
      }
    });

    it('should wrap a rotated line over the width of the paper', function() {
      /* A rotated cell is 24 dots wide, so four of them fill the 96 dots of
         this printer and the fifth wraps */

      const paper = painter();

      paper.style({rotate: true});
      paper.text('ABCDE');
      paper.lineFeed();

      assert.equal(stitch(paper.end(), {width: WIDTH}).height, 60);
    });

    it('should draw no underline and no upperline on a rotated cell', function() {
      const lined = painter();
      const plain = painter();

      lined.style({rotate: true, underline: 2, upperline: 1});
      lined.text('A');
      lined.lineFeed();

      plain.style({rotate: true});
      plain.text('A');
      plain.lineFeed();

      assert.deepEqual(lined.end(), plain.end());
    });

    it('should draw the two lines again on an upright cell', function() {
      const lined = painter();
      const plain = painter();

      lined.style({rotate: true, underline: 2, upperline: 1});
      lined.style({rotate: false});
      lined.text('A');
      lined.lineFeed();

      plain.text('A');
      plain.lineFeed();

      assert.notDeepEqual(lined.end(), plain.end());
    });

    it('should leave the blocks of a line upright', function() {
      const rotated = painter();
      const upright = painter();

      rotated.style({rotate: true});
      rotated.block(black(48, 10));

      upright.block(black(48, 10));

      assert.deepEqual(rotated.end(), upright.end());
    });
  });

  describe('page mode', function() {
    /* A page of this narrow printer: the whole width and a few lines tall */

    const AREA = {x: 0, y: 0, width: WIDTH, height: 96};

    /**
     * The paper of a page with two lines on it, in one print direction
     *
     * @param  {number}   direction   The print direction, 0 to 3
     * @return {object}               The paper
     */
    function page(direction) {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.pageDirection(direction);
      paper.text('Hi');
      paper.lineFeed();
      paper.text('.');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      return stitch(paper.end(), {width: WIDTH});
    }

    it('should report whether it is in page mode', function() {
      const paper = painter();

      assert.isFalse(paper.pageMode);

      paper.page(true);
      assert.isTrue(paper.pageMode);

      paper.page(false);
      assert.isFalse(paper.pageMode);
    });

    it('should print the page as a block of the height of its print area', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.text('Hi');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, AREA.height);
    });

    it('should print a page of direction 0 as the same lines as standard mode', function() {
      const standard = painter();

      standard.text('Hi');
      standard.lineFeed();
      standard.text('.');
      standard.lineFeed();
      standard.feed(96 - 60);

      assert.deepEqual(
          toAscii(page(0)),
          toAscii(stitch(standard.end(), {width: WIDTH})),
      );
    });

    it('should put the cells of a mixed size line on the baseline of a page', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.pageDirection(0);
      paper.text('A');
      paper.style({height: 2});
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const standard = painter();

      standard.text('A');
      standard.style({height: 2});
      standard.text('B');
      standard.lineFeed();
      standard.feed(AREA.height - 48);

      const page = stitch(paper.end(), {width: WIDTH});

      assert.deepEqual(toAscii(page), toAscii(stitch(standard.end(), {width: WIDTH})));

      /* The single height cell sits on the baseline of the 48 dot line, rows 18
         to 41, the same rule the paper follows */

      assert.deepEqual(toAscii(crop(page, 0, 0, 12, 18)), toAscii(Bitmap.create(12, 18)));
      assert.deepEqual(toAscii(crop(page, 0, 42, 12, 6)), toAscii(Bitmap.create(12, 6)));
      assert.notDeepEqual(toAscii(crop(page, 0, 18, 12, 24)), toAscii(Bitmap.create(12, 24)));
    });

    it('should turn direction 1 a quarter turn counter-clockwise', function() {
      assert.deepEqual(
          toAscii(crop(page(1), 0, 0, AREA.width, AREA.height)),
          toAscii(Bitmap.rotate90(crop(page(0), 0, 0, AREA.height, AREA.width))),
      );
    });

    it('should turn direction 2 half a turn', function() {
      assert.deepEqual(
          toAscii(crop(page(2), 0, 0, AREA.width, AREA.height)),
          toAscii(Bitmap.rotate180(crop(page(0), 0, 0, AREA.width, AREA.height))),
      );
    });

    it('should turn direction 3 a quarter turn clockwise', function() {
      assert.deepEqual(
          toAscii(crop(page(3), 0, 0, AREA.width, AREA.height)),
          toAscii(Bitmap.rotate270(crop(page(0), 0, 0, AREA.height, AREA.width))),
      );
    });

    it('should lay a sideways direction out over the height of the area', function() {
      const paper = painter();

      /* An area of 24 by 96 dots holds two characters of font A per line in
         direction 0 and eight of them in direction 1, where a line runs along
         the height of the area */

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: 24, height: 96});
      paper.pageDirection(1);
      paper.text('AAAAAAAA');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 96);
    });

    it('should wrap text inside the print area', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: 24, height: 96});
      paper.text('AAAA');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* Two characters fit on a line of 24 dots, so the other two are on the
         line below and nothing is drawn to the right of the area */

      assert.equal(Bitmap.getPixel(bitmap, 15, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 15, 40), 1);
      assert.equal(Bitmap.getPixel(bitmap, 27, 10), 0);
    });

    it('should discard the dots below the print area', function() {
      const paper = painter();
      const shorter = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 30});
      paper.text('A');
      paper.lineFeed();
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      shorter.page(true);
      shorter.pageArea({x: 0, y: 0, width: WIDTH, height: 30});
      shorter.text('A');
      shorter.lineFeed();
      shorter.printPage();
      shorter.page(false);

      assert.deepEqual(
          toAscii(stitch(paper.end(), {width: WIDTH})),
          toAscii(stitch(shorter.end(), {width: WIDTH})),
      );
    });

    it('should put the area at its origin on the page', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 24, y: 48, width: 24, height: 48});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 96);
      assert.equal(Bitmap.getPixel(bitmap, 27, 58), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 0);
    });

    it('should ignore a print area with a size of zero', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: 24, height: 48});
      paper.pageArea({x: 0, y: 0, width: 0, height: 48});
      paper.pageArea({x: 0, y: 0, width: 24, height: 0});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 48);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
    });

    it('should lay out over the whole printable area without an area of its own', function() {
      const paper = painter();

      paper.page(true);
      paper.align('right');
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      /* The line is against the right edge of the paper, so the area is the
         paper, and the page is as tall as the line box it holds because no
         area was set */

      assert.equal(Bitmap.getPixel(stitch(paper.end(), {width: WIDTH}), WIDTH - 9, 10), 1);
    });

    it('should keep the area and the direction until they are reset', function() {
      const paper = painter();

      paper.pageArea({x: 0, y: 0, width: 48, height: 30});
      paper.pageDirection(2);

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      /* A second page takes the same area and the same direction, which were
         set before the first page and survived it */

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 60);
      assert.deepEqual(
          toAscii(Bitmap.extractRows(bitmap, 0, 30)),
          toAscii(Bitmap.extractRows(bitmap, 30, 30)),
      );

      /* Direction 2 puts the character against the right edge of the area,
         upside down */

      assert.equal(Bitmap.getPixel(bitmap, 44, 19), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 0);
    });

    it('should put the area back on reset()', function() {
      const paper = painter();

      paper.pageArea({x: 0, y: 0, width: 48, height: 30});
      paper.reset();

      paper.page(true);
      paper.align('right');
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      assert.equal(Bitmap.getPixel(stitch(paper.end(), {width: WIDTH}), WIDTH - 9, 10), 1);
    });

    it('should feed the paper for an area that stayed empty', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 100});
      paper.text('A');
      paper.lineFeed();
      paper.pageArea({x: 0, y: 100, width: WIDTH, height: 100});
      paper.printPage();
      paper.page(false);

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 200);
    });

    it('should ignore an area whose origin is outside the page', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: 24, height: 48});
      paper.pageArea({x: WIDTH, y: 0, width: 24, height: 48});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 48);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
    });

    it('should compose several print areas into one page', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: 48, height: 30});
      paper.text('A');
      paper.lineFeed();
      paper.pageArea({x: 48, y: 30, width: 48, height: 30});
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The A stands at the origin of the first area and the B at the origin
         of the second, which is 48 dots along and 30 rows down */

      assert.equal(bitmap.height, 60);
      assert.deepEqual(toAscii(crop(bitmap, 0, 0, 12, 24)), toAscii(cellOf('A')));
      assert.deepEqual(toAscii(crop(bitmap, 48, 30, 12, 24)), toAscii(cellOf('B')));
    });

    it('should move the position with pageVertical()', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.pageVertical(48);
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 3, 58), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 0);
    });

    it('should count a relative move from the position', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.pageVertical(30);
      paper.pageVertical(30, {relative: true});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      assert.equal(Bitmap.getPixel(stitch(paper.end(), {width: WIDTH}), 3, 70), 1);
    });

    it('should ignore a position outside the print area', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.pageVertical(1000);
      paper.pageVertical(-30, {relative: true});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      assert.equal(Bitmap.getPixel(stitch(paper.end(), {width: WIDTH}), 3, 10), 1);
    });

    it('should draw the characters of the line before the position moves', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.text('A');
      paper.pageVertical(48);
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The A is on the line the move left behind, the B on the line 48 dots
         down, in the second cell, where the move left the position */

      assert.deepEqual(toAscii(crop(bitmap, 0, 0, 12, 24)), toAscii(cellOf('A')));
      assert.deepEqual(toAscii(crop(bitmap, 12, 48, 12, 24)), toAscii(cellOf('B')));
    });

    it('should keep the page on printPage({keep: true})', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 30});
      paper.text('A');
      paper.lineFeed();
      paper.printPage({keep: true});
      paper.printPage({keep: true});
      paper.page(false);

      const items = paper.end();
      const bitmap = stitch(items, {width: WIDTH});

      assert.equal(bitmap.height, 60);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3, 40), 1);
    });

    it('should clear the page on printPage()', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 30});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(bitmap.height, 60);
      assert.equal(Bitmap.getPixel(bitmap, 3, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 3, 40), 0);
    });

    it('should throw the dots away and keep the area on cancelPage()', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 48});
      paper.text('A');
      paper.lineFeed();
      paper.cancelPage();
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});
      const b = painter();

      b.text('B');
      b.lineFeed();
      b.feed(18);

      assert.equal(bitmap.height, 48);
      assert.deepEqual(toAscii(bitmap), toAscii(stitch(b.end(), {width: WIDTH})));
    });

    it('should throw the page away when page mode is left', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.text('A');
      paper.lineFeed();
      paper.page(false);

      assert.deepEqual(paper.end(), []);
    });

    it('should throw the page away at the end of the stream', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea(AREA);
      paper.text('A');
      paper.lineFeed();

      assert.deepEqual(paper.end(), []);
    });

    it('should leave page mode on reset()', function() {
      const paper = painter();

      paper.page(true);
      paper.reset();

      assert.isFalse(paper.pageMode);
    });

    it('should print nothing for a page without an area and without a box', function() {
      const paper = painter();

      paper.text('A');
      paper.lineFeed();
      paper.page(true);
      paper.printPage();
      paper.page(false);
      paper.text('B');
      paper.lineFeed();

      const same = painter();

      same.text('A');
      same.lineFeed();
      same.text('B');
      same.lineFeed();

      assert.deepEqual(paper.end(), same.end());
    });

    it('should be as tall as the boxes it holds when it was given no area', function() {
      const paper = painter();
      const standard = painter();

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      standard.text('A');
      standard.lineFeed();

      /* The line box of the page, the gap of the line spacing below the cell
         included, which is the paper the same line feeds in standard mode and
         not the rows its dots reach */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, stitch(standard.end(), {width: WIDTH}).height);
    });

    it('should feed a trailing blank line of a page without an area', function() {
      const paper = painter();

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const items = paper.end();

      /* The blank line is a box of its own, the line spacing, so the page is
         two lines tall and not one */

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 60);
    });

    it('should be taller by a feed at the end of a page without an area', function() {
      const paper = painter();

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.feed(20);
      paper.printPage();
      paper.page(false);

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 50);
    });

    it('should be as tall as the whole page in a turned direction without an area', function() {
      for (const direction of [1, 2, 3]) {
        const paper = painter();

        paper.page(true);
        paper.pageDirection(direction);
        paper.text('A');
        paper.lineFeed();
        paper.printPage();
        paper.page(false);

        /* A line box spans the whole width of the layout. The directions 1 and
           3 swap the axes, so that width is the height of the area and one
           line reaches the bottom of it; direction 2 mirrors, and this line
           starts at the top of the layout, so it lands against the bottom. The
           area is the default one, the whole page */

        const items = paper.end();

        assert.equal(items.length, 1);
        assert.equal(items[0].height, profiles.epson.pageHeight);
      }
    });

    it('should mirror the top of the highest box to the bottom in direction 2', function() {
      const paper = painter();

      paper.page(true);
      paper.pageDirection(2);
      paper.pageVertical(150);
      paper.text('Hi');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      /* The line box is at 150 to 180 of the layout and direction 2 turns it
         half a turn, so it lands on the rows 1482 to 1512 of the default area
         and the page ends there, 150 dots above the bottom of the page */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, profiles.epson.pageHeight - 150);
    });

    it('should print nothing for a page a position alone moved down', function() {
      const paper = painter();

      paper.page(true);
      paper.pageVertical(300);
      paper.printPage();
      paper.page(false);

      /* The position is not a box: the page holds nothing that was laid out,
         so there is nothing to feed */

      assert.deepEqual(paper.end(), []);
    });

    it('should print the same page twice on printPage({keep: true}) without an area', function() {
      const paper = painter();

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.printPage({keep: true});
      paper.printPage({keep: true});
      paper.page(false);

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 60);
    });

    it('should print nothing for a second printPage() without new content', function() {
      const paper = painter();

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.printPage();
      paper.page(false);

      /* The first print took the page with it, boxes and areas alike, so the
         second one has nothing to feed */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should add no extent for a reverse feed inside a page', function() {
      const paper = painter();
      const standard = painter();

      paper.page(true);
      paper.text('A');
      paper.lineFeed();
      paper.text('B');
      paper.lineFeed();
      paper.reverseLineFeed();
      paper.printPage();
      paper.page(false);

      standard.text('A');
      standard.lineFeed();
      standard.text('B');
      standard.lineFeed();
      standard.reverseLineFeed();

      /* The position moves back over rows that are already laid out, so the
         page is as tall as the two lines, which is what the same lines feed in
         standard mode */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, stitch(standard.end(), {width: WIDTH}).height);
    });

    it('should throw the boxes away with the dots on cancelPage() without an area', function() {
      const paper = painter();

      paper.page(true);
      paper.text('Hi');
      paper.lineFeed();
      paper.lineFeed();
      paper.cancelPage();
      paper.text('Yo');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      /* Only the line behind the CAN is laid out, so the page is one line
         spacing tall and not three */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
    });

    it('should be as tall as an area that holds nothing at all', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 48});
      paper.printPage();
      paper.page(false);

      assert.equal(stitch(paper.end(), {width: WIDTH}).height, 48);
    });

    it('should be as tall as the lowest of its areas', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: 48, height: 90});
      paper.text('A');
      paper.lineFeed();
      paper.pageArea({x: 48, y: 0, width: 48, height: 30});
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      /* The two areas start at the same row and the taller one decides */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 90);
    });

    it('should not enter page mode while a line is being composed', function() {
      const paper = painter();

      paper.text('A');
      paper.page(true);

      assert.isFalse(paper.pageMode);
    });

    it('should hold a cut until the page is printed', function() {
      const paper = painter({commands: ['cut']});

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 30});
      paper.text('A');
      paper.lineFeed();
      paper.command({type: 'cut', value: 'full'});
      paper.printPage();
      paper.page(false);

      const items = paper.end();

      assert.deepEqual(items.map((item) => item.type), ['image', 'cut']);
    });

    it('should emit a held cut when page mode is left without printing', function() {
      const paper = painter({commands: ['cut']});

      paper.page(true);
      paper.command({type: 'cut', value: 'full'});
      paper.page(false);

      assert.deepEqual(paper.end(), [{type: 'cut', value: 'full'}]);
    });

    it('should report an unknown command where it stands', function() {
      const paper = painter({commands: ['unknown']});

      paper.page(true);
      paper.command({type: 'unknown', data: new Uint8Array([1])});

      assert.equal(paper.end().length, 1);
    });

    it('should ignore the margins of the line mode', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 30});
      paper.margins({left: 24});
      paper.text('A');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      assert.equal(Bitmap.getPixel(stitch(paper.end(), {width: WIDTH}), 3, 10), 1);
    });

    it('should move the position back with a reverse feed', function() {
      const paper = painter();

      paper.page(true);
      paper.pageArea({x: 0, y: 0, width: WIDTH, height: 60});
      paper.text('A');
      paper.lineFeed();
      paper.reverseLineFeed();
      paper.position(12);
      paper.text('B');
      paper.lineFeed();
      paper.printPage();
      paper.page(false);

      const bitmap = stitch(paper.end(), {width: WIDTH});

      /* The reverse feed puts the B back on the line of the A, in the second
         cell */

      assert.deepEqual(toAscii(crop(bitmap, 0, 0, 12, 24)), toAscii(cellOf('A')));
      assert.deepEqual(toAscii(crop(bitmap, 12, 0, 12, 24)), toAscii(cellOf('B')));
    });
  });
  describe('the sink', function() {
    it('should return the display list of the stream after collect()', function() {
      const paper = painter();

      paper.collect();
      paper.text('A');
      paper.lineFeed();

      const list = paper.end();

      assert.equal(list.version, 1);
      assert.equal(list.width, WIDTH);
      assert.equal(list.height, 30);
      assert.deepEqual(list.entries.map((entry) => [entry.type, entry.y, entry.height]), [['line', 0, 30]]);
      assert.equal(list.entries[0].operations.length, 1);
      assert.equal(list.entries[0].operations[0].codepoint, 0x41);
    });

    it('should draw the stream after a collected one again', function() {
      const paper = painter();

      paper.collect();
      paper.text('A');
      paper.lineFeed();
      paper.end();

      paper.text('A');
      paper.lineFeed();

      const items = paper.end();

      assert.deepEqual(items.map((item) => item.type), ['image']);
      assert.equal(items[0].height, 30);
    });

    it('should draw again after a collected stream was discarded', function() {
      const paper = painter();

      paper.collect();
      paper.text('A');
      paper.discard();

      paper.text('A');
      paper.lineFeed();

      assert.deepEqual(paper.end().map((item) => item.type), ['image']);
    });

    it('should keep the memory of the printer across the sinks', function() {
      const paper = painter();

      paper.define('logo', black(24, 24));

      paper.collect();
      assert.isTrue(paper.print('logo'));

      const list = paper.end();

      assert.equal(list.entries[0].operations[0].type, 'image');

      /* The image is still there for the render of the next stream, because it
         is the memory of the printer and not of the sink */

      assert.isTrue(paper.print('logo'));
      assert.equal(paper.end()[0].height, 24);
    });

    it('should take the paper in front of a cut away', function() {
      const paper = painter({commands: ['cut']});

      paper.lineSpacing(24);
      paper.text('A');
      paper.lineFeed();
      paper.text('B');
      paper.lineFeed();
      paper.reverseFeed(24);

      paper.collect();
      paper.command({type: 'cut', value: 'full'});
      paper.text('C');
      paper.lineFeed();

      const list = paper.end();

      /* The cut stands at the bottom of the paper, not at the position the
         reverse feed left behind, and the line behind it is printed below it */

      assert.deepEqual(list.entries.map((entry) => [entry.type, entry.y]), [['cut', 48], ['line', 48]]);
      assert.equal(list.entries[1].height, 24);
    });

    it('should not move a reverse feed above a cut', function() {
      const paper = painter({commands: ['cut']});

      paper.lineSpacing(24);
      paper.collect();
      paper.text('A');
      paper.lineFeed();
      paper.command({type: 'cut', value: 'full'});
      paper.text('B');
      paper.lineFeed();
      paper.reverseFeed(1000);
      paper.text('C');
      paper.lineFeed();

      const list = paper.end();

      assert.deepEqual(list.entries.map((entry) => [entry.type, entry.y]), [
        ['line', 0],
        ['cut', 24],
        ['line', 24],
        ['line', 24],
      ]);
    });

    it('should hold every command of the stream, whatever the commands option says', function() {
      const paper = painter({commands: []});

      paper.collect();
      paper.text('A');
      paper.lineFeed();
      paper.command({type: 'cut', value: 'partial'});
      paper.command({type: 'pulse', device: 0, on: 100, off: 500});

      const list = paper.end();

      assert.deepEqual(list.entries.map((entry) => entry.type), ['line', 'cut', 'pulse']);
      /* The source of an entry is the bytes its command came from, which a
         parser sets and a caller of the painter itself never does */

      assert.deepEqual(list.entries[1], {type: 'cut', y: 30, value: 'partial', source: null});
      assert.deepEqual(list.entries[2], {type: 'pulse', y: 30, device: 0, on: 100, off: 500, source: null});

      /* And the render of the same stream drops both of them, because the
         driver does not support them */

      paper.text('A');
      paper.lineFeed();
      paper.command({type: 'cut', value: 'partial'});

      assert.deepEqual(paper.end().map((item) => item.type), ['image']);
    });
  });
});
