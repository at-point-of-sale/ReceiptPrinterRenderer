import ReceiptPrinterRenderer, {pieces, rasterize, stitch} from '../src/receipt-printer-renderer.js';
import {toSvg} from '../src/svg.js';
import Bitmap from '../src/bitmap.js';
import {names, fixture} from './helpers/fixtures.js';
import {Resvg, unavailable} from './helpers/resvg.js';
import {fromPng} from '../tools/contact-sheet/references/shared.js';
import {assert} from 'chai';

/*
    The cutter's distance, the `cutterDistance` option.

    The cutter sits above the print head, so the paper between the two is blank
    and already past the head when a job starts: the job prints that far below
    the cut edge, and a cut lands that far above the row its command was given
    at. Seen from the paper the rule is one sentence: the paper of a job is the
    cutter's distance of blank rows followed by the job's rows, and every cut
    lands at the row its command was given at, counted in the job's rows.

    What is checked here is that rule, in the display list, in the items of a
    render, in the pieces of paper and in the SVG of a piece, and that a
    renderer without the option renders exactly what it rendered before.
*/

/* The printer of these lists, the paper of the fixtures */

const WIDTH = 576;

/* The line spacing of the Epson profile, which every job below is laid out
   with: four lines are 120 dots, the usual feed in front of a cut */

const SPACING = 30;

/**
 * A stream of ESC/POS commands
 *
 * @param  {Array<number|string>}   parts   Bytes and text, in order
 * @return {Uint8Array}                     The commands
 */
function stream(parts) {
  const bytes = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      bytes.push(...[...part].map((character) => character.charCodeAt(0)));
      continue;
    }

    bytes.push(part);
  }

  return Uint8Array.from(bytes);
}

/* The commands the jobs below are built from */

const INITIALIZE = [0x1b, 0x40];
const LF = 0x0a;
const CUT = [0x1d, 0x56, 0x00];

/**
 * A renderer with a cutter distance
 *
 * @param  {number}   distance    The distance in dots
 * @param  {object}   [options]   The other options
 * @return {ReceiptPrinterRenderer}   The renderer
 */
function renderer(distance, options) {
  return new ReceiptPrinterRenderer(Object.assign(
      {width: WIDTH, commands: ['cut'], cutterDistance: distance},
      options || {},
  ));
}

/**
 * The paper of a render, the items stitched
 *
 * @param  {object[]}   items   The items
 * @return {object}             The bitmap
 */
function paper(items) {
  return stitch(items, {width: WIDTH});
}

/**
 * The pieces of a stream, as the bitmaps they print
 *
 * @param  {object}   layout   The display list
 * @return {object[]}          One bitmap per piece
 */
function papers(layout) {
  return pieces(layout).map((piece) => paper(rasterize(piece, {commands: ['cut']})));
}

/**
 * The bitmaps below each other, the way the pieces of paper stack up again
 *
 * @param  {object[]}   bitmaps   The bitmaps, in order
 * @return {object}               One bitmap of all of them
 */
function stack(bitmaps) {
  const result = Bitmap.create(WIDTH, bitmaps.reduce((total, bitmap) => total + bitmap.height, 0));

  let y = 0;

  for (const bitmap of bitmaps) {
    Bitmap.blit(bitmap, result, 0, y);
    y += bitmap.height;
  }

  return result;
}

/**
 * The rows of a bitmap, from one row up to another
 *
 * @param  {object}   bitmap   The bitmap
 * @param  {number}   top      The first row
 * @param  {number}   bottom   The row after the last one
 * @return {object}            The rows
 */
function rows(bitmap, top, bottom) {
  const result = Bitmap.create(bitmap.width, bottom - top);

  result.data.set(bitmap.data.subarray(
      top * Bitmap.rowBytes(bitmap.width),
      bottom * Bitmap.rowBytes(bitmap.width),
  ));

  return result;
}

/**
 * The heights of the runs of an item stream between its cut items, the pieces
 * of paper a driver that sends the items to a printer ends up with
 *
 * @param  {object[]}   items   The items of a render
 * @return {number[]}           The height of every run that has rows
 */
function runs(items) {
  const result = [[]];

  for (const item of items) {
    if (item.type === 'cut') {
      result.push([]);
    } else {
      result[result.length - 1].push(item);
    }
  }

  return result.map((run) => stitch(run, {width: WIDTH}).height).filter((height) => height > 0);
}

/**
 * A seeded pseudo random number generator, so that the fuzz below runs the same
 * streams on every machine and a failure can be looked at again
 *
 * @param  {number}   seed   The seed
 * @return {function(): number}   A function that gives the next number, 0 to 1
 */
function random(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let value = Math.imul(state ^ (state >>> 15), 1 | state);

    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random job: text, empty lines, feeds forward and back, cuts, pulses,
 * unknown commands and raster images, which is everything that moves the paper
 * or leaves a marker on it
 *
 * @param  {function(): number}   next   The generator
 * @return {Uint8Array}                  The commands
 */
function job(next) {
  const bytes = [...INITIALIZE];
  const count = 5 + Math.floor(next() * 20);

  for (let index = 0; index < count; index++) {
    const pick = Math.floor(next() * 10);

    /* GS V, ESC p, the GS ( z nobody has, ESC d, ESC J, ESC e, ESC K, GS v 0,
       an empty line, and a line of text */

    if (pick === 0) {
      bytes.push(0x1d, 0x56, next() < 0.5 ? 0x00 : 0x01);
    } else if (pick === 1) {
      bytes.push(0x1b, 0x70, 0x00, 0x32, 0x32);
    } else if (pick === 2) {
      bytes.push(0x1d, 0x28, 0x7a, 0x02, 0x00, 0x30, 0x31);
    } else if (pick === 3) {
      bytes.push(0x1b, 0x64, Math.floor(next() * 4));
    } else if (pick === 4) {
      bytes.push(0x1b, 0x4a, Math.floor(next() * 49));
    } else if (pick === 5) {
      bytes.push(0x1b, 0x65, Math.floor(next() * 3));
    } else if (pick === 6) {
      bytes.push(0x1b, 0x4b, Math.floor(next() * 49));
    } else if (pick === 7) {
      const height = 1 + Math.floor(next() * 40);

      bytes.push(0x1d, 0x76, 0x30, 0x00, 2, 0, height & 0xff, height >> 8);

      for (let row = 0; row < height * 2; row++) {
        bytes.push(Math.floor(next() * 256));
      }
    } else if (pick === 8) {
      bytes.push(LF);
    } else {
      const text = 1 + Math.floor(next() * 8);

      for (let cell = 0; cell < text; cell++) {
        bytes.push(0x41 + Math.floor(next() * 26));
      }

      bytes.push(LF);
    }
  }

  return Uint8Array.from(bytes);
}

/* The command sets and the distances the invariant below is checked under:
   everything a renderer performs, and a distance of none, of less than a line,
   of a line and of the four lines of a real cutter */

const SETS = [['cut'], ['cut', 'feed'], ['cut', 'pulse'], ['cut', 'pulse', 'unknown', 'feed']];
const DISTANCES = [0, 7, 24, 120];

/**
 * The two invariants of a stream: the item stream of a render is the item
 * stream of rasterizing its display list, and the runs of that stream between
 * its cuts are the pieces of paper of the same list
 *
 * @param  {Uint8Array}   bytes     The commands
 * @param  {object}       options   The options of the renderer
 * @param  {string}       what      What is being checked, for the message
 */
function agrees(bytes, options, what) {
  const items = new ReceiptPrinterRenderer(options).render(bytes);
  const layout = new ReceiptPrinterRenderer(options).layout(bytes);

  const bytesOf = (value) => JSON.stringify(value, (key, held) => held instanceof Uint8Array ?
    Array.from(held) :
    held);

  assert.equal(
      bytesOf(rasterize(layout, {commands: options.commands})),
      bytesOf(items),
      `${what}: the render and the rasterized list differ`,
  );

  assert.deepEqual(
      runs(items),
      pieces(layout).map((piece) => piece.height),
      `${what}: the runs of the item stream and the pieces of the list differ`,
  );
}

describe('the cutter distance', function() {
  describe('the option', function() {
    it('should change nothing at all when it is left out or zero', function() {
      const bytes = fixture('esc-pos', 'cut').bytes;

      const plain = new ReceiptPrinterRenderer({width: WIDTH, commands: ['cut']});
      const zero = new ReceiptPrinterRenderer({width: WIDTH, commands: ['cut'], cutterDistance: 0});

      assert.equal(JSON.stringify(zero.layout(bytes)), JSON.stringify(plain.layout(bytes)));
      assert.deepEqual(zero.render(bytes), plain.render(bytes));
    });

    it('should refuse a distance that is not a whole number of dots', function() {
      assert.throws(() => renderer(-10), /Cutter distance must be a whole number of dots/);
      assert.throws(() => renderer(12.5), /Cutter distance must be a whole number of dots/);
    });
  });

  describe('the display list of a receipt', function() {
    const bytes = fixture('esc-pos', 'receipt').bytes;
    const distance = 120;

    const plain = renderer(0).layout(bytes);
    const shifted = renderer(distance).layout(bytes);

    it('should begin with the blank paper of the distance', function() {
      assert.deepEqual(shifted.entries[0], {type: 'feed', y: 0, height: distance, source: null});
      assert.equal(shifted.height, plain.height + distance);
    });

    it('should move every printed entry down by the distance and leave every cut where it was', function() {
      const moved = shifted.entries.slice(1);

      assert.equal(moved.length, plain.entries.length);

      for (const [index, entry] of moved.entries()) {
        const before = plain.entries[index];

        assert.equal(entry.type, before.type);
        assert.equal(entry.y, before.y + (entry.type === 'cut' ? 0 : distance), `entry ${index}`);
        assert.deepEqual(entry.source, before.source);
      }

      assert.isTrue(plain.entries.some((entry) => entry.type === 'cut'), 'the fixture cuts');
    });
  });

  describe('a job that feeds before its cut', function() {
    /* Two lines of text, four empty lines, and the cut: the receipt every
       encoder writes, and the one the distance was added for */

    const bytes = stream([...INITIALIZE, 'ABC', LF, 'DEF', LF, LF, LF, LF, LF, ...CUT, 'XY', LF]);
    const distance = 4 * SPACING;

    it('should cut right behind the last text row', function() {
      const layout = renderer(distance).layout(bytes);

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0],
        ['line', 120], ['line', 150],
        ['feed', 180], ['feed', 210], ['feed', 240], ['feed', 270],
        ['cut', 180],
        ['line', 300],
      ]);
    });

    it('should start both pieces with the blank paper of the distance', function() {
      const layout = renderer(distance).layout(bytes);
      const split = papers(layout);

      assert.deepEqual(split.map((piece) => piece.height), [180, 150]);

      for (const [index, piece] of split.entries()) {
        for (let y = 0; y < distance; y++) {
          for (let x = 0; x < WIDTH; x++) {
            assert.equal(Bitmap.getPixel(piece, x, y), 0, `piece ${index + 1} is blank at row ${y}`);
          }
        }
      }

      /* And the text of the first piece is below that blank, where the text of
         the unshifted render stands at the top */

      const plain = paper(renderer(0).render(bytes));

      assert.isTrue(Buffer.from(rows(split[0], distance, 180).data).equals(Buffer.from(rows(plain, 0, 60).data)));
    });
  });

  describe('a job that feeds nothing before its cut', function() {
    /* Four lines and a cut, with a distance of two lines: the last two lines
       are still between the cutter and the print head, so they end up at the
       top of the next piece rather than at the bottom of this one */

    const bytes = stream([...INITIALIZE, 'A', LF, 'B', LF, 'C', LF, 'D', LF, ...CUT]);
    const distance = 2 * SPACING;

    it('should leave the last two lines at the top of the next piece', function() {
      const layout = renderer(distance).layout(bytes);

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0],
        ['line', 60], ['line', 90], ['line', 120], ['line', 150],
        ['cut', 120],
      ]);

      const split = pieces(layout);

      assert.deepEqual(split.map((piece) => piece.height), [120, 60]);
      assert.deepEqual(split[0].entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0], ['line', 60], ['line', 90],
      ]);
      assert.deepEqual(split[1].entries.map((entry) => [entry.type, entry.y]), [['line', 0], ['line', 30]]);

      /* C and D print at the top of the second piece, which is what the paper
         of the first two lines of the same job looks like */

      const plain = paper(renderer(0).render(stream([...INITIALIZE, 'C', LF, 'D', LF])));

      assert.isTrue(Buffer.from(papers(layout)[1].data).equals(Buffer.from(plain.data)));
    });
  });

  describe('a cut through a line', function() {
    /* A distance of half a line: the cut falls inside the second line, and the
       printer cuts through the ink */

    const bytes = stream([...INITIALIZE, 'ABC', LF, 'DEF', LF, ...CUT, 'XY', LF]);
    const distance = 15;

    it('should put the line on both pieces, at its row relative to each', function() {
      const layout = renderer(distance).layout(bytes);

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0], ['line', 15], ['line', 45], ['cut', 60], ['line', 75],
      ]);

      const split = pieces(layout);

      assert.deepEqual(split.map((piece) => piece.height), [60, 45]);
      assert.deepEqual(split[0].entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0], ['line', 15], ['line', 45],
      ]);
      assert.deepEqual(split[1].entries.map((entry) => [entry.type, entry.y]), [['line', -15], ['line', 15]]);
    });

    it('should draw the rows above the cut on the piece above and the rows below it on the piece below', function() {
      const layout = renderer(distance).layout(bytes);
      const split = papers(layout);

      assert.deepEqual(split.map((piece) => piece.height), [60, 45]);

      /* The pieces stacked are the paper of the job, and the paper of the job
         without the blank of the distance is the paper of the same job
         rendered without a distance: nothing of the ink is lost or doubled
         where the cut runs through the line */

      const whole = paper(renderer(distance).render(bytes));
      const plain = paper(renderer(0).render(bytes));

      assert.isTrue(Buffer.from(stack(split).data).equals(Buffer.from(whole.data)), 'the pieces stack up to the paper');
      assert.isTrue(
          Buffer.from(rows(whole, distance, whole.height).data).equals(Buffer.from(plain.data)),
          'the paper below the blank is the paper of the job',
      );
    });
  });

  describe('the item stream', function() {
    const bytes = stream([...INITIALIZE, 'ABC', LF, 'DEF', LF, LF, LF, LF, LF, ...CUT, 'XY', LF]);

    it('should hold the cut back over the rows that stay in the printer', function() {
      const items = renderer(120).render(bytes);

      assert.deepEqual(items.map((item) => [item.type, item.height || null]), [
        ['image', 180], ['cut', null], ['image', 150],
      ]);
    });

    it('should be what rasterizing the display list gives, as it is without a distance', function() {
      for (const distance of [0, 15, 60, 120]) {
        for (const options of [{}, {commands: ['cut', 'feed'], feedThreshold: 8}, {maxHeight: 100}]) {
          const settings = Object.assign({commands: ['cut']}, options);

          const items = renderer(distance, settings).render(bytes);
          const drawn = rasterize(renderer(distance, settings).layout(bytes), settings);

          assert.deepEqual(drawn, items, `a distance of ${distance} with ${JSON.stringify(options)}`);
        }
      }
    });
  });

  describe('a command the printer performs', function() {
    /* Five lines, the drawer, and the cut: the pulse stands at the print head,
       a hundred and twenty rows below the cut, and the rows between the two
       are the ones the cutter still holds. A flush at the pulse that took them
       would leave the cut nothing to hold back and put its item too low */

    const bytes = stream([...INITIALIZE, 'A', LF, 'B', LF, 'C', LF, 'D', LF, 'E', LF,
      0x1b, 0x70, 0x00, 0x32, 0x32, ...CUT]);
    const distance = 120;
    const options = {width: WIDTH, commands: ['cut', 'pulse'], cutterDistance: distance};

    it('should leave the rows of the cutter for the cut behind it', function() {
      const layout = new ReceiptPrinterRenderer(options).layout(bytes);

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0],
        ['line', 120], ['line', 150], ['line', 180], ['line', 210], ['line', 240],
        ['pulse', 270],
        ['cut', 150],
      ]);

      assert.deepEqual(pieces(layout).map((piece) => piece.height), [150, 120]);

      assert.deepEqual(new ReceiptPrinterRenderer(options).render(bytes).map((item) => [item.type, item.height]), [
        ['image', 150], ['pulse', undefined], ['cut', undefined], ['image', 120],
      ]);
    });

    it('should carry the distance in the list, and leave it off a piece', function() {
      const layout = new ReceiptPrinterRenderer(options).layout(bytes);

      assert.equal(layout.cutterDistance, distance);
      assert.isUndefined(new ReceiptPrinterRenderer({width: WIDTH}).layout(bytes).cutterDistance);

      for (const piece of pieces(layout)) {
        assert.notProperty(piece, 'cutterDistance', 'a piece has left the printer');
      }
    });

    it('should give the blank paper to a stream of nothing but a command', function() {
      const layout = new ReceiptPrinterRenderer(options).layout(stream([...INITIALIZE, ...CUT]));

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [['feed', 0], ['cut', 0]]);
      assert.equal(layout.height, distance);
    });
  });

  describe('a reverse feed behind a cut', function() {
    /* Three lines and a cut, then two lines back and an X. Without a distance
       the paper of the cut has left and the reverse feed is clamped at the cut,
       so the X prints behind it; with one, the rows between the cutter and the
       print head are still in the printer and the X prints over them, at the
       top of the next piece */

    const bytes = stream([...INITIALIZE, 'A', LF, 'B', LF, 'C', LF, ...CUT, 0x1b, 0x65, 2, 'X', LF]);

    it('should stay behind the cut without a distance', function() {
      const layout = renderer(0).layout(bytes);

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [
        ['line', 0], ['line', 30], ['line', 60], ['cut', 90], ['line', 90],
      ]);

      assert.deepEqual(pieces(layout).map((piece) => piece.height), [90, 30]);
    });

    it('should print back over the rows the cutter still holds', function() {
      const distance = 60;
      const layout = renderer(distance).layout(bytes);

      assert.deepEqual(layout.entries.map((entry) => [entry.type, entry.y]), [
        ['feed', 0], ['line', 60], ['line', 90], ['line', 120], ['cut', 90], ['line', 90],
      ]);

      /* The X is on the second line of the job, which is the first row of the
         piece behind the cut, and its dots are added to the ones that are
         already there */

      const split = pieces(layout);

      assert.deepEqual(split.map((piece) => piece.height), [90, 60]);
      assert.deepEqual(split[1].entries.map((entry) => [entry.type, entry.y]), [
        ['line', 0], ['line', 30], ['line', 0],
      ]);

      const drawn = papers(layout)[1];
      const alone = paper(renderer(0).render(stream([...INITIALIZE, 'B', LF])));
      const over = paper(renderer(0).render(stream([...INITIALIZE, 0x1b, 0x65, 1, 'X', LF])));

      let differing = 0;

      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const both = Bitmap.getPixel(alone, x, y) | Bitmap.getPixel(over, x, y);

          if (Bitmap.getPixel(drawn, x, y) !== both) {
            differing++;
          }
        }
      }

      assert.equal(differing, 0, 'the X is printed over the line that is still in the printer');
    });
  });

  describe('the paper of a render and the pieces of its list', function() {
    /* The invariant of a distance: the item stream is the paper in order, so
       the runs between its cuts are the pieces of the display list, whatever
       the printer performs and however far the cutter stands */

    for (const [language, mapping] of [['esc-pos', 'epson'], ['star-prnt', 'star']]) {
      for (const directory of [language, `${language}/raw`]) {
        it(`should agree for every fixture of ${directory}`, function() {
          for (const name of names(directory)) {
            const bytes = fixture(directory, name).bytes;

            for (const commands of SETS) {
              for (const cutterDistance of DISTANCES) {
                agrees(
                    bytes,
                    {language, width: WIDTH, codepageMapping: mapping, commands, cutterDistance},
                    `${directory}/${name} with ${commands.join(', ')} at ${cutterDistance}`,
                );
              }
            }
          }
        }).timeout(60 * 1000);
      }
    }

    it('should agree for three hundred random jobs', function() {
      const next = random(20260918);

      let cuts = 0;
      let pulses = 0;

      for (let index = 0; index < 300; index++) {
        const bytes = job(next);

        for (const commands of SETS) {
          for (const cutterDistance of DISTANCES) {
            agrees(
                bytes,
                {width: WIDTH, commands, cutterDistance},
                `job ${index} with ${commands.join(', ')} at ${cutterDistance}`,
            );
          }
        }

        const entries = new ReceiptPrinterRenderer({width: WIDTH, commands: SETS[3], cutterDistance: 120})
            .layout(bytes).entries;

        cuts += entries.filter((entry) => entry.type === 'cut').length;
        pulses += entries.filter((entry) => entry.type === 'pulse').length;
      }

      assert.isAbove(cuts, 100, 'the jobs cut');
      assert.isAbove(pulses, 100, 'the jobs open the drawer');
    }).timeout(120 * 1000);
  });

  describe('the SVG of a piece', function() {
    /* A raster image of 48 rows, cut in two by a distance of half of it: an
       image is drawn from the same dots by both back-ends, so the document of
       a piece and the bitmap of it are compared dot for dot. A line of text
       could not be, the writer draws the outlines of the face */

    const rowsOfImage = 48;
    const data = [];

    for (let row = 0; row < rowsOfImage; row++) {
      data.push(row % 2 ? 0x55 : 0xaa, 0xf0, 0x0f);
    }

    const bytes = stream([...INITIALIZE, 0x1d, 0x76, 0x30, 0x00, 3, 0, rowsOfImage, 0, ...data, ...CUT]);
    const distance = 24;

    it('should draw the rows of the piece and no others', async function() {
      if (!Resvg) {
        assert.fail(`@resvg/resvg-wasm did not load, so the vector output is not checked: ${unavailable}`);
      }

      const layout = renderer(distance).layout(bytes);
      const split = pieces(layout);

      assert.deepEqual(split.map((piece) => piece.height), [48, 24]);
      assert.equal(split[0].entries[1].y, distance, 'the image starts below the blank paper');
      assert.equal(split[1].entries[0].y, -distance, 'the image straddles the cut');

      for (const [index, piece] of split.entries()) {
        const document = toSvg(piece);

        assert.match(document, new RegExp(`viewBox="0 0 ${piece.width} ${piece.height}"`));

        const png = new Resvg(document, {fitTo: {mode: 'original'}}).render().asPng();
        const drawn = await fromPng(new Uint8Array(png));
        const expected = paper(rasterize(piece, {commands: ['cut']}));

        assert.equal(drawn.height, piece.height, `piece ${index + 1}`);

        for (let y = 0; y < piece.height; y++) {
          for (let x = 0; x < WIDTH; x++) {
            assert.equal(
                Bitmap.getPixel(drawn, x, y),
                y < expected.height ? Bitmap.getPixel(expected, x, y) : 0,
                `piece ${index + 1} differs at ${x}, ${y}`,
            );
          }
        }
      }
    }).timeout(60 * 1000);
  });
});
