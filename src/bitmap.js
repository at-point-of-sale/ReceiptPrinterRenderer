/**
 * A 1-bit image. One bit per pixel, most significant bit first, every row
 * padded to a whole number of bytes, a set bit is a black dot.
 *
 * @typedef {object} Bitmap
 * @property {number} width      Width in dots
 * @property {number} height     Height in dots
 * @property {Uint8Array} data   Packed rows, Math.ceil(width / 8) bytes per row
 */

/**
 * Operations on 1-bit images. Everything is a static method on a plain object,
 * so that a bitmap stays the data the output contract describes and can be
 * handed to a driver without unwrapping.
 */
class Bitmap {
  /**
     * Number of bytes one row of this width occupies
     *
     * @param  {number}   width   Width in dots
     * @return {number}           Number of bytes per row
     */
  static rowBytes(width) {
    return (width + 7) >> 3;
  }

  /**
     * Create an empty, all white bitmap
     *
     * @param  {number}   width    Width in dots
     * @param  {number}   height   Height in dots
     * @return {Bitmap}            The new bitmap
     */
  static create(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
      throw new Error('Width and height must be non-negative integers');
    }

    return {width, height, data: new Uint8Array(Bitmap.rowBytes(width) * height)};
  }

  /**
     * Read one dot
     *
     * @param  {Bitmap}   bitmap   The bitmap to read from
     * @param  {number}   x        Horizontal position, 0 is the leftmost dot
     * @param  {number}   y        Vertical position, 0 is the top row
     * @return {number}            1 when the dot is black, 0 when it is white or outside the bitmap
     */
  static getPixel(bitmap, x, y) {
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
      return 0;
    }

    const byte = bitmap.data[y * Bitmap.rowBytes(bitmap.width) + (x >> 3)];

    return (byte >> (7 - (x & 7))) & 1;
  }

  /**
     * Set one dot. Positions outside the bitmap are ignored.
     *
     * @param  {Bitmap}   bitmap   The bitmap to draw on
     * @param  {number}   x        Horizontal position, 0 is the leftmost dot
     * @param  {number}   y        Vertical position, 0 is the top row
     * @param  {number}   value    1 for black, 0 for white
     */
  static setPixel(bitmap, x, y, value) {
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
      return;
    }

    const offset = y * Bitmap.rowBytes(bitmap.width) + (x >> 3);
    const mask = 0x80 >> (x & 7);

    if (value) {
      bitmap.data[offset] |= mask;
    } else {
      bitmap.data[offset] &= ~mask;
    }
  }

  /**
     * Draw a bitmap into another one at an offset, combining the dots with OR,
     * so that black dots are never lost. Parts of the source that fall outside
     * the destination are clipped.
     *
     * @param  {Bitmap}   source        The bitmap to draw
     * @param  {Bitmap}   destination   The bitmap to draw on
     * @param  {number}   x             Horizontal position of the left edge of the source
     * @param  {number}   y             Vertical position of the top row of the source
     */
  static blit(source, destination, x, y) {
    const sourceBytes = Bitmap.rowBytes(source.width);
    const destinationBytes = Bitmap.rowBytes(destination.width);

    /* The part of the source that falls inside the destination */

    const firstRow = Math.max(0, -y);
    const lastRow = Math.min(source.height, destination.height - y);

    const firstColumn = Math.max(0, -x);
    const lastColumn = Math.min(source.width, destination.width - x);

    if (firstRow >= lastRow || firstColumn >= lastColumn) {
      return;
    }

    /* Every destination byte takes eight consecutive dots of the source, so a
       row costs one read and one write per byte instead of per dot */

    const firstByte = (x + firstColumn) >> 3;
    const lastByte = (x + lastColumn - 1) >> 3;

    for (let row = firstRow; row < lastRow; row++) {
      const sourceOffset = row * sourceBytes;
      const destinationOffset = (y + row) * destinationBytes;

      for (let byte = firstByte; byte <= lastByte; byte++) {
        /* The source column of the leftmost dot of this destination byte */

        const column = byte * 8 - x;
        const index = column >> 3;
        const shift = column & 7;

        const high = index >= 0 && index < sourceBytes ? source.data[sourceOffset + index] : 0;
        const low = index + 1 >= 0 && index + 1 < sourceBytes ? source.data[sourceOffset + index + 1] : 0;

        let value = shift ? ((high << shift) | (low >> (8 - shift))) & 0xff : high;

        /* Drop the dots of this byte that are outside the clipped area */

        if (column < firstColumn) {
          value &= 0xff >> (firstColumn - column);
        }

        if (column + 8 > lastColumn) {
          value &= (0xff << (column + 8 - lastColumn)) & 0xff;
        }

        destination.data[destinationOffset + byte] |= value;
      }
    }
  }

  /**
     * Copy a range of rows into a new bitmap. Rows beyond the bottom of the
     * bitmap are not included, so the result can be shorter than requested.
     *
     * @param  {Bitmap}   bitmap   The bitmap to copy from
     * @param  {number}   y        First row to copy
     * @param  {number}   count    Number of rows to copy
     * @return {Bitmap}            A new bitmap with those rows
     */
  static extractRows(bitmap, y, count) {
    const first = Math.max(0, y);
    const height = Math.max(0, Math.min(count - (first - y), bitmap.height - first));
    const rowBytes = Bitmap.rowBytes(bitmap.width);

    const result = Bitmap.create(bitmap.width, height);
    result.data.set(bitmap.data.subarray(first * rowBytes, (first + height) * rowBytes));

    return result;
  }

  /**
     * Build a bitmap from one bitmask per row. The least significant bit of a
     * mask is the rightmost dot of the row, so a mask reads like the row does.
     * Numbers only hold 32 bits of mask, widths above 32 dots therefore need
     * bigints, which have no limit. Both may be mixed in one call.
     *
     * @param  {number}                 width      Width of the bitmap in dots
     * @param  {Array<number|bigint>}   rowMasks   One bitmask per row
     * @return {Bitmap}                            A new bitmap with those rows
     */
  static packRows(width, rowMasks) {
    const bitmap = Bitmap.create(width, rowMasks.length);
    const rowBytes = Bitmap.rowBytes(width);

    for (let row = 0; row < rowMasks.length; row++) {
      const mask = rowMasks[row];
      const offset = row * rowBytes;

      if (typeof mask === 'bigint') {
        for (let byte = 0; byte < rowBytes; byte++) {
          const shift = BigInt(width - 8 * (byte + 1));
          bitmap.data[offset + byte] = Number(
              (shift < 0n ? mask << -shift : mask >> shift) & 0xffn,
          ) & 0xff;
        }

        continue;
      }

      if (width > 32) {
        throw new Error('Row masks wider than 32 dots must be bigints');
      }

      for (let byte = 0; byte < rowBytes; byte++) {
        const shift = width - 8 * (byte + 1);
        bitmap.data[offset + byte] = ((shift < 0 ? mask << -shift : mask >>> shift) & 0xff);
      }
    }

    return bitmap;
  }

  /**
     * Cut a bitmap into pieces of at most a given height. The pieces are
     * consecutive and nothing is lost, the last one can be shorter. A bitmap
     * that already fits is returned as it is, without copying.
     *
     * @param  {Bitmap}     bitmap      The bitmap to split
     * @param  {number}     maxHeight   Maximum height of a piece in dots
     * @return {Bitmap[]}               The pieces, in order
     */
  static split(bitmap, maxHeight) {
    if (!Number.isInteger(maxHeight) || maxHeight < 1) {
      throw new Error('Maximum height must be a positive integer');
    }

    if (bitmap.height <= maxHeight) {
      return [bitmap];
    }

    const pieces = [];

    for (let y = 0; y < bitmap.height; y += maxHeight) {
      pieces.push(Bitmap.extractRows(bitmap, y, maxHeight));
    }

    return pieces;
  }

  /**
     * The bytes of one row without the white bytes at its right edge, which is
     * what printers that trim their rows need. An all white row is one byte, so
     * that a row is never empty. A bitmap without width has no rows at all, and
     * returns one white byte of its own, not a view.
     *
     * @param  {Bitmap}       bitmap   The bitmap to read from
     * @param  {number}       y        The row to read
     * @return {Uint8Array}            A view on the row, not a copy
     */
  static trimRow(bitmap, y) {
    const rowBytes = Bitmap.rowBytes(bitmap.width);

    if (rowBytes === 0) {
      return new Uint8Array(1);
    }

    const offset = y * rowBytes;

    let length = rowBytes;

    while (length > 1 && bitmap.data[offset + length - 1] === 0) {
      length--;
    }

    return bitmap.data.subarray(offset, offset + length);
  }
}

export default Bitmap;
