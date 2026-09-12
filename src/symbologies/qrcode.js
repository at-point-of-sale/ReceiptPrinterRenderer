import {generate, mode, correction} from 'lean-qr';
import Bitmap from '../bitmap.js';

/**
 * @typedef {import('../bitmap.js').Bitmap} Bitmap
 */

/*
    QR codes, through lean-qr.

    A printer stores the bytes of the data and encodes them in the byte mode of
    the specification, so that any byte round trips, whatever codepage the
    reader assumes. The version, the size of the symbol, is the smallest one the
    data fits in at the requested error correction level, which is what printer
    firmware picks as well.
*/

const LEVELS = Object.assign(Object.create(null), {
  L: correction.L,
  M: correction.M,
  Q: correction.Q,
  H: correction.H,
});

/**
 * Generate a QR code, one dot per module, without a quiet zone
 *
 * @param  {Uint8Array|number[]}   data           The bytes to encode
 * @param  {string}                [errorLevel]   Error correction level, 'L', 'M', 'Q' or 'H'
 * @return {Bitmap|null}                          The symbol, or null when the data does not fit
 */
export function qrcode(data, errorLevel = 'M') {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data || []);
  const name = String(errorLevel).toUpperCase();

  /* The lowest level of lean-qr is zero, so the level is looked up by name and
     not by whether the value is truthy */

  const level = name in LEVELS ? LEVELS[name] : correction.M;

  let code;

  try {
    code = generate(mode.bytes(bytes), {minCorrectionLevel: level, maxCorrectionLevel: level});
  } catch (error) {
    /* There is more data than the largest symbol of this error correction
       level holds, which a printer answers with an empty print */

    return null;
  }

  const bitmap = Bitmap.create(code.size, code.size);

  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.get(x, y)) {
        Bitmap.setPixel(bitmap, x, y, 1);
      }
    }
  }

  return bitmap;
}

export default qrcode;
