import zlib from 'node:zlib';

import Bitmap from '../src/bitmap.js';
import {toPbm} from '../src/formats/pbm.js';
import {toPng, crc32} from '../src/formats/png.js';
import {toImageData} from '../src/formats/image-data.js';
import {stitch} from '../src/formats/stitch.js';
import {fromAscii} from './helpers/ascii.js';
import {assert} from 'chai';

/* A stand in for the ImageData of the browser, so that the test does not need
   canvas or any other native module */

/**
 * The part of ImageData that toImageData() uses
 */
class FakeImageData {
  /**
     * @param  {Uint8ClampedArray}   data     The pixels
     * @param  {number}              width    Width in pixels
     * @param  {number}              height   Height in pixels
     */
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.colorSpace = 'srgb';
  }
}

describe('toPbm()', function() {
  const bitmap = fromAscii([
    '##......##..',
    '..##..##....',
  ]);

  const result = toPbm(bitmap);

  it('should start with the P4 header', function() {
    assert.equal(new TextDecoder().decode(result.subarray(0, 8)), 'P4\n12 2\n');
  });

  it('should follow the header with the rows of the bitmap', function() {
    assert.deepEqual(Array.from(result.subarray(8)), [0xc0, 0xc0, 0x33, 0x00]);
  });

  it('should have the size of the header plus the data', function() {
    assert.equal(result.length, 8 + bitmap.data.length);
  });

  it('should be a Uint8Array', function() {
    assert.instanceOf(result, Uint8Array);
  });
});

describe('toImageData()', function() {
  const bitmap = fromAscii([
    '#.',
    '.#',
  ]);

  const result = toImageData(bitmap, FakeImageData);

  it('should have the size of the bitmap', function() {
    assert.equal(result.width, 2);
    assert.equal(result.height, 2);
  });

  it('should have four opaque pixels', function() {
    assert.equal(result.data.length, 16);
    assert.deepEqual(Array.from(result.data.filter((value, index) => index % 4 === 3)), [255, 255, 255, 255]);
  });

  it('should draw black dots black and white dots white', function() {
    assert.deepEqual(Array.from(result.data), [
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });

  it('should not read the padding of a row', function() {
    const wide = fromAscii(['.........#..']);
    const pixels = toImageData(wide, FakeImageData);

    assert.equal(pixels.data.length, 12 * 4);
    assert.equal(pixels.data[9 * 4], 0);
    assert.equal(pixels.data[11 * 4], 255);
  });

  it('should throw a clear error when there is no constructor', function() {
    assert.throws(() => toImageData(bitmap), /ImageData constructor/);
  });
});

describe('toPng()', function() {
  const bitmap = fromAscii([
    '##......##..',
    '..##..##....',
    '............',
  ]);

  /**
   * The chunks of a PNG file, with their type, their data and whether the
   * checksum in the file is the one over the type and the data
   *
   * @param  {Uint8Array}   data   The contents of the file
   * @return {object[]}            The chunks, in order
   */
  function chunks(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const result = [];

    let offset = 8;

    while (offset < data.length) {
      const length = view.getUint32(offset);
      const type = new TextDecoder().decode(data.subarray(offset + 4, offset + 8));

      result.push({
        type,
        data: data.subarray(offset + 8, offset + 8 + length),
        valid: view.getUint32(offset + 8 + length) === crc32(data.subarray(offset + 4, offset + 8 + length)),
      });

      offset += 12 + length;
    }

    return result;
  }

  it('should start with the PNG signature', async function() {
    const png = await toPng(bitmap);

    assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('should have an IHDR, an IDAT and an IEND chunk', async function() {
    assert.deepEqual(chunks(await toPng(bitmap)).map((chunk) => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  });

  it('should have a valid checksum on every chunk', async function() {
    assert.isTrue(chunks(await toPng(bitmap)).every((chunk) => chunk.valid));
  });

  it('should describe the image as one bit greyscale', async function() {
    const header = chunks(await toPng(bitmap))[0].data;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

    assert.equal(view.getUint32(0), 12);
    assert.equal(view.getUint32(4), 3);
    assert.deepEqual(Array.from(header.subarray(8)), [1, 0, 0, 0, 0]);
  });

  it('should hold the scanlines of the bitmap, inverted, behind a filter byte', async function() {
    const idat = chunks(await toPng(bitmap))[1].data;
    const raw = zlib.inflateSync(Buffer.from(idat));

    /* Two bytes per row of twelve dots, with a filter byte in front of them,
       and a set bit is white in a greyscale PNG, so every byte is inverted */

    assert.deepEqual(Array.from(raw), [
      0, ~0xc0 & 0xff, ~0xc0 & 0xff,
      0, ~0x33 & 0xff, ~0x00 & 0xff,
      0, 0xff, 0xff,
    ]);
  });

  it('should compress a receipt to less than its rows', async function() {
    const paper = Bitmap.create(576, 400);
    const png = await toPng(paper);

    assert.isBelow(png.length, paper.data.length);
  });

  it('should be a Uint8Array', async function() {
    assert.instanceOf(await toPng(bitmap), Uint8Array);
  });

  it('should refuse an image without dots', async function() {
    for (const empty of [Bitmap.create(0, 4), Bitmap.create(8, 0), null]) {
      let message = null;

      try {
        await toPng(empty);
      } catch (error) {
        message = error.message;
      }

      assert.match(message || '', /at least one dot/);
    }
  });
});

describe('stitch()', function() {
  /**
   * An image item of a given height, with every row the same byte
   *
   * @param  {number}   height   Height in rows
   * @param  {number}   value    The byte every row is filled with
   * @return {object}            The item
   */
  function image(height, value) {
    return {
      type: 'image',
      width: 16,
      height,
      data: new Uint8Array(2 * height).fill(value),
    };
  }

  it('should join the image items in order', function() {
    const paper = stitch([image(2, 0xff), image(3, 0x0f)]);

    assert.equal(paper.width, 16);
    assert.equal(paper.height, 5);
    assert.deepEqual(Array.from(paper.data), [0xff, 0xff, 0xff, 0xff, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f]);
  });

  it('should expand a feed item to white rows', function() {
    const paper = stitch([image(1, 0xff), {type: 'feed', height: 2}, image(1, 0xff)]);

    assert.equal(paper.height, 4);
    assert.deepEqual(Array.from(paper.data), [0xff, 0xff, 0, 0, 0, 0, 0xff, 0xff]);
  });

  it('should leave a feed item out when feed is off', function() {
    const paper = stitch([image(1, 0xff), {type: 'feed', height: 2}, image(1, 0xff)], {feed: false});

    assert.equal(paper.height, 2);
  });

  it('should draw a dashed line at a cut when the marker is on', function() {
    const paper = stitch([image(1, 0xff), {type: 'cut', value: 'full'}, image(1, 0xff)], {cutMarker: true});

    assert.equal(paper.height, 4);
    assert.deepEqual(Array.from(paper.data), [0xff, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff, 0xff]);
  });

  it('should not draw a cut when the marker is off', function() {
    const paper = stitch([image(1, 0xff), {type: 'cut', value: 'full'}, image(1, 0xff)]);

    assert.equal(paper.height, 2);
  });

  it('should ignore the commands that do not move the paper', function() {
    const items = [
      image(1, 0xff),
      {type: 'pulse', device: 0, on: 100, off: 500},
      {type: 'unknown', data: new Uint8Array([1, 2, 3])},
      image(1, 0xff),
    ];

    assert.equal(stitch(items).height, 2);
  });

  it('should draw an image item that is narrower than the paper', function() {
    const narrow = {type: 'image', width: 4, height: 2, data: Uint8Array.from([0xf0, 0x90])};
    const paper = stitch([narrow], {width: 12});

    assert.equal(paper.width, 12);
    assert.equal(paper.height, 2);
    assert.deepEqual(Array.from(paper.data), [0xf0, 0x00, 0x90, 0x00]);
  });

  it('should take the width from the first image item', function() {
    assert.equal(stitch([image(1, 0xff)]).width, 16);
    assert.equal(stitch([{type: 'feed', height: 4}]).width, 0);
    assert.equal(stitch([{type: 'feed', height: 4}], {width: 32}).width, 32);
  });

  it('should return an empty bitmap for an empty stream', function() {
    assert.deepEqual(stitch([]), {width: 0, height: 0, data: new Uint8Array(0)});
  });
});
