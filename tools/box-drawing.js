/*
    Synthetic box drawing and block glyphs, U+2500 to U+259F, for
    tools/generate.js.

    These are drawn here instead of taken from the outline font, because they
    have to connect to the cells around them: a line has to leave the cell at
    exactly the dot its neighbour expects, and both dots have to be the same
    thickness. Iosevka does have all of them, but it draws them for a cell of
    1.25 em, so at 24 dots per em its light line lands two dots above the middle
    of the cell, its double line comes out as one line of two dots and one of
    one, and in the 8 by 16 cell of font B the two lines of a double merge into
    a solid bar of four dots. A printer draws them on the dot grid, and so does
    this.

    Style: a light line is two dots thick, a heavy line four, and a double line
    is two single dot lines three dots apart. Junctions follow the rule that a
    double line is interrupted where the perpendicular double line passes
    through, which is what turns a cross into four elbows.
*/

/* The range of code points this module draws */

export const BOX_DRAWING = {first: 0x2500, last: 0x259f};

const NONE = 0;
const LIGHT = 1;
const HEAVY = 2;
const DOUBLE = 3;

/* Arms per code point, in the order up, right, down, left */

const ARMS = {
  0x2500: [0, 1, 0, 1], 0x2501: [0, 2, 0, 2], 0x2502: [1, 0, 1, 0], 0x2503: [2, 0, 2, 0],

  0x250c: [0, 1, 1, 0], 0x250d: [0, 2, 1, 0], 0x250e: [0, 1, 2, 0], 0x250f: [0, 2, 2, 0],
  0x2510: [0, 0, 1, 1], 0x2511: [0, 0, 1, 2], 0x2512: [0, 0, 2, 1], 0x2513: [0, 0, 2, 2],
  0x2514: [1, 1, 0, 0], 0x2515: [1, 2, 0, 0], 0x2516: [2, 1, 0, 0], 0x2517: [2, 2, 0, 0],
  0x2518: [1, 0, 0, 1], 0x2519: [1, 0, 0, 2], 0x251a: [2, 0, 0, 1], 0x251b: [2, 0, 0, 2],

  0x251c: [1, 1, 1, 0], 0x251d: [1, 2, 1, 0], 0x2520: [2, 1, 2, 0], 0x2523: [2, 2, 2, 0],
  0x2524: [1, 0, 1, 1], 0x2525: [1, 0, 1, 2], 0x2528: [2, 0, 2, 1], 0x252b: [2, 0, 2, 2],
  0x252c: [0, 1, 1, 1], 0x252f: [0, 2, 1, 2], 0x2530: [0, 1, 2, 1], 0x2533: [0, 2, 2, 2],
  0x2534: [1, 1, 0, 1], 0x2537: [1, 2, 0, 2], 0x2538: [2, 1, 0, 1], 0x253b: [2, 2, 0, 2],
  0x253c: [1, 1, 1, 1], 0x253f: [1, 2, 1, 2], 0x2542: [2, 1, 2, 1], 0x254b: [2, 2, 2, 2],

  0x2550: [0, 3, 0, 3], 0x2551: [3, 0, 3, 0],
  0x2552: [0, 3, 1, 0], 0x2553: [0, 1, 3, 0], 0x2554: [0, 3, 3, 0],
  0x2555: [0, 0, 1, 3], 0x2556: [0, 0, 3, 1], 0x2557: [0, 0, 3, 3],
  0x2558: [1, 3, 0, 0], 0x2559: [3, 1, 0, 0], 0x255a: [3, 3, 0, 0],
  0x255b: [1, 0, 0, 3], 0x255c: [3, 0, 0, 1], 0x255d: [3, 0, 0, 3],
  0x255e: [1, 3, 1, 0], 0x255f: [3, 1, 3, 0], 0x2560: [3, 3, 3, 0],
  0x2561: [1, 0, 1, 3], 0x2562: [3, 0, 3, 1], 0x2563: [3, 0, 3, 3],
  0x2564: [0, 3, 1, 3], 0x2565: [0, 1, 3, 1], 0x2566: [0, 3, 3, 3],
  0x2567: [1, 3, 0, 3], 0x2568: [3, 1, 0, 1], 0x2569: [3, 3, 0, 3],
  0x256a: [1, 3, 1, 3], 0x256b: [3, 1, 3, 1], 0x256c: [3, 3, 3, 3],

  0x2574: [0, 0, 0, 1], 0x2575: [1, 0, 0, 0], 0x2576: [0, 1, 0, 0], 0x2577: [0, 0, 1, 0],
  0x2578: [0, 0, 0, 2], 0x2579: [2, 0, 0, 0], 0x257a: [0, 2, 0, 0], 0x257b: [0, 0, 2, 0],
  0x257c: [0, 2, 0, 1], 0x257d: [1, 0, 2, 0], 0x257e: [0, 1, 0, 2], 0x257f: [2, 0, 1, 0],
};

/* Dashed lines: the arms they are drawn from, and the number of dashes */

const DASHED = {
  0x2504: [[0, 1, 0, 1], 3], 0x2505: [[0, 2, 0, 2], 3],
  0x2506: [[1, 0, 1, 0], 3], 0x2507: [[2, 0, 2, 0], 3],
  0x2508: [[0, 1, 0, 1], 4], 0x2509: [[0, 2, 0, 2], 4],
  0x250a: [[1, 0, 1, 0], 4], 0x250b: [[2, 0, 2, 0], 4],
  0x254c: [[0, 1, 0, 1], 2], 0x254d: [[0, 2, 0, 2], 2],
  0x254e: [[1, 0, 1, 0], 2], 0x254f: [[2, 0, 2, 0], 2],
};

/* Arcs, the same arms as the sharp corner they round off */

const ARCS = {
  0x256d: [0, 1, 1, 0], 0x256e: [0, 0, 1, 1], 0x256f: [1, 0, 0, 1], 0x2570: [1, 1, 0, 0],
};

/**
 * A cell of a font, with the helpers the drawing needs
 *
 * @param  {number}   width    Cell width in dots
 * @param  {number}   height   Cell height in dots
 * @return {object}            The cell and its drawing operations
 */
function surface(width, height) {
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(rowBytes * height);

  const dot = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  };

  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
        dot(x, y);
      }
    }
  };

  return {width, height, data, dot, rect};
}

/**
 * Where the bands and the double lines of a cell of this size sit
 *
 * @param  {number}   width    Cell width in dots
 * @param  {number}   height   Cell height in dots
 * @return {object}            Positions of the light, heavy and double lines
 */
function geometry(width, height) {
  const band = (extent, thickness) => {
    const start = Math.floor((extent - thickness) / 2);
    return [start, start + thickness - 1];
  };

  const vDouble = Math.round(width / 2) - 2;
  const hDouble = Math.round(height / 2) - 2;

  return {
    light: {v: band(width, 2), h: band(height, 2)},
    heavy: {v: band(width, 4), h: band(height, 4)},
    double: {v: [vDouble, vDouble + 3], h: [hDouble, hDouble + 3]},
  };
}

/**
 * The lines one axis of a junction is drawn from: one band for a light or a
 * heavy line, two one dot lines for a double one
 *
 * @param  {object}   grid    Geometry of the cell
 * @param  {string}   axis    'v' for the vertical lines, 'h' for the horizontal ones
 * @param  {number}   style   NONE, LIGHT, HEAVY or DOUBLE
 * @return {object}           The lines and the extent they cover
 */
function linesOf(grid, axis, style) {
  if (style === DOUBLE) {
    const [a, b] = grid.double[axis];
    return {lines: [[a, a], [b, b]], double: true, start: a, end: b};
  }

  const [a, b] = (style === HEAVY ? grid.heavy : grid.light)[axis];

  return {lines: style === NONE ? [] : [[a, b]], double: false, start: a, end: b};
}

/**
 * Draw a box drawing character from its four arms
 *
 * @param  {object}     cell    Surface to draw on
 * @param  {number[]}   arms    Style of the up, right, down and left arm
 * @param  {number}     dashes  Number of dashes of a dashed line, 0 for a solid one
 */
function drawArms(cell, arms, dashes) {
  const [up, right, down, left] = arms;
  const grid = geometry(cell.width, cell.height);

  const vStyle = Math.max(up, down);
  const hStyle = Math.max(right, left);

  const vertical = linesOf(grid, 'v', vStyle || LIGHT);
  const horizontal = linesOf(grid, 'h', hStyle || LIGHT);

  const broken = vertical.double && horizontal.double;

  /* The horizontal lines, from the left edge or the vertical structure, to the
     right edge or the vertical structure */

  if (hStyle) {
    for (let i = 0; i < horizontal.lines.length; i++) {
      const [ya, yb] = horizontal.lines[i];

      const xs = left ? 0 : vertical.start;
      const xe = right ? cell.width - 1 : vertical.end;

      const cut = broken && (i === 0 ? up : down);

      if (cut) {
        cell.rect(xs, ya, Math.min(xe, vertical.start), yb);
        cell.rect(Math.max(xs, vertical.end), ya, xe, yb);
      } else {
        cell.rect(xs, ya, xe, yb);
      }
    }
  }

  /* And the vertical lines the same way */

  if (vStyle) {
    for (let i = 0; i < vertical.lines.length; i++) {
      const [xa, xb] = vertical.lines[i];

      const ys = up ? 0 : horizontal.start;
      const ye = down ? cell.height - 1 : horizontal.end;

      const cut = broken && (i === 0 ? left : right);

      if (cut) {
        cell.rect(xa, ys, xb, Math.min(ye, horizontal.start));
        cell.rect(xa, Math.max(ys, horizontal.end), xb, ye);
      } else {
        cell.rect(xa, ys, xb, ye);
      }
    }
  }

  /* A dashed line keeps the gaps of the dash pattern */

  if (dashes) {
    const gap = 1;
    const rowBytes = Math.ceil(cell.width / 8);

    if (hStyle) {
      const run = cell.width / dashes;

      for (let x = 0; x < cell.width; x++) {
        if (x % run >= run - gap) {
          for (let y = 0; y < cell.height; y++) {
            cell.data[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
          }
        }
      }
    } else {
      const run = cell.height / dashes;

      for (let y = 0; y < cell.height; y++) {
        if (y % run >= run - gap) {
          cell.data.fill(0, y * rowBytes, (y + 1) * rowBytes);
        }
      }
    }
  }
}

/**
 * Draw a rounded corner: the two arms, and a quarter circle that joins them
 *
 * @param  {object}     cell   Surface to draw on
 * @param  {number[]}   arms   Style of the up, right, down and left arm
 */
function drawArc(cell, arms) {
  const [up, right, down, left] = arms;
  const grid = geometry(cell.width, cell.height);

  const [vx0, vx1] = grid.light.v;
  const [hy0, hy1] = grid.light.h;

  const cx = (vx0 + vx1 + 1) / 2;
  const cy = (hy0 + hy1 + 1) / 2;

  const radius = Math.max(2, Math.round(Math.min(cell.width, cell.height) / 4));

  const ox = right ? cx + radius : cx - radius;
  const oy = down ? cy + radius : cy - radius;

  /* The arms stop where the arc starts */

  if (right) {
    cell.rect(Math.round(ox), hy0, cell.width - 1, hy1);
  }

  if (left) {
    cell.rect(0, hy0, Math.round(ox) - 1, hy1);
  }

  if (down) {
    cell.rect(vx0, Math.round(oy), vx1, cell.height - 1);
  }

  if (up) {
    cell.rect(vx0, 0, vx1, Math.round(oy) - 1);
  }

  /* And the quarter circle, one dot of ink on either side of the radius */

  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;

      /* Only the quadrant that faces the two arms */

      if ((right ? dx > 0 : dx < 0) || (down ? dy > 0 : dy < 0)) {
        continue;
      }

      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - radius) <= 1) {
        cell.dot(x, y);
      }
    }
  }
}

/**
 * Draw one of the three diagonals
 *
 * @param  {object}   cell        Surface to draw on
 * @param  {number}   codepoint   U+2571, U+2572 or U+2573
 */
function drawDiagonal(cell, codepoint) {
  const slash = codepoint !== 0x2572;
  const backslash = codepoint !== 0x2571;

  for (let y = 0; y < cell.height; y++) {
    const t = cell.height === 1 ? 0 : y / (cell.height - 1);
    const x = t * (cell.width - 1);

    if (backslash) {
      cell.dot(Math.floor(x), y);
      cell.dot(Math.ceil(x), y);
    }

    if (slash) {
      cell.dot(cell.width - 1 - Math.floor(x), y);
      cell.dot(cell.width - 1 - Math.ceil(x), y);
    }
  }
}

/**
 * Draw a block or a shade
 *
 * @param  {object}    cell        Surface to draw on
 * @param  {number}    codepoint   U+2580 to U+259F
 * @return {boolean}               True when this code point is a block
 */
function drawBlock(cell, codepoint) {
  const {width: w, height: h} = cell;

  const eighthX = (n) => Math.round((n * w) / 8);
  const eighthY = (n) => Math.round((n * h) / 8);

  const shade = (test) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (test(x, y)) {
          cell.dot(x, y);
        }
      }
    }
  };

  /* The quadrants, for U+2596 to U+259F */

  const quadrant = (mask) => {
    const mx = Math.round(w / 2);
    const my = Math.round(h / 2);

    if (mask & 1) {
      cell.rect(0, 0, mx - 1, my - 1); /* upper left */
    }

    if (mask & 2) {
      cell.rect(mx, 0, w - 1, my - 1); /* upper right */
    }

    if (mask & 4) {
      cell.rect(0, my, mx - 1, h - 1); /* lower left */
    }

    if (mask & 8) {
      cell.rect(mx, my, w - 1, h - 1); /* lower right */
    }
  };

  if (codepoint === 0x2580) {
    cell.rect(0, 0, w - 1, Math.round(h / 2) - 1);
    return true;
  }

  if (codepoint >= 0x2581 && codepoint <= 0x2588) {
    cell.rect(0, h - eighthY(codepoint - 0x2580), w - 1, h - 1);
    return true;
  }

  if (codepoint >= 0x2589 && codepoint <= 0x258f) {
    cell.rect(0, 0, eighthX(0x2590 - codepoint) - 1, h - 1);
    return true;
  }

  if (codepoint === 0x2590) {
    cell.rect(Math.round(w / 2), 0, w - 1, h - 1);
    return true;
  }

  if (codepoint === 0x2591) {
    shade((x, y) => (x + (y % 2) * 2) % 4 === 0);
    return true;
  }

  if (codepoint === 0x2592) {
    shade((x, y) => (x + y) % 2 === 0);
    return true;
  }

  if (codepoint === 0x2593) {
    shade((x, y) => (x + (y % 2) * 2) % 4 !== 0);
    return true;
  }

  if (codepoint === 0x2594) {
    cell.rect(0, 0, w - 1, eighthY(1) - 1);
    return true;
  }

  if (codepoint === 0x2595) {
    cell.rect(w - eighthX(1), 0, w - 1, h - 1);
    return true;
  }

  const quadrants = {
    0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 1 | 4 | 8, 0x259a: 1 | 8,
    0x259b: 1 | 2 | 4, 0x259c: 1 | 2 | 8, 0x259d: 2, 0x259e: 2 | 4, 0x259f: 2 | 4 | 8,
  };

  if (codepoint in quadrants) {
    quadrant(quadrants[codepoint]);
    return true;
  }

  return false;
}

/**
 * The cell of a box drawing or block character, drawn for a cell of this size
 *
 * @param  {number}   codepoint   Unicode code point
 * @param  {number}   width       Cell width in dots
 * @param  {number}   height      Cell height in dots
 * @return {Uint8Array}           Packed rows of the cell, or null when this is not one of them
 */
export function boxGlyph(codepoint, width, height) {
  const cell = surface(width, height);

  if (codepoint in ARMS) {
    drawArms(cell, ARMS[codepoint], 0);
    return cell.data;
  }

  if (codepoint in DASHED) {
    drawArms(cell, DASHED[codepoint][0], DASHED[codepoint][1]);
    return cell.data;
  }

  if (codepoint in ARCS) {
    drawArc(cell, ARCS[codepoint]);
    return cell.data;
  }

  if (codepoint >= 0x2571 && codepoint <= 0x2573) {
    drawDiagonal(cell, codepoint);
    return cell.data;
  }

  if (codepoint >= 0x2580 && codepoint <= 0x259f && drawBlock(cell, codepoint)) {
    return cell.data;
  }

  return null;
}

export default boxGlyph;
