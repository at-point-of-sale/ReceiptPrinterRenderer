/**
 * @typedef {import('../types.js').Bitmap} Bitmap
 */

/*
    PNG, one bit per pixel.

    The file is the signature, an IHDR chunk, one IDAT chunk with the compressed
    scanlines and an IEND chunk. Compression is deflate with the zlib framing the
    format asks for, which the platform's CompressionStream provides, in browsers
    and in Node, so the helper needs no zlib dependency and is asynchronous.
*/

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* The table of the CRC32 of the PNG specification, polynomial 0xedb88320 */

let table = null;

/**
 * The CRC32 table, built once
 *
 * @return {Uint32Array}   The table
 */
function crcTable() {
  if (table) {
    return table;
  }

  table = new Uint32Array(256);

  for (let index = 0; index < 256; index++) {
    let value = index;

    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

/**
 * The CRC32 of a range of bytes, as PNG computes it over the type and the data
 * of a chunk
 *
 * @param  {Uint8Array}   bytes   The bytes
 * @return {number}               The checksum
 */
export function crc32(bytes) {
  const lookup = crcTable();

  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index++) {
    crc = lookup[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A chunk: the length of its data, its type, its data and the checksum over
 * the type and the data
 *
 * @param  {string}       type   The four letter type of the chunk
 * @param  {Uint8Array}   data   The contents of the chunk
 * @return {Uint8Array}          The bytes of the chunk
 */
function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, data.length);

  for (let index = 0; index < 4; index++) {
    bytes[4 + index] = type.charCodeAt(index);
  }

  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));

  return bytes;
}

/**
 * Compress with the platform's CompressionStream, which produces the zlib
 * framing PNG wants
 *
 * @param  {Uint8Array}            data   The bytes to compress
 * @return {Promise<Uint8Array>}          The compressed bytes
 */
async function deflate(data) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('No CompressionStream available, toPng() needs one to compress the image');
  }

  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();

  writer.write(data);
  writer.close();

  const reader = stream.readable.getReader();
  const chunks = [];

  let length = 0;

  for (;;) {
    const {done, value} = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    length += value.length;
  }

  const result = new Uint8Array(length);

  let offset = 0;

  for (const piece of chunks) {
    result.set(piece, offset);
    offset += piece.length;
  }

  return result;
}

/**
 * Convert a bitmap to a PNG file, one bit per pixel, greyscale.
 *
 * A greyscale PNG of one bit reads a set bit as white, the renderer reads it as
 * a black dot, so the rows are inverted. The bits that pad a row to a whole
 * byte become white as well, which is what they are on paper.
 *
 * @param  {Bitmap}                bitmap   The bitmap to convert
 * @return {Promise<Uint8Array>}            The contents of a .png file
 */
export async function toPng(bitmap) {
  if (!bitmap || bitmap.width < 1 || bitmap.height < 1) {
    throw new Error('A PNG needs an image of at least one dot, this one has none');
  }

  const rowBytes = (bitmap.width + 7) >> 3;

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);

  view.setUint32(0, bitmap.width);
  view.setUint32(4, bitmap.height);

  header[8] = 1; /* one bit per sample */
  header[9] = 0; /* greyscale, no alpha */
  header[10] = 0; /* deflate */
  header[11] = 0; /* the only filter method there is */
  header[12] = 0; /* not interlaced */

  /* Every scanline carries a filter byte of its own, and none of them is
     filtered: the rows are already as small as one bit per dot makes them */

  const raw = new Uint8Array((rowBytes + 1) * bitmap.height);

  for (let row = 0; row < bitmap.height; row++) {
    const source = row * rowBytes;
    const target = row * (rowBytes + 1) + 1;

    for (let byte = 0; byte < rowBytes; byte++) {
      raw[target + byte] = ~bitmap.data[source + byte] & 0xff;
    }
  }

  const chunks = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const result = new Uint8Array(chunks.reduce((total, piece) => total + piece.length, 0));

  let offset = 0;

  for (const piece of chunks) {
    result.set(piece, offset);
    offset += piece.length;
  }

  return result;
}

export default toPng;
