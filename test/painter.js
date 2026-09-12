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

    it('should commit a pending line at the end of the stream', function() {
      const paper = painter();

      paper.text('Hi');

      assert.equal(paper.end()[0].height, 30);
    });

    it('should not add a line at the end of the stream when nothing is pending', function() {
      assert.deepEqual(painter().end(), []);
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

      assert.equal(Bitmap.getPixel(bitmap, 11, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 12, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 21, 0), 1);
      assert.equal(Bitmap.getPixel(bitmap, 22, 0), 0);
      assert.equal(Bitmap.getPixel(bitmap, 12, 7), 1);
      assert.equal(Bitmap.getPixel(bitmap, 12, 8), 0);
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
         does nothing at all with the command */

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
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

    it('should draw nothing for data the symbology cannot carry', function() {
      const paper = painter();

      paper.text('Hi');
      paper.barcode({symbology: 'ean13', data: 'nonsense', moduleWidth: 2, height: 40});
      paper.lineFeed();

      const items = paper.end();

      assert.equal(items.length, 1);
      assert.equal(items[0].height, 30);
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
});
