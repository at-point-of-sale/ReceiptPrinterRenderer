import {scanlines, encode} from '../formats/png.js';

/**
 * @typedef {import('../types.js').Bitmap} Bitmap
 */

/*
    PNG without a compressor, for the images of an SVG document.

    src/formats/png.js compresses its scanlines with the platform's
    CompressionStream, which is asynchronous, and toSvg() is a function that
    returns a string. Deflate has a stored block, a block of bytes that are not
    compressed at all, so a valid deflate stream can be written without a
    compressor: the zlib header, the scanlines in blocks of at most 65535 bytes
    and the Adler-32 of the uncompressed data. The file is the file toPng()
    writes with another IDAT: the signature, the header, the scanlines and the
    checksums come from the same code.

    A receipt is text, an image on it is a logo of a few kilobytes, and the
    document carries it as base64, so the third the compression would save is
    worth less than a writer that stays synchronous. The rows are one bit per
    dot already.
*/

/* The largest a stored deflate block can be, the LEN field being two bytes */

const BLOCK = 0xffff;

/* The base of the Adler-32 checksum, the largest prime below 65536 */

const ADLER = 65521;

/**
 * The Adler-32 of a range of bytes, which is what the zlib framing of a deflate
 * stream ends with
 *
 * @param  {Uint8Array}   bytes   The bytes
 * @return {number}               The checksum
 */
export function adler32(bytes) {
  let low = 1;
  let high = 0;

  for (let index = 0; index < bytes.length; index++) {
    low = (low + bytes[index]) % ADLER;
    high = (high + low) % ADLER;
  }

  return ((high << 16) | low) >>> 0;
}

/**
 * A deflate stream of stored blocks, with the zlib framing PNG asks for: the
 * two header bytes, one block per 65535 bytes with its length and its
 * complement, and the Adler-32 of the data
 *
 * @param  {Uint8Array}   data   The bytes to store
 * @return {Uint8Array}          The stream
 */
export function stored(data) {
  const blocks = Math.max(1, Math.ceil(data.length / BLOCK));
  const result = new Uint8Array(2 + blocks * 5 + data.length + 4);
  const view = new DataView(result.buffer);

  /* Deflate with a 32 kB window, no preset dictionary, and a check that makes
     the two bytes a multiple of 31, which is the header every zlib stream has */

  result[0] = 0x78;
  result[1] = 0x01;

  let offset = 2;

  for (let block = 0; block < blocks; block++) {
    const start = block * BLOCK;
    const length = Math.min(BLOCK, data.length - start);

    result[offset] = block === blocks - 1 ? 1 : 0;

    /* The length and its complement are the only two little endian numbers of
       a PNG file, deflate being little endian where PNG is not */

    view.setUint16(offset + 1, length, true);
    view.setUint16(offset + 3, ~length & 0xffff, true);

    result.set(data.subarray(start, start + length), offset + 5);

    offset += 5 + length;
  }

  view.setUint32(offset, adler32(data));

  return result;
}

/**
 * Convert a bitmap to a PNG file without compressing it, one bit per pixel,
 * greyscale. It is toPng() of src/formats/png.js with stored deflate blocks in
 * place of the compression, so that it is synchronous and needs no
 * CompressionStream.
 *
 * @param  {Bitmap}       bitmap   The bitmap to convert
 * @return {Uint8Array}            The contents of a .png file
 */
export function toStoredPng(bitmap) {
  return encode(bitmap, stored(scanlines(bitmap)));
}

export default toStoredPng;
