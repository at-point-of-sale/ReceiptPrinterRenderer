/**
 * @typedef {import('../types.js').Bitmap} Bitmap
 */

/**
 * Convert a bitmap to a PBM file, the binary P4 variant. The header is two
 * lines, the body is the rows of the bitmap as they are, because PBM packs its
 * rows exactly like the renderer does.
 *
 * @param  {Bitmap}       bitmap   The bitmap to convert
 * @return {Uint8Array}            The contents of a .pbm file
 */
export function toPbm(bitmap) {
  const header = `P4\n${bitmap.width} ${bitmap.height}\n`;
  const result = new Uint8Array(header.length + bitmap.data.length);

  for (let i = 0; i < header.length; i++) {
    result[i] = header.charCodeAt(i);
  }

  result.set(bitmap.data, header.length);

  return result;
}

export default toPbm;
