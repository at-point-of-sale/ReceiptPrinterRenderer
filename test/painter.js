import Painter from '../src/painter.js';
import Bitmap from '../src/bitmap.js';
import profiles from '../generated/profiles.js';
import {stitch} from '../src/formats/stitch.js';
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

      assert.equal(Bitmap.getPixel(bitmap, 1, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 85, 10), 0);
    });

    it('should put a right aligned line against the right edge', function() {
      const paper = painter();

      paper.align('right');
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 1, 10), 0);
      assert.equal(Bitmap.getPixel(bitmap, 85, 10), 1);
    });

    it('should centre a centred line', function() {
      const paper = painter();

      paper.align('center');
      paper.text('A');
      paper.lineFeed();

      const bitmap = stitch(paper.end(), {width: WIDTH});

      assert.equal(Bitmap.getPixel(bitmap, 1, 10), 0);
      assert.equal(Bitmap.getPixel(bitmap, 43, 10), 1);
      assert.equal(Bitmap.getPixel(bitmap, 85, 10), 0);
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

      assert.equal(items[0].height, 40 + 24);
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
      assert.equal(Bitmap.getPixel(bitmap, 1, 10), 1);
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
      assert.equal(Bitmap.getPixel(bitmap, 1, 10), 1);
    });
  });
});
