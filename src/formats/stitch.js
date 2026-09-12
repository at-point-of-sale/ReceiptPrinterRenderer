import Bitmap from '../bitmap.js';

/**
 * @typedef {import('../bitmap.js').Bitmap} Bitmap
 */

/**
 * @typedef {object} StitchOptions
 * @property {boolean} [cutMarker]   Draw a dashed line where the paper is cut, false by default
 * @property {boolean} [feed]        Expand feed items to white rows, true by default
 * @property {number} [width]        Width in dots, taken from the first image item when it is left out
 */

/* The dashed line of a cut: two rows of alternating dots, so that it reads as a
   cut and not as content */

const CUT_HEIGHT = 2;
const CUT_DASH = 8;

/**
 * Join the items of a render into one bitmap, the way the paper comes out of
 * the printer: image items below each other, a feed item as white rows, and
 * optionally a dashed line at every cut. Commands that do not move the paper,
 * a pulse and an unknown command, take up no space.
 *
 * This is a preview helper. A driver sends the items to the printer instead.
 *
 * @param  {object[]}        items     The items of a render
 * @param  {StitchOptions}   options   How to join them
 * @return {Bitmap}                    The paper
 */
export function stitch(items, options) {
  const settings = Object.assign({cutMarker: false, feed: true}, options || {});
  const list = items || [];

  const width = typeof settings.width === 'number' ?
    settings.width :
    (list.find((item) => item.type === 'image')?.width || 0);

  /* What ends up on the paper, and how tall each piece is */

  const pieces = [];

  for (const item of list) {
    if (item.type === 'image') {
      pieces.push({item, height: item.height});
    }

    if (item.type === 'feed' && settings.feed) {
      pieces.push({item, height: item.height});
    }

    if (item.type === 'cut' && settings.cutMarker) {
      pieces.push({item, height: CUT_HEIGHT});
    }
  }

  const bitmap = Bitmap.create(width, pieces.reduce((total, piece) => total + piece.height, 0));

  let y = 0;

  for (const piece of pieces) {
    /* An image item is drawn and not copied row by row, because an item of
       another width than the paper, from a driver that renders in pieces, has
       another number of bytes per row */

    if (piece.item.type === 'image') {
      Bitmap.blit(piece.item, bitmap, 0, y);
    }

    if (piece.item.type === 'cut') {
      for (let row = y; row < y + CUT_HEIGHT; row++) {
        for (let x = 0; x < width; x++) {
          Bitmap.setPixel(bitmap, x, row, Math.floor(x / CUT_DASH) % 2 === 0 ? 1 : 0);
        }
      }
    }

    y += piece.height;
  }

  return bitmap;
}

export default stitch;
