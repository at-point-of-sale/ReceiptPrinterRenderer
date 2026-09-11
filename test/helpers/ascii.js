import Bitmap from '../../src/bitmap.js';

/*
   Bitmaps as ASCII art, so that the expected output of a test can be written
   inline and a failure can be read without a graphics program. A black dot is
   '#', a white dot is '.'.
*/

/**
 * Convert a bitmap to lines of ASCII art
 *
 * @param  {object}     bitmap   The bitmap to convert
 * @return {string[]}            One string per row
 */
export function toAscii(bitmap) {
  const lines = [];

  for (let y = 0; y < bitmap.height; y++) {
    let line = '';

    for (let x = 0; x < bitmap.width; x++) {
      line += Bitmap.getPixel(bitmap, x, y) ? '#' : '.';
    }

    lines.push(line);
  }

  return lines;
}

/**
 * Convert lines of ASCII art to a bitmap. Every character that is not a dot or
 * a space is ink, so '#', '*' and 'X' all work.
 *
 * @param  {string[]}   lines   One string per row, all the same length
 * @return {object}             The bitmap
 */
export function fromAscii(lines) {
  const width = lines.length ? lines[0].length : 0;
  const bitmap = Bitmap.create(width, lines.length);

  for (let y = 0; y < lines.length; y++) {
    for (let x = 0; x < width; x++) {
      const character = lines[y].charAt(x);

      if (character !== '.' && character !== ' ' && character !== '') {
        Bitmap.setPixel(bitmap, x, y, 1);
      }
    }
  }

  return bitmap;
}

/**
 * The ASCII art of a bitmap as one string, for printing it in a test report
 *
 * @param  {object}   bitmap   The bitmap to convert
 * @return {string}            The ASCII art
 */
export function art(bitmap) {
  return toAscii(bitmap).join('\n');
}
