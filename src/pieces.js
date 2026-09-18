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

    An entry the cut runs through, which a cutter distance can put there since
    a cut then lands wherever the command stood, is on both pieces: the printer
    cuts through the ink, so the rows above the cut are on the piece above and
    the rows below it on the piece below. Such an entry is in both lists, at
    its row relative to each, which is negative on the lower piece, and a
    consumer draws the rows of it that are on the piece and no others:
    `rasterize()` clips to the height of the list and the SVG writer clips the
    body to the paper, so both do. A piece carries no cutter distance of its
    own: it is paper that has left the printer, and nothing is held back on it.

    The list is not changed: every piece is a copy, with copies of its entries,
    and the operations and the areas, which are relative to their entry, are
    shared with the list, as the list itself shares them with nobody.
*/

/**
 * Whether any row of an entry is on a piece of paper: an entry that takes up
 * rows is on every piece its rows reach, a command, which takes up none, on
 * the piece the row it stands on belongs to
 *
 * @param  {LayoutEntry}   entry    The entry
 * @param  {number}        top      First row of the piece
 * @param  {number}        bottom   Row after the last one of the piece
 * @return {boolean}                True when the entry is on the piece
 */
function covers(entry, top, bottom) {
  const end = entry.y + (entry.height || 0);

  return entry.y < bottom && Math.max(end, entry.y + 1) > top;
}

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

    const piece = Object.assign({}, layout, {
      height: bottom - top,
      entries: entries
          .filter((entry) => entry.type !== 'cut' && covers(entry, top, bottom))
          .map((entry) => Object.assign({}, entry, {y: entry.y - top})),
    });

    /* A piece has left the printer, so there is no cutter below it holding
       rows back: the distance belongs to the list of the job and not to the
       paper it cut */

    delete piece.cutterDistance;

    result.push(piece);
  }

  return result;
}

export default pieces;
