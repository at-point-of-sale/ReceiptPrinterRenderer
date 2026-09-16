import ReceiptPrinterRenderer, {pieces, rasterize} from '../src/receipt-printer-renderer.js';
import {stitch} from '../src/formats/stitch.js';
import {toSvg} from '../src/svg.js';
import {libraries, fixtures, external, options} from './helpers/external.js';
import {assert} from 'chai';

/*
    The pieces of paper of a display list, src/pieces.js.

    A hand built list proves the rules: where a piece starts and ends, what is
    on it, what a cut at an edge or a doubled cut does, and that the list is
    left as it was. The external fixtures prove the point of it: a piece
    rasterized is the same paper as the items of a render between the same two
    cuts, stitched, which is how the contact sheet has always shown a cut
    receipt, and the SVG of a piece is a document of the piece's height.
*/

/* The printer of the hand built lists */

const WIDTH = 576;

/**
 * A line entry of a hand built list, one glyph on it
 *
 * @param  {number}   y        Row of the paper
 * @param  {number}   height   Height of the line
 * @return {object}            The entry
 */
function line(y, height = 30) {
  return {
    type: 'line', y, height, rotation: 0,
    operations: [{
      type: 'text', codepoint: 0x41, font: 'A', cell: '12x24',
      x: 0, y: 0, width: 12, height: 24, spacing: 0,
      scale: {x: 1, y: 1},
      style: {bold: false, underline: 0, upperline: false, invert: false, upsidedown: false, rotate: false},
    }],
  };
}

/**
 * A hand built list of the given entries
 *
 * @param  {object[]}   entries   The entries
 * @param  {number}     height    Height of the paper
 * @return {object}               The list
 */
function list(entries, height) {
  return {version: 1, language: 'esc-pos', width: WIDTH, height, dpi: 203, entries};
}

/**
 * The items of a render between its cuts, stitched into one paper per run,
 * the runs that have any rows: what the contact sheet shows of a cut receipt
 *
 * @param  {object[]}   items   The items of a render
 * @param  {number}     width   Width of the paper
 * @return {object[]}           The papers
 */
function papers(items, width) {
  const runs = [[]];

  for (const item of items) {
    if (item.type === 'cut') {
      runs.push([]);
    } else {
      runs[runs.length - 1].push(item);
    }
  }

  return runs.map((run) => stitch(run, {width})).filter((paper) => paper.height > 0);
}

describe('pieces', function() {
  describe('the contract', function() {
    it('should be a static of the renderer as well as a named export', function() {
      assert.equal(ReceiptPrinterRenderer.pieces, pieces);
    });

    it('should throw without a list', function() {
      assert.throws(() => pieces(), /display list is required/);
      assert.throws(() => pieces(null), /display list is required/);
    });

    it('should give one piece for a list without a cut, as a copy', function() {
      const layout = list([line(0), line(30)], 60);
      const result = pieces(layout);

      assert.equal(result.length, 1);
      assert.deepEqual(result[0], layout);
      assert.notStrictEqual(result[0], layout);
      assert.notStrictEqual(result[0].entries, layout.entries);
      assert.notStrictEqual(result[0].entries[0], layout.entries[0]);
      assert.strictEqual(result[0].entries[0].operations, layout.entries[0].operations);
    });

    it('should give no piece for a list of no height', function() {
      assert.deepEqual(pieces(list([], 0)), []);
      assert.deepEqual(pieces(list([{type: 'cut', y: 0, value: 'full'}], 0)), []);
    });
  });

  describe('a cut', function() {
    it('should end one piece and start the next on the row it stands on', function() {
      const layout = list([line(0), line(30), {type: 'cut', y: 60, value: 'full'}, line(60), line(90)], 120);
      const result = pieces(layout);

      assert.equal(result.length, 2);

      assert.equal(result[0].height, 60);
      assert.deepEqual(result[0].entries.map((entry) => [entry.type, entry.y]), [['line', 0], ['line', 30]]);

      assert.equal(result[1].height, 60);
      assert.deepEqual(result[1].entries.map((entry) => [entry.type, entry.y]), [['line', 0], ['line', 30]]);

      for (const piece of result) {
        assert.equal(piece.version, 1);
        assert.equal(piece.language, 'esc-pos');
        assert.equal(piece.width, WIDTH);
        assert.equal(piece.dpi, 203);
        assert.isFalse(piece.entries.some((entry) => entry.type === 'cut'));
      }
    });

    it('should leave no piece at the top, at the bottom or between two cuts on one row', function() {
      const layout = list([
        {type: 'cut', y: 0, value: 'full'},
        line(0),
        {type: 'cut', y: 30, value: 'partial'},
        {type: 'cut', y: 30, value: 'full'},
        line(30),
        {type: 'cut', y: 60, value: 'full'},
      ], 60);

      const result = pieces(layout);

      assert.equal(result.length, 2);
      assert.deepEqual(result.map((piece) => piece.height), [30, 30]);
      assert.deepEqual(result.map((piece) => piece.entries.length), [1, 1]);
    });

    it('should keep a feed, a pulse and an unknown command on their piece', function() {
      const layout = list([
        line(0),
        {type: 'feed', y: 30, height: 60},
        {type: 'cut', y: 90, value: 'full'},
        {type: 'pulse', y: 90, value: 0},
        {type: 'unknown', y: 90, value: 'GS ( k'},
        line(90),
      ], 120);

      const result = pieces(layout);

      assert.deepEqual(result.map((piece) => piece.entries.map((entry) => [entry.type, entry.y])), [
        [['line', 0], ['feed', 30]],
        [['pulse', 0], ['unknown', 0], ['line', 0]],
      ]);
    });

    it('should give a blank piece for paper with nothing on it', function() {
      const layout = list([
        line(0),
        {type: 'cut', y: 30, value: 'full'},
        {type: 'cut', y: 90, value: 'full'},
        line(90),
      ], 120);

      const result = pieces(layout);

      assert.deepEqual(result.map((piece) => [piece.height, piece.entries.length]), [[30, 1], [60, 0], [30, 1]]);
    });

    it('should clamp a cut outside the paper to the paper', function() {
      const layout = list([line(0), {type: 'cut', y: -10, value: 'full'}, {type: 'cut', y: 500, value: 'full'}], 30);

      assert.deepEqual(pieces(layout).map((piece) => piece.height), [30]);
    });

    it('should leave the list as it was', function() {
      const layout = list([line(0), {type: 'cut', y: 30, value: 'full'}, line(30)], 60);
      const before = JSON.stringify(layout);

      pieces(layout);

      assert.equal(JSON.stringify(layout), before);
    });
  });

  describe('every external fixture with a cut', function() {
    for (const library of libraries()) {
      for (const name of fixtures(library)) {
        const fixture = external(library, name);
        const settings = options(fixture.provenance);
        const layout = new ReceiptPrinterRenderer(settings).layout(fixture.bytes);

        if (!layout.entries.some((entry) => entry.type === 'cut')) {
          continue;
        }

        describe(`${library}/${name}`, function() {
          const result = pieces(layout);

          it('should cover the whole paper', function() {
            assert.equal(result.reduce((total, piece) => total + piece.height, 0), layout.height);
          });

          it('should rasterize to the papers of the items of a render between the same cuts', function() {
            const expected = papers(new ReceiptPrinterRenderer(settings).render(fixture.bytes), layout.width);
            const drawn = result.map((piece) => stitch(rasterize(piece, {commands: settings.commands}), {
              width: layout.width,
            }));

            assert.deepEqual(drawn.map((paper) => [paper.width, paper.height]),
                expected.map((paper) => [paper.width, paper.height]));

            for (const [index, paper] of drawn.entries()) {
              assert.isTrue(
                  Buffer.from(paper.data).equals(Buffer.from(expected[index].data)),
                  `piece ${index + 1} of ${drawn.length} differs from the items of the render`,
              );
            }
          });

          it('should write one SVG document per piece, of the height of the piece', function() {
            for (const piece of result) {
              const document = toSvg(piece);

              assert.match(document, new RegExp(`viewBox="0 0 ${piece.width} ${piece.height}"`));
              assert.notInclude(document, 'stroke-dasharray');
            }
          });
        });
      }
    }
  });
});
