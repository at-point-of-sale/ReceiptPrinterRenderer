import StarGraphicsPrinterEncoder from '@point-of-sale/star-graphics-printer-encoder';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import Bitmap from '../src/bitmap.js';
import {stitch} from '../src/formats/stitch.js';
import {commands} from './helpers/items.js';
import {fixture} from './helpers/fixtures.js';
import {diff} from './helpers/ascii.js';
import {assert} from 'chai';

/*
    The round trip of the Star raster mode.

    A driver for a TSP100 renders a receipt with this renderer and turns the
    items into a raster mode job with StarGraphicsPrinterEncoder. That job is a
    stream this renderer reads as well, so rendering it again has to give back
    the paper and the commands it was made from. It is the end to end check of
    the raster mode parser of section 12, against an implementation of the wire
    format that was written from the specification and not from this parser.

    StarGraphicsPrinterEncoder is not published yet, so it resolves through
    `npm link @point-of-sale/star-graphics-printer-encoder`, see the notes of
    section 12 in the implementation plan.
*/

const WIDTH = 576;
const COMMANDS = ['cut', 'pulse', 'feed'];

const OPTIONS = {width: WIDTH, commands: COMMANDS};

/**
 * The dots of a bitmap, as a string, so that two renders can be compared
 *
 * @param  {object}   bitmap   The bitmap
 * @return {string}            The dots
 */
function dots(bitmap) {
  return `${bitmap.width}x${bitmap.height}:${Array.from(bitmap.data).join(',')}`;
}

describe('Star raster round trip', function() {
  for (const name of ['receipt', 'pulse', 'image-column', 'table', 'text']) {
    describe(name, function() {
      it('should render the raster job back to the paper it was made from', function() {
        const original = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);
        const job = new StarGraphicsPrinterEncoder().encode(original);
        const again = new StarPrntRenderer(OPTIONS).render(job);

        const paper = {
          original: stitch(original, {width: WIDTH}),
          again: stitch(again, {width: WIDTH}),
        };

        if (dots(paper.again) !== dots(paper.original)) {
          assert.fail(
              `the raster job of ${name} renders to other paper\n` +
            diff(paper.again, paper.original),
          );
        }
      });

      it('should emit the cut and pulse items of the receipt again', function() {
        const original = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);
        const job = new StarGraphicsPrinterEncoder().encode(original);
        const again = new StarPrntRenderer(OPTIONS).render(job);

        assert.deepEqual(commands(again), commands(original));
      });
    });
  }

  /*
      A job that ends with a feed and nothing behind it is the one case where
      the paper is not exactly the same: the printer ignores an execute command
      on an empty image buffer, so the encoder gives that last segment one
      blank row to print, and the renderer reads that row back. The receipt is
      one dot longer for it, and the cut and the pulse items are unchanged.
  */

  for (const name of ['cut', 'feed']) {
    it(`should render the job of ${name}, which ends with a feed, one blank row longer`, function() {
      const original = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', name).bytes);
      const job = new StarGraphicsPrinterEncoder().encode(original);
      const again = new StarPrntRenderer(OPTIONS).render(job);

      const paper = {
        original: stitch(original, {width: WIDTH}),
        again: stitch(again, {width: WIDTH}),
      };

      assert.equal(paper.again.height, paper.original.height + 1);
      assert.equal(
          dots(Bitmap.extractRows(paper.again, 0, paper.original.height)),
          dots(paper.original),
      );

      const shape = (item) => item.type === 'feed' ? {type: item.type} : item;

      assert.deepEqual(commands(again).map(shape), commands(original).map(shape));
    });
  }

  it('should read the tear bar mode of a printer without a cutter as a partial cut', function() {
    const original = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', 'cut').bytes);
    const job = new StarGraphicsPrinterEncoder({tearBar: true}).encode(original);
    const again = new StarPrntRenderer(OPTIONS).render(job);

    assert.deepEqual(
        commands(again).filter((item) => item.type === 'cut'),
        commands(original).filter((item) => item.type === 'cut').map(() => ({type: 'cut', value: 'partial'})),
    );
  });

  it('should render the job of one image on its own', function() {
    const original = new StarPrntRenderer(OPTIONS).render(fixture('star-prnt', 'text').bytes);
    const image = original.find((item) => item.type === 'image');

    const job = new StarGraphicsPrinterEncoder().encodeImage(image);
    const again = new StarPrntRenderer(OPTIONS).render(job);

    assert.equal(dots(stitch(again, {width: WIDTH})), dots(stitch([image], {width: WIDTH})));
  });
});
