import Bitmap from '../../src/bitmap.js';

/*
   The items of a stream as one bitmap, the way the paper comes out of the
   printer: image items one below the other and a feed item as white rows.
   Commands do not take up paper and are skipped. A proper stitch helper, with
   a dashed line at every cut, is part of the package in a later section.
*/

/**
 * Join the image and feed items of a stream into one bitmap
 *
 * @param  {object[]}   items     The items of a render
 * @param  {number}     [width]   Width in dots, taken from the first image item when left out
 * @return {object}               The bitmap
 */
export function stitch(items, width) {
  const paper = items.filter((item) => item.type === 'image' || item.type === 'feed');

  const dots = typeof width === 'number' ?
    width :
    (paper.find((item) => item.type === 'image')?.width || 0);

  const height = paper.reduce((total, item) => total + item.height, 0);

  const bitmap = Bitmap.create(dots, height);
  const rowBytes = Bitmap.rowBytes(dots);

  let y = 0;

  for (const item of paper) {
    if (item.type === 'image') {
      bitmap.data.set(item.data, y * rowBytes);
    }

    y += item.height;
  }

  return bitmap;
}

/**
 * The items that are not images, which is what the item fixtures record
 *
 * @param  {object[]}   items   The items of a render
 * @return {object[]}           The commands, in order
 */
export function commands(items) {
  return items
      .filter((item) => item.type !== 'image')
      .map((item) => {
        const result = {type: item.type};

        for (const property of ['value', 'device', 'on', 'off', 'height']) {
          if (typeof item[property] !== 'undefined') {
            result[property] = item[property];
          }
        }

        if (item.type === 'unknown') {
          result.data = Array.from(item.data);
        }

        return result;
      });
}

export default stitch;
