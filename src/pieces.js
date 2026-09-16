/**
 * @typedef {import('./types.js').Layout} Layout
 * @typedef {import('./types.js').LayoutEntry} LayoutEntry
 */

/*
    The pieces of paper of a display list.

    A list is the whole roll a stream printed, from its first row to its last,
    with the cuts in it as entries. What leaves the printer is one piece of
    paper per run between two cuts, and a consumer that shows a receipt as it
    came out, one image per piece, needs the list split the same way: this
    module does that, and nothing else.

    A piece is a list of its own, with the same version, language, width and
    resolution, the height of the paper between its two cuts, and the entries
    that start on it, moved up so that its first row is row 0. The cuts are the
    boundaries and are left out of the pieces; a feed, a pulse or an unknown
    command stays where it stands. `toSvg()` writes one document of a piece
    and `rasterize()` draws one set of items of it, the same dots stitching the
    items of a render between two cuts gives.

    The paper is cut between row `y - 1` and row `y` of a cut, so row `y` is
    the first row of the next piece, and a piece is the rows from one cut up
    to and not including the next. A cut at the very top or the very bottom,
    or two cuts at the same row, leave no paper between them and no piece: a
    piece is never empty, though it may be blank, a feed and nothing on it.

    The list is not changed: every piece is a copy, with copies of its entries,
    and the operations and the areas, which are relative to their entry, are
    shared with the list, as the list itself shares them with nobody.
*/

/**
 * The pieces of paper of a display list, one list per run between two cuts,
 * in the order they leave the printer
 *
 * @param  {Layout}     layout   The display list, as layout() returned it
 * @return {Layout[]}            The pieces, each a display list of its own
 */
export function pieces(layout) {
  if (!layout || typeof layout !== 'object') {
    throw new Error('A display list is required');
  }

  const height = Math.max(0, layout.height || 0);
  const entries = layout.entries || [];

  /* The rows the paper is cut on, in order, each once, and inside the paper */

  const rows = [...new Set(
      entries
          .filter((entry) => entry.type === 'cut')
          .map((entry) => Math.max(0, Math.min(height, entry.y))),
  )].sort((a, b) => a - b);

  const bounds = [0, ...rows, height];

  const result = [];

  for (let index = 0; index + 1 < bounds.length; index++) {
    const top = bounds[index];
    const bottom = bounds[index + 1];

    if (bottom <= top) {
      continue;
    }

    result.push(Object.assign({}, layout, {
      height: bottom - top,
      entries: entries
          .filter((entry) => entry.type !== 'cut' && entry.y >= top && entry.y < bottom)
          .map((entry) => Object.assign({}, entry, {y: entry.y - top})),
    }));
  }

  return result;
}

export default pieces;
