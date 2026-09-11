/**
 * @typedef {import('../bitmap.js').Bitmap} Bitmap
 */

/**
 * Convert a bitmap to an ImageData, for drawing on a canvas. Black dots become
 * opaque black pixels, white dots opaque white pixels.
 *
 * Browsers have the ImageData constructor as a global. Node does not, so the
 * constructor can be passed in, from a canvas library or a small class of your
 * own.
 *
 * @param  {Bitmap}     bitmap                 The bitmap to convert
 * @param  {Function}   [ImageDataConstructor] Constructor to use instead of the global one
 * @return {object}                            An ImageData with the pixels of the bitmap
 */
export function toImageData(bitmap, ImageDataConstructor) {
  const constructor = ImageDataConstructor || globalThis.ImageData;

  if (typeof constructor !== 'function') {
    throw new Error(
        'No ImageData constructor available, pass one as the second argument of toImageData()',
    );
  }

  const rowBytes = (bitmap.width + 7) >> 3;
  const pixels = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);

  let offset = 0;

  for (let y = 0; y < bitmap.height; y++) {
    const row = y * rowBytes;

    for (let x = 0; x < bitmap.width; x++) {
      const black = bitmap.data[row + (x >> 3)] & (0x80 >> (x & 7));
      const value = black ? 0x00 : 0xff;

      pixels[offset++] = value;
      pixels[offset++] = value;
      pixels[offset++] = value;
      pixels[offset++] = 0xff;
    }
  }

  return new constructor(pixels, bitmap.width, bitmap.height);
}

export default toImageData;
