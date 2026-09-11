import {toPbm} from '../src/formats/pbm.js';
import {toImageData} from '../src/formats/image-data.js';
import {fromAscii} from './helpers/ascii.js';
import {assert} from 'chai';

/* A stand in for the ImageData of the browser, so that the test does not need
   canvas or any other native module */

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
