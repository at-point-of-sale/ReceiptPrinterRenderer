import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

import {assert} from 'chai';

import {EscPosRenderer, StarPrntRenderer, rasterize} from '../src/receipt-printer-renderer.js';
import {stitch} from '../src/formats/stitch.js';
import toSvgDefault, {toSvg} from '../src/svg.js';
import {toStoredPng, stored, adler32} from '../src/svg/png.js';
import {scanlines} from '../src/formats/png.js';
import Bitmap from '../src/bitmap.js';
import outlines from '../data/fonts/outlines.js';
import {names, fromPbm} from './helpers/fixtures.js';
import {dotAgreement, fromPng} from '../tools/contact-sheet/references/shared.js';

/*
    The SVG writer, see documentation/svg-plan.md, section 4.

    Three kinds of check. The golden files next to the fixtures freeze what the
    writer makes of a list, the way the PBM files freeze the dots. The
    structural tests read the document back with a parser written below and
    check the elements of a cell, a line and a page one by one, against the
    numbers of the display list contract. And the rasterized check renders every
    fixture with resvg, which is a dev dependency of the tests alone, and
    compares it with the paper of the same fixture: the rectangles and the
    images dot for dot, the whole paper with the measure of the contact sheet.
*/

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/* The wasm build of resvg, a dev dependency of this file alone. It is loaded
   here rather than in a hook, so that the tests that need it are defined only
   when it is there and a machine without it runs the rest of the file */

const WASM = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm',
);

let Resvg = null;
let unavailable = '';

try {
  const module = await import('@resvg/resvg-wasm');

  await module.initWasm(fs.readFileSync(WASM));

  Resvg = module.Resvg;
} catch (error) {
  unavailable = error.message;
}

/* The printer the fixtures were made for, see test/tools/make-fixtures.js */

const WIDTH = 576;

/* The golden files, the fixtures of GOLDEN_SVG in test/tools/make-fixtures.js */

const GOLDEN = [
  'esc-pos/receipt',
  'esc-pos/styles',
  'esc-pos/sizes',
  'esc-pos/fonts',
  'esc-pos/box',
  'esc-pos/hri',
  'esc-pos/code128',
  'esc-pos/qrcode',
  'esc-pos/pdf417',
  'esc-pos/image-raster',
  'esc-pos/cut',
  'star-prnt/receipt',
  'esc-pos/raw/rotation',
  'esc-pos/raw/user-defined',
  'star-prnt/raw/page-mode-directions',
  'star-prnt/raw/star-graphics',
];

/* How far the vector output and the dots of a fixture may differ, over the
   whole paper. An outline filled by a rasterizer and a bitmap filled with the
   0.45 coverage rule the font was rasterized with disagree at the edges of a
   stroke, and nowhere else, see the notes of section 3. The bound was 0.98
   while the bitmaps were the face rasterized; the built in font is tweaked by
   hand on the dot grid now and drifts from the curves of the face on purpose,
   which the Decisions list of the plan asks for, so the edges of a stroke are
   a dot further apart and the bound is 0.96, see the notes of section 4 */

const AGREEMENT = 0.96;

/**
 * The display list of a fixture
 *
 * @param  {string}   key   Directory and name of the fixture
 * @return {object}         The list
 */
function layoutOf(key) {
  const language = key.startsWith('esc-pos') ? 'esc-pos' : 'star-prnt';
  const Renderer = language === 'esc-pos' ? EscPosRenderer : StarPrntRenderer;

  const renderer = new Renderer({
    width: WIDTH,
    codepageMapping: language === 'esc-pos' ? 'epson' : 'star',
    commands: ['cut', 'pulse', 'feed'],
  });

  return renderer.layout(new Uint8Array(fs.readFileSync(path.join(root, `${key}.bin`))));
}

/**
 * The paper of a fixture
 *
 * @param  {string}   key   Directory and name of the fixture
 * @return {object}         The bitmap
 */
function paperOf(key) {
  return fromPbm(new Uint8Array(fs.readFileSync(path.join(root, `${key}.pbm`))));
}

/**
 * A list of one line of operations, with the fields of the contract
 *
 * @param  {object[]}   operations   The operations of the line
 * @param  {object}     [entry]      What to change about the line
 * @param  {object}     [extra]      What to change about the list
 * @return {object}                  The list
 */
function list(operations, entry, extra) {
  return Object.assign({
    version: 1,
    language: 'esc-pos',
    width: 576,
    height: 60,
    dpi: 203,
    entries: [Object.assign({type: 'line', y: 0, height: 30, rotation: 0, operations}, entry)],
  }, extra);
}

/**
 * One text operation, with the fields of a cell of font A
 *
 * @param  {object}   [fields]   What to change about it
 * @return {object}              The operation
 */
function cell(fields) {
  return Object.assign({
    type: 'text',
    x: 0,
    y: 0,
    width: 12,
    height: 24,
    codepoint: 0x41,
    font: 'A',
    cell: {width: 12, height: 24},
    glyph: {width: 12, height: 24},
    baseline: 18,
    scale: {x: 1, y: 1},
    style: {bold: false, underline: 0, upperline: 0, invert: false},
    rotation: 0,
    spacing: 0,
  }, fields);
}

/*
    A small XML parser, so that the tests read the document as a tree and not as
    text. It is not a general one: it knows elements, attributes with quoted
    values and nothing else, which is everything the writer produces, and it
    throws on anything it does not know, which is what makes it a check that the
    document is well formed.
*/

const NAME = '[A-Za-z_:][-A-Za-z0-9_:.]*';

/**
 * The attributes of a tag, and a check that the tag holds nothing else
 *
 * @param  {string}   tag    The inside of the tag, without its name
 * @param  {string}   whole  The whole tag, for the message of an error
 * @return {object}          The attributes
 */
function attributes(tag, whole) {
  const pattern = new RegExp(`\\s+(${NAME})\\s*=\\s*"([^"]*)"`, 'g');
  const result = {};

  let index = 0;
  let match;

  while ((match = pattern.exec(tag)) !== null) {
    if (match.index !== index) {
      throw new Error(`Not an attribute in <${whole}>: ${tag.slice(index, match.index)}`);
    }

    if (Object.prototype.hasOwnProperty.call(result, match[1])) {
      throw new Error(`Attribute ${match[1]} twice in <${whole}>`);
    }

    if (/[<&]/.test(match[2].replace(/&(amp|lt|gt|quot|#39);/g, ''))) {
      throw new Error(`Unescaped character in the value of ${match[1]} in <${whole}>`);
    }

    result[match[1]] = match[2];
    index = pattern.lastIndex;
  }

  if (tag.slice(index).trim() !== '') {
    throw new Error(`Not an attribute in <${whole}>: ${tag.slice(index)}`);
  }

  return result;
}

/**
 * Parse an XML document into a tree of elements, and throw when it is not well
 * formed
 *
 * @param  {string}   source   The document
 * @return {object}            The root element
 */
function parse(source) {
  const document = {name: '#document', attributes: {}, children: []};
  const stack = [document];

  let index = 0;

  while (index < source.length) {
    const open = source.indexOf('<', index);

    if (open < 0) {
      if (source.slice(index).trim() !== '') {
        throw new Error(`Text outside an element: ${source.slice(index).trim().slice(0, 40)}`);
      }

      break;
    }

    if (source.slice(index, open).trim() !== '') {
      throw new Error(`Text in ${stack[stack.length - 1].name}: ${source.slice(index, open).trim()}`);
    }

    /* The end of the tag, which a quoted attribute value may hold a > of */

    let end = open + 1;
    let quoted = false;

    while (end < source.length && (quoted || source[end] !== '>')) {
      if (source[end] === '"') {
        quoted = !quoted;
      }

      end++;
    }

    if (end >= source.length) {
      throw new Error(`Unterminated tag: ${source.slice(open, open + 40)}`);
    }

    const whole = source.slice(open + 1, end);

    if (whole.startsWith('/')) {
      const name = whole.slice(1).trim();
      const element = stack.pop();

      if (stack.length === 0 || element.name !== name) {
        throw new Error(`Closing tag ${name} does not match ${element.name}`);
      }
    } else {
      const empty = whole.endsWith('/');
      const body = empty ? whole.slice(0, -1) : whole;
      const match = new RegExp(`^(${NAME})`).exec(body);

      if (!match) {
        throw new Error(`Not an element name: <${whole.slice(0, 40)}>`);
      }

      const element = {
        name: match[1],
        attributes: attributes(body.slice(match[1].length), whole),
        children: [],
      };

      stack[stack.length - 1].children.push(element);

      if (!empty) {
        stack.push(element);
      }
    }

    index = end + 1;
  }

  if (stack.length !== 1) {
    throw new Error(`Element ${stack[stack.length - 1].name} was not closed`);
  }

  if (document.children.length !== 1) {
    throw new Error(`A document has one root element, this one has ${document.children.length}`);
  }

  return document.children[0];
}

/**
 * Every element of a tree with a name, in document order
 *
 * @param  {object}   element   The element to walk
 * @param  {string}   [name]    The name to look for, every element when it is left out
 * @return {object[]}           The elements
 */
function all(element, name) {
  const result = [];

  const walk = (node) => {
    if (!name || node.name === name) {
      result.push(node);
    }

    for (const child of node.children) {
      walk(child);
    }
  };

  walk(element);

  return result;
}

/**
 * The children of the root that are not the definitions or the background,
 * which is the body of the document
 *
 * @param  {object}   svg   The root element
 * @return {object[]}       The elements of the body
 */
function body(svg) {
  return svg.children.filter((child) => child.name !== 'defs' && child.name !== 'rect');
}

/**
 * The definition of an id
 *
 * @param  {object}   svg   The root element
 * @param  {string}   id    The id, with or without its hash
 * @return {object}         The element
 */
function definition(svg, id) {
  const name = id.replace(/^(url\(#|#)/, '').replace(/\)$/, '');

  return all(svg).find((element) => element.attributes.id === name);
}

/*
    Transforms, so that a test reads what an element does to a point rather than
    the text of its transform attribute. Only the three functions the writer
    writes are known, and the matrices multiply the way SVG composes them, left
    to right.
*/

/**
 * The matrix of a transform attribute, as [a, b, c, d, e, f]
 *
 * @param  {string}   value   The attribute
 * @return {number[]}         The matrix
 */
function matrix(value) {
  const pattern = /(translate|rotate|scale)\(([^)]*)\)/g;

  let result = [1, 0, 0, 1, 0, 0];
  let index = 0;
  let match;

  const multiply = (one, two) => [
    one[0] * two[0] + one[2] * two[1],
    one[1] * two[0] + one[3] * two[1],
    one[0] * two[2] + one[2] * two[3],
    one[1] * two[2] + one[3] * two[3],
    one[0] * two[4] + one[2] * two[5] + one[4],
    one[1] * two[4] + one[3] * two[5] + one[5],
  ];

  while ((match = pattern.exec(value)) !== null) {
    if (value.slice(index, match.index).trim() !== '') {
      throw new Error(`Not a transform: ${value}`);
    }

    const numbers = match[2].trim().split(/[\s,]+/).map(Number);

    if (numbers.some((number) => !Number.isFinite(number))) {
      throw new Error(`Not a number in ${match[0]}`);
    }

    if (match[1] === 'translate') {
      result = multiply(result, [1, 0, 0, 1, numbers[0], numbers[1] || 0]);
    } else if (match[1] === 'scale') {
      result = multiply(result, [numbers[0], 0, 0, numbers.length > 1 ? numbers[1] : numbers[0], 0, 0]);
    } else {
      const radians = (numbers[0] * Math.PI) / 180;
      const sin = Math.sin(radians);
      const cos = Math.cos(radians);

      result = multiply(result, [cos, sin, -sin, cos, 0, 0]);
    }

    index = pattern.lastIndex;
  }

  if (value.slice(index).trim() !== '') {
    throw new Error(`Not a transform: ${value}`);
  }

  return result;
}

/**
 * A point under a transform
 *
 * @param  {string}     value   The transform attribute
 * @param  {number[]}   point   The point
 * @return {number[]}           The point it lands on, rounded to a thousandth
 */
function apply(value, point) {
  const m = matrix(value);

  return [
    Math.round((m[0] * point[0] + m[2] * point[1] + m[4]) * 1000) / 1000,
    Math.round((m[1] * point[0] + m[3] * point[1] + m[5]) * 1000) / 1000,
  ];
}

/**
 * The rectangle a clip path clips to, read back from its path data
 *
 * @param  {object}   element   The clipPath element
 * @return {object}             The rectangle
 */
function clipBox(element) {
  const data = element.children[0].attributes.d;
  const match = /^M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)h(-?[\d.]+)Z$/.exec(data);

  if (!match) {
    throw new Error(`Not a rectangle: ${data}`);
  }

  return {x: +match[1], y: +match[2], width: +match[3], height: +match[4]};
}

describe('toSvg()', function() {
  describe('the contract', function() {
    it('is the default export as well as a named one', function() {
      assert.equal(toSvgDefault, toSvg);
    });

    it('throws without a list', function() {
      assert.throws(() => toSvg(null), /A display list is required/);
    });

    it('throws on a version it does not know', function() {
      assert.throws(() => toSvg(list([], {}, {version: 2})), /version 2 is not supported/);
      assert.throws(() => toSvg(list([], {}, {version: 0})), /version 0 is not supported/);
    });

    it('throws on units it does not know', function() {
      assert.throws(() => toSvg(list([]), {units: 'inch'}), /Unknown units inch/);
    });
  });

  describe('the document', function() {
    it('is an svg element of the paper in dots', function() {
      const svg = parse(toSvg(list([])));

      assert.equal(svg.name, 'svg');
      assert.equal(svg.attributes.xmlns, 'http://www.w3.org/2000/svg');
      assert.equal(svg.attributes.width, '576');
      assert.equal(svg.attributes.height, '60');
      assert.equal(svg.attributes.viewBox, '0 0 576 60');
      assert.equal(svg.attributes.fill, '#000');
    });

    it('writes the width and the height in the units the caller asked for', function() {
      const cases = [
        ['dots', '576', '60'],
        ['mm', '72.07pmm', '7.507pmm'],
        ['pt', '204.39pt', '21.29pt'],
        ['px', '272.52px', '28.39px'],
      ];

      for (const [units, ,] of cases) {
        const svg = parse(toSvg(list([]), {units}));

        if (units === 'dots') {
          assert.equal(svg.attributes.width, '576');
          assert.equal(svg.attributes.height, '60');
          continue;
        }

        const factor = {mm: 25.4, pt: 72, px: 96}[units] / 203;

        assert.equal(svg.attributes.width, `${Math.round(576 * factor * 1e6) / 1e6}${units}`);
        assert.equal(svg.attributes.height, `${Math.round(60 * factor * 1e6) / 1e6}${units}`);
        assert.equal(svg.attributes.viewBox, '0 0 576 60', 'the viewBox stays dots');
      }
    });

    it('takes the resolution of the list', function() {
      const svg = parse(toSvg(list([], {}, {dpi: 180}), {units: 'mm'}));

      assert.equal(svg.attributes.width, `${Math.round((576 * 25.4 / 180) * 1e6) / 1e6}mm`);
    });

    it('is a document of one blank row for a list of no height', function() {
      const empty = parse(toSvg(list([], {}, {height: 0, entries: []})));

      assert.equal(empty.attributes.height, '1');
      assert.equal(empty.attributes.viewBox, '0 0 576 1');
      assert.equal(empty.children[0].name, 'rect');
      assert.equal(empty.children[0].attributes.height, '1');
      assert.equal(body(empty).length, 0);

      /* A document of no height is refused by a rasterizer and drawn as
         nothing by a browser, so it is the one place the document is not the
         paper of the list */

      if (Resvg) {
        const png = new Resvg(toSvg(list([], {}, {height: 0, entries: []})), {fitTo: {mode: 'original'}})
            .render().asPng();

        assert.isAtLeast(png.length, 8);
      }

      const millimetres = parse(toSvg(list([], {}, {height: 0, entries: []}), {units: 'mm'}));

      assert.equal(Number(millimetres.attributes.height.replace('mm', '')),
          Math.round((25.4 / 203) * 1e6) / 1e6, 'one row in millimetres');
    });

    it('paints the paper, unless the paper is transparent', function() {
      const painted = parse(toSvg(list([]))).children[0];

      assert.equal(painted.name, 'rect');
      assert.equal(painted.attributes.width, '576');
      assert.equal(painted.attributes.height, '60');
      assert.equal(painted.attributes.fill, '#fff');

      const coloured = parse(toSvg(list([]), {background: '#eee', ink: '#333'}));

      assert.equal(coloured.children[0].attributes.fill, '#eee');
      assert.equal(coloured.attributes.fill, '#333');

      const transparent = parse(toSvg(list([]), {background: null}));

      assert.equal(transparent.children[0].name, 'defs', 'no background rectangle at all');
    });

    it('holds one definition per distinct glyph', function() {
      const svg = parse(toSvg(list([
        cell({x: 0, codepoint: 0x41}),
        cell({x: 12, codepoint: 0x42}),
        cell({x: 24, codepoint: 0x41}),
        cell({x: 36, codepoint: 0x41, scale: {x: 2, y: 2}, width: 24, height: 48}),
      ])));

      const paths = all(svg.children.find((child) => child.name === 'defs'), 'path')
          .filter((element) => element.attributes.id);

      assert.deepEqual(paths.map((element) => element.attributes.id), ['a41', 'a42']);
      assert.equal(paths[0].attributes.transform, 'scale(.1)', 'the outlines are in tenths of a dot');
      assert.equal(paths[0].attributes.d, outlines.glyphs[0x41]);
      assert.equal(all(svg, 'use').length, 4);
    });

    it('builds its ids out of letters, digits, dashes and underscores', function() {
      /* Every field of a list that reaches an id: the font of a cell, which
         names a glyph box and a packed font, and the size of its cell */

      const hostile = list([
        cell({font: '"><script>alert(1)</script>'}),
        cell({x: 12, font: '"><x', codepoint: 0x2500}),
        cell({x: 24, codepoint: 0x2502, cell: {width: 10, height: 20}}),
        cell({x: 36, cell: {width: '12"><x', height: 24}}),
        cell({x: 48, codepoint: '"><x'}),
      ]);

      const svg = toSvg(hostile);

      assert.notInclude(svg, '<script');
      assert.notInclude(svg, 'alert(1)');

      const document = parse(svg);

      for (const element of all(document)) {
        if (element.attributes.id) {
          assert.match(element.attributes.id, /^[A-Za-z0-9_-]+$/, `the id ${element.attributes.id}`);
        }
      }

      /* A font that is not B is font A, so the first two cells are the glyph
         and the box glyph of font A, and a code point that is not a number is
         the fallback */

      const hrefs = all(document, 'use').map((element) => element.attributes.href);

      assert.deepEqual(hrefs.slice(0, 2), ['#a41', '#x2500-12x24']);
      assert.equal(hrefs[hrefs.length - 1], `#a${outlines.fallback.toString(16)}`);
    });

    it('escapes what a caller writes into it', function() {
      const svg = toSvg(list([]), {ink: '"><script>', background: '&'});

      assert.include(svg, 'fill="&quot;&gt;&lt;script&gt;"');
      assert.include(svg, 'fill="&amp;"');

      assert.equal(parse(svg).attributes.fill, '&quot;&gt;&lt;script&gt;');
    });
  });

  describe('a line', function() {
    it('is a group at the row of the paper it stands on, clipped to the paper', function() {
      const svg = parse(toSvg(list([cell()], {y: 210})));
      const group = body(svg)[0];

      assert.equal(group.name, 'g');
      assert.deepEqual(apply(group.attributes.transform, [0, 0]), [0, 210]);
      assert.deepEqual(apply(group.attributes.transform, [12, 24]), [12, 234]);

      const clip = definition(svg, group.attributes['clip-path']);

      assert.deepEqual(clipBox(clip), {x: 0, y: 0, width: 576, height: 60});
    });

    it('turns the whole of it by 180 degrees when the line does', function() {
      const svg = parse(toSvg(list([cell()], {y: 100, height: 30, rotation: 180})));
      const group = body(svg)[0];

      /* The top left corner of the line lands on the bottom right corner of the
         box it occupies on the paper, which is what rotate180() does to the
         bitmap of a line */

      assert.deepEqual(apply(group.attributes.transform, [0, 0]), [576, 130]);
      assert.deepEqual(apply(group.attributes.transform, [576, 30]), [0, 100]);
    });

    it('writes nothing for a line without operations', function() {
      assert.equal(body(parse(toSvg(list([], {y: 10})))).length, 0);
    });

    it('collects the rectangles that stand next to each other into one path', function() {
      const svg = parse(toSvg(list([
        {type: 'rect', x: 0, y: 0, width: 3, height: 60},
        {type: 'rect', x: 6, y: 0, width: 6, height: 60},
        cell({x: 20}),
        {type: 'rect', x: 40, y: 0, width: 3, height: 60},
      ])));

      const group = body(svg)[0];
      const paths = group.children.filter((child) => child.name === 'path');

      assert.equal(paths.length, 2, 'one path per run of rectangles');
      assert.equal(paths[0].attributes.d, 'M0 0h3v60h-3ZM6 0h6v60h-6Z');
      assert.equal(paths[0].attributes['shape-rendering'], 'crispEdges');
      assert.equal(paths[1].attributes.d, 'M40 0h3v60h-3Z');

      assert.deepEqual(
          group.children.map((child) => child.name),
          ['path', 'use', 'path'],
          'and the order of the list is kept',
      );
    });
  });

  describe('a cell', function() {
    it('is a use of the glyph at the position of the cell', function() {
      const svg = parse(toSvg(list([cell({x: 24, y: 3})])));
      const use = all(svg, 'use')[0];

      assert.equal(use.attributes.href, '#a41');
      assert.deepEqual(apply(use.attributes.transform || '', [0, 0]), [24, 3]);
    });

    it('scales the glyph by the multipliers of the cell', function() {
      const svg = parse(toSvg(list([cell({x: 12, scale: {x: 2, y: 3}, width: 24, height: 72})])));
      const use = all(svg, 'use')[0];

      assert.deepEqual(apply(use.attributes.transform, [0, 0]), [12, 0]);
      assert.deepEqual(apply(use.attributes.transform, [12, 24]), [12 + 24, 72]);
    });

    it('clips every glyph to its cell, whatever the size of the cell', function() {
      const svg = parse(toSvg(list([
        cell({x: 0}),
        cell({x: 12, scale: {x: 4, y: 4}, width: 48, height: 96}),
      ])));

      const uses = all(svg, 'use');

      assert.equal(uses[0].attributes['clip-path'], uses[1].attributes['clip-path'],
          'one clip path serves every size a cell is drawn at');

      const clip = definition(svg, uses[0].attributes['clip-path']);

      assert.deepEqual(clipBox(clip), {x: 0, y: 0, width: 12, height: 24});

      /* And the clip is the cell on the paper: the corners of the clip, under
         the transform of the element, are the corners of the scaled cell */

      assert.deepEqual(apply(uses[1].attributes.transform, [0, 0]), [12, 0]);
      assert.deepEqual(apply(uses[1].attributes.transform, [12, 24]), [12 + 48, 96]);
    });

    it('draws nothing for a glyph whose outline is empty', function() {
      for (const codepoint of [0x20, 0x0d, 0xa0]) {
        assert.equal(outlines.glyphs[codepoint], '', `U+${codepoint.toString(16)} has an empty outline`);

        const svg = parse(toSvg(list([cell({codepoint})])));

        assert.equal(all(svg, 'use').length, 0, 'no glyph');
        assert.equal(body(svg).length, 0, 'and no group either');
      }
    });

    it('draws the fallback glyph for a code point the outlines do not have', function() {
      const svg = parse(toSvg(list([cell({codepoint: 0x10ffff})])));

      assert.equal(all(svg, 'use')[0].attributes.href, `#a${outlines.fallback.toString(16)}`);
      assert.equal(definition(svg, 'afffd').attributes.d, outlines.glyphs[outlines.fallback]);
    });

    it('draws the bold overstrike a glyph dot to the right, clipped to the same cell', function() {
      const svg = parse(toSvg(list([
        cell({x: 24, style: {bold: true, underline: 0, upperline: 0, invert: false},
          scale: {x: 2, y: 1}, width: 24}),
      ])));

      const uses = all(svg, 'use');

      assert.equal(uses.length, 2);
      assert.equal(uses[0].attributes.href, uses[1].attributes.href);

      /* One glyph dot, which is scale.x paper dots */

      assert.deepEqual(apply(uses[0].attributes.transform, [0, 0]), [24, 0]);
      assert.deepEqual(apply(uses[1].attributes.transform, [0, 0]), [26, 0]);

      /* And the overstrike is cut at the right edge of the cell of the first
         one, not at the edge of a cell of its own */

      const first = clipBox(definition(svg, uses[0].attributes['clip-path']));
      const second = clipBox(definition(svg, uses[1].attributes['clip-path']));

      assert.deepEqual(apply(uses[0].attributes.transform, [first.x, first.y]), [24, 0]);
      assert.deepEqual(
          apply(uses[0].attributes.transform, [first.x + first.width, first.y + first.height]), [48, 24],
      );

      assert.deepEqual(apply(uses[1].attributes.transform, [second.x, second.y]), [24, 0]);
      assert.deepEqual(
          apply(uses[1].attributes.transform, [second.x + second.width, second.y + second.height]), [48, 24],
      );
    });

    it('draws an underline along the bottom of the scaled cell, over its whole width', function() {
      const svg = parse(toSvg(list([
        cell({x: 12, scale: {x: 2, y: 2}, width: 24, height: 48,
          style: {bold: false, underline: 2, upperline: 0, invert: false}}),
      ])));

      const group = body(svg)[0];
      const rectangles = group.children.filter((child) => child.name === 'rect');

      assert.equal(rectangles.length, 1);
      assert.deepEqual(
          [rectangles[0].attributes.x, rectangles[0].attributes.y,
            rectangles[0].attributes.width, rectangles[0].attributes.height],
          ['12', '46', '24', '2'],
          'two dots along the bottom of a cell of 24 by 48, and the thickness does not scale',
      );
    });

    it('draws an upperline along the top of the scaled cell', function() {
      const svg = parse(toSvg(list([
        cell({x: 12, style: {bold: false, underline: 0, upperline: 1, invert: false}}),
      ])));

      const rectangles = body(svg)[0].children.filter((child) => child.name === 'rect');

      assert.deepEqual(
          [rectangles[0].attributes.x, rectangles[0].attributes.y,
            rectangles[0].attributes.width, rectangles[0].attributes.height],
          ['12', '0', '12', '1'],
      );
    });

    it('draws the cell in the ink and the glyph in the paper when it is inverted', function() {
      const svg = parse(toSvg(list([
        cell({x: 12, style: {bold: false, underline: 0, upperline: 0, invert: true}}),
      ])));

      const group = body(svg)[0];

      assert.deepEqual(group.children.map((child) => child.name), ['rect', 'use']);

      const rectangle = group.children[0];

      assert.deepEqual(
          [rectangle.attributes.x, rectangle.attributes.y,
            rectangle.attributes.width, rectangle.attributes.height],
          ['12', '0', '12', '24'],
      );

      assert.isUndefined(rectangle.attributes.fill, 'the rectangle is the ink of the document');
      assert.equal(group.children[1].attributes.fill, '#fff', 'and the glyph is the paper');
    });

    it('draws the glyph of an inverted cell white on a transparent paper', function() {
      const svg = parse(toSvg(list([
        cell({style: {bold: false, underline: 0, upperline: 0, invert: true}}),
      ]), {background: null}));

      assert.equal(all(svg, 'use')[0].attributes.fill, '#fff');
    });

    it('draws no line on a cell that is inverted or turned', function() {
      const styles = {bold: false, underline: 2, upperline: 2, invert: true};

      assert.equal(all(parse(toSvg(list([cell({style: styles})]))), 'rect').length, 2,
          'the inversion and the background, and no line');

      const turned = parse(toSvg(list([
        cell({style: {bold: false, underline: 2, upperline: 2, invert: false}, rotation: 90,
          width: 24, height: 12}),
      ])));

      assert.equal(body(turned)[0].children.filter((child) => child.name === 'rect').length, 0);
    });

    it('runs the ground of an inverted cell over the character spacing behind it', function() {
      const svg = parse(toSvg(list([
        cell({x: 12, spacing: 5, style: {bold: false, underline: 0, upperline: 0, invert: true}}),
      ])));

      const rectangle = body(svg)[0].children[0];

      assert.deepEqual(
          [rectangle.attributes.x, rectangle.attributes.y,
            rectangle.attributes.width, rectangle.attributes.height],
          ['12', '0', '17', '24'],
          'the twelve dots of the cell and the five of the spacing, over the height of the cell',
      );
    });

    it('runs the underline and the upperline over the character spacing behind the cell', function() {
      const svg = parse(toSvg(list([
        cell({x: 12, spacing: 5, style: {bold: false, underline: 2, upperline: 1, invert: false}}),
      ])));

      const rectangles = body(svg)[0].children.filter((child) => child.name === 'rect');

      assert.deepEqual(rectangles.map((rectangle) => [
        rectangle.attributes.x, rectangle.attributes.y,
        rectangle.attributes.width, rectangle.attributes.height,
      ]), [['12', '0', '17', '1'], ['12', '22', '17', '2']]);
    });

    it('runs the ground of a turned cell over the spacing, which lies before its unturned top', function() {
      const svg = parse(toSvg(list([
        cell({x: 100, y: 3, spacing: 5, rotation: 90, width: 24, height: 12,
          style: {bold: false, underline: 2, upperline: 2, invert: true}}),
      ])));

      const group = body(svg)[0].children[0];
      const rectangle = group.children[0];

      /* The pieces of a turned cell are written in its unturned frame, where
         the spacing is the five rows above the cell, and the quarter turn
         clockwise puts them to the right of the box on the line */

      assert.deepEqual(
          [rectangle.attributes.x, rectangle.attributes.y,
            rectangle.attributes.width, rectangle.attributes.height],
          ['0', '-5', '12', '29'],
      );

      assert.deepEqual(apply(group.attributes.transform, [0, -5]), [100 + 24 + 5, 3]);
      assert.deepEqual(apply(group.attributes.transform, [12, -5]), [100 + 24 + 5, 3 + 12]);
    });

    it('turns a cell of ESC V a quarter turn clockwise about its top left corner', function() {
      const svg = parse(toSvg(list([
        cell({x: 100, y: 3, rotation: 90, width: 24, height: 12,
          cell: {width: 12, height: 24}, scale: {x: 1, y: 1}}),
      ])));

      const group = body(svg)[0].children[0];

      assert.equal(group.name, 'g');

      /* The unturned cell is 12 by 24, its box on the line is 24 by 12, and the
         unturned (u, v) lands on (x + h0 - v, y + u), the mapping of the
         display list contract */

      for (const [u, v] of [[0, 0], [12, 0], [0, 24], [12, 24], [6, 7]]) {
        assert.deepEqual(apply(group.attributes.transform, [u, v]), [100 + 24 - v, 3 + u]);
      }
    });

    it('draws font B as the outline of font A at two thirds, on the baseline of its cell', function() {
      const svg = parse(toSvg(list([
        cell({font: 'B', cell: {width: 9, height: 17}, glyph: {width: 8, height: 16},
          baseline: 12, width: 9, height: 17}),
      ])));

      const use = all(svg, 'use')[0];

      assert.equal(use.attributes.href, '#a41', 'the outline of font A');
      assert.equal(all(svg, 'path').filter((element) => element.attributes.id).length, 1);

      /* The 12 by 24 cell of the outline becomes the 8 by 16 glyph box of font
         B, centred in the 9 by 17 cell and on its baseline */

      assert.deepEqual(apply(use.attributes.transform, [0, 0]), [0, 0]);
      assert.deepEqual(apply(use.attributes.transform, [12, 24]), [8, 16]);

      const clip = clipBox(definition(svg, use.attributes['clip-path']));

      assert.deepEqual(apply(use.attributes.transform, [clip.x, clip.y]), [0, 0]);
      assert.deepEqual(
          apply(use.attributes.transform, [clip.x + clip.width, clip.y + clip.height]), [9, 17],
          'and the clip is the 9 by 17 cell',
      );
    });

    it('draws a box drawing character from the box set of its cell', function() {
      const svg = parse(toSvg(list([
        cell({codepoint: 0x2500}),
        cell({x: 12, codepoint: 0x2500, font: 'B', cell: {width: 9, height: 17},
          glyph: {width: 8, height: 16}, baseline: 12, width: 9, height: 17}),
      ])));

      const uses = all(svg, 'use');

      assert.equal(uses[0].attributes.href, '#x2500-12x24');
      assert.equal(uses[1].attributes.href, '#x2500-9x17');

      assert.equal(definition(svg, 'x2500-12x24').attributes.d, outlines.box['12x24'][0x2500]);
      assert.isUndefined(definition(svg, 'x2500-12x24').attributes.transform, 'in whole dots');

      /* A box glyph is the cell, so it sits in the corner of the cell */

      assert.deepEqual(apply(uses[1].attributes.transform || '', [0, 0]), [12, 0]);
    });

    it('traces a box drawing character of a cell the outlines have no set for', function() {
      const svg = parse(toSvg(list([
        cell({codepoint: 0x2502, cell: {width: 10, height: 20}, glyph: {width: 12, height: 24},
          baseline: 15, width: 10, height: 20}),
      ])));

      const use = all(svg, 'use')[0];

      assert.equal(use.attributes.href, '#t2502-A-10x20');

      /* It is the cell the bitmap font renders with the stretch of a box
         drawing character, traced into rectangles, so it reaches the top and
         the bottom of the cell */

      const data = definition(svg, 't2502-A-10x20').attributes.d;

      assert.match(data, /^M\d+ 0h\d+v20h-\d+Z$/, `a bar down the whole cell, not ${data}`);
    });

    it('draws a downloaded glyph as the rectangles of its dots, in the corner of its cell', function() {
      const bitmap = Bitmap.create(12, 24);

      Bitmap.setPixel(bitmap, 0, 0, 1);
      Bitmap.setPixel(bitmap, 1, 0, 1);
      Bitmap.setPixel(bitmap, 11, 23, 1);

      const svg = parse(toSvg(list([cell({x: 12, codepoint: undefined, bitmap})])));
      const group = body(svg)[0];

      assert.equal(all(svg, 'use').length, 0, 'no definition, the stream defined it');

      const glyph = group.children[0];

      assert.equal(glyph.name, 'path');
      assert.equal(glyph.attributes.d, 'M0 0h2v1h-2ZM11 23h1v1h-1Z');
      assert.deepEqual(apply(glyph.attributes.transform, [0, 0]), [12, 0]);
    });

    it('clips a downloaded glyph that is larger than its cell', function() {
      const bitmap = Bitmap.create(24, 48);

      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 24; x++) {
          Bitmap.setPixel(bitmap, x, y, 1);
        }
      }

      const svg = parse(toSvg(list([cell({codepoint: undefined, bitmap})])));

      assert.equal(body(svg)[0].children[0].attributes.d, 'M0 0h12v24h-12Z', 'the cell, and no more');
    });
  });

  describe('a page', function() {
    /* The mapping of the display list contract: a logical point (u, v) of an
       area of this direction lands on this point of the page */

    const MAPPING = [
      (area, u, v) => [area.x + u, area.y + v],
      (area, u, v) => [area.x + v, area.y + area.height - u],
      (area, u, v) => [area.x + area.width - u, area.y + area.height - v],
      (area, u, v) => [area.x + area.width - v, area.y + u],
    ];

    /**
     * A page of one area in a direction, with one cell in it
     *
     * @param  {number}   direction   The print direction
     * @return {object}               The list
     */
    function page(direction) {
      return {
        version: 1,
        language: 'esc-pos',
        width: 576,
        height: 400,
        dpi: 203,
        entries: [{
          type: 'page',
          y: 50,
          height: 300,
          areas: [{
            x: 24,
            y: 30,
            width: 200,
            height: 160,
            direction,
            entries: [{type: 'line', y: 0, height: 30, rotation: 0, operations: [cell()]}],
          }],
        }],
      };
    }

    it('is a group at the row of the paper, one group per area', function() {
      const svg = parse(toSvg(page(0)));
      const group = body(svg)[0];

      assert.deepEqual(apply(group.attributes.transform, [0, 0]), [0, 50]);
      assert.equal(group.children.length, 1);
    });

    it('turns every area by its print direction, the way the contract maps it', function() {
      for (let direction = 0; direction < 4; direction++) {
        const svg = parse(toSvg(page(direction)));
        const area = page(direction).entries[0].areas[0];
        const turned = body(svg)[0].children[0].children[0];

        const sideways = direction === 1 || direction === 3;
        const logical = sideways ?
          {width: area.height, height: area.width} :
          {width: area.width, height: area.height};

        for (const [u, v] of [[0, 0], [logical.width, 0], [0, logical.height],
          [logical.width, logical.height], [7, 11]]) {
          assert.deepEqual(
              apply(turned.attributes.transform, [u, v]),
              MAPPING[direction](area, u, v),
              `direction ${direction} maps (${u}, ${v})`,
          );
        }
      }
    });

    it('clips an area to the part of it that is on the page', function() {
      const layout = page(0);

      layout.entries[0].areas[0].height = 500;
      layout.entries[0].areas[0].width = 600;

      const svg = parse(toSvg(layout));
      const clipped = body(svg)[0].children[0];

      assert.deepEqual(clipBox(definition(svg, clipped.attributes['clip-path'])),
          {x: 24, y: 30, width: 576 - 24, height: 300 - 30},
          'the intersection of the area and the page');
    });

    it('writes nothing for an area that holds nothing', function() {
      const layout = page(0);

      layout.entries[0].areas[0].entries = [];

      assert.equal(body(parse(toSvg(layout))).length, 0);
    });
  });

  describe('the markers', function() {
    it('writes nothing for a feed, a pulse or an unknown command', function() {
      const layout = list([]);

      layout.entries = [
        {type: 'feed', y: 0, height: 30},
        {type: 'pulse', y: 30, device: 0, on: 100, off: 500},
        {type: 'unknown', y: 30, data: new Uint8Array([1, 2, 3])},
      ];

      assert.equal(body(parse(toSvg(layout))).length, 0);
    });

    it('writes nothing for a cut, unless the caller asked for a marker', function() {
      const layout = list([]);

      layout.entries = [{type: 'cut', y: 42, value: 'partial'}];

      assert.equal(body(parse(toSvg(layout))).length, 0);

      const marked = parse(toSvg(layout, {cutMarker: true, ink: '#333'}));
      const line = body(marked)[0];

      assert.equal(line.name, 'line');
      assert.deepEqual(
          [line.attributes.x1, line.attributes.y1, line.attributes.x2, line.attributes.y2],
          ['0', '42', '576', '42'],
      );

      assert.equal(line.attributes.stroke, '#333');
      assert.isDefined(line.attributes['stroke-dasharray']);
    });
  });

  describe('an image', function() {
    const bitmap = Bitmap.create(16, 3);

    Bitmap.setPixel(bitmap, 0, 0, 1);
    Bitmap.setPixel(bitmap, 15, 2, 1);
    Bitmap.setPixel(bitmap, 8, 1, 1);

    it('is an image element of a PNG, one dot on one dot', function() {
      const svg = parse(toSvg(list([
        {type: 'image', x: 24, y: 2, width: 16, height: 3, data: bitmap.data},
      ])));

      const image = body(svg)[0].children[0];

      assert.equal(image.name, 'image');
      assert.deepEqual(
          [image.attributes.x, image.attributes.y, image.attributes.width, image.attributes.height],
          ['24', '2', '16', '3'],
      );

      assert.equal(image.attributes['image-rendering'], 'pixelated');
      assert.match(image.attributes.href, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    });

    it('writes a PNG that node:zlib inflates to the rows of the bitmap', function() {
      const png = toStoredPng(bitmap);

      assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      /* The chunks of the file, and the scanlines of its IDAT */

      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const chunks = {};

      let offset = 8;

      while (offset < png.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));

        chunks[type] = png.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
      }

      assert.deepEqual(Object.keys(chunks), ['IHDR', 'IDAT', 'IEND']);
      assert.equal(new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset).getUint32(0), 16);
      assert.equal(new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset).getUint32(4), 3);
      assert.equal(chunks.IHDR[8], 1, 'one bit per sample');
      assert.equal(chunks.IHDR[9], 0, 'greyscale');

      const raw = new Uint8Array(zlib.inflateSync(Buffer.from(chunks.IDAT)));

      assert.deepEqual(Array.from(raw), Array.from(scanlines(bitmap)));

      /* Which is the rows of the bitmap, inverted, with a filter byte each: a
         set bit of a greyscale PNG is white and a set bit of the paper is ink */

      const rowBytes = 2;

      for (let row = 0; row < bitmap.height; row++) {
        assert.equal(raw[row * (rowBytes + 1)], 0, 'no filter');

        for (let byte = 0; byte < rowBytes; byte++) {
          assert.equal(
              raw[row * (rowBytes + 1) + 1 + byte],
              ~bitmap.data[row * rowBytes + byte] & 0xff,
          );
        }
      }
    });

    it('stores what it cannot compress in blocks of at most 65535 bytes', function() {
      const data = new Uint8Array(70000);

      for (let index = 0; index < data.length; index++) {
        data[index] = index & 0xff;
      }

      const stream = stored(data);

      assert.deepEqual(Array.from(stream.subarray(0, 2)), [0x78, 0x01], 'the zlib header');
      assert.deepEqual(Array.from(zlib.inflateSync(Buffer.from(stream))), Array.from(data));

      /* Two blocks, the first of them not the last */

      assert.equal(stream[2], 0);
      assert.equal(stream[2 + 5 + 0xffff], 1);

      /* And the Adler-32 of the data, which zlib computes the same way */

      const checksum = new DataView(stream.buffer).getUint32(stream.length - 4);

      assert.equal(checksum, adler32(data));
      assert.equal(checksum, zlib.deflateSync(Buffer.from(data)).readUInt32BE(
          zlib.deflateSync(Buffer.from(data)).length - 4,
      ));
    });
  });

  describe('the counts of a hand built layout', function() {
    it('are the operations of the list', function() {
      const bitmap = Bitmap.create(12, 24);

      Bitmap.setPixel(bitmap, 3, 3, 1);

      const layout = list([
        cell({x: 0, codepoint: 0x41}),
        cell({x: 12, codepoint: 0x20}),
        cell({x: 24, codepoint: 0x42, style: {bold: true, underline: 1, upperline: 0, invert: false}}),
        cell({x: 36, codepoint: undefined, bitmap}),
        {type: 'rect', x: 0, y: 26, width: 100, height: 2},
        {type: 'rect', x: 200, y: 26, width: 100, height: 2},
        {type: 'image', x: 300, y: 0, width: 16, height: 3, data: new Uint8Array(6)},
      ]);

      const svg = parse(toSvg(layout));
      const group = body(svg)[0];

      const counts = (name) => group.children.filter((child) => child.name === name).length;

      assert.equal(counts('use'), 3, 'the A, the B and the overstrike of the B, and nothing for the space');
      assert.equal(counts('path'), 2, 'the downloaded glyph and the two rectangles as one path');
      assert.equal(counts('rect'), 1, 'the underline of the B');
      assert.equal(counts('image'), 1);

      assert.equal(
          all(svg.children.find((child) => child.name === 'defs'), 'path')
              .filter((element) => element.attributes.id).length,
          2,
          'one definition per distinct glyph, the downloaded one being written where it is used',
      );
    });
  });

  describe('the rasterized check', function() {
    /* Every fixture of the four directories, rendered by resvg and compared
       with the paper of the same fixture. The wasm module is a few megabytes
       and every render is a paper of half a million dots, so the suite takes
       its time */

    const fixtures = [];
    const measured = [];

    for (const directory of ['esc-pos', 'esc-pos/raw', 'star-prnt', 'star-prnt/raw']) {
      for (const name of names(directory)) {
        fixtures.push(`${directory}/${name}`);
      }
    }

    /**
     * The rectangles and the images of a list, in the coordinates of the paper.
     * Only the lines of the paper are mapped, not the ones inside a page: a
     * page turns its areas, and no fixture puts a symbol or an image in one.
     *
     * @param  {object}   layout   The list
     * @return {object[]}          The boxes
     */
    function regions(layout) {
      const result = [];

      for (const entry of layout.entries) {
        if (entry.type !== 'line') {
          continue;
        }

        for (const operation of entry.operations) {
          if (operation.type !== 'rect' && operation.type !== 'image') {
            continue;
          }

          const box = entry.rotation === 180 ?
            {
              x: layout.width - operation.x - operation.width,
              y: entry.y + entry.height - operation.y - operation.height,
            } :
            {x: operation.x, y: entry.y + operation.y};

          result.push({
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            right: Math.min(layout.width, box.x + operation.width),
            bottom: Math.min(layout.height, box.y + operation.height),
          });
        }
      }

      return result;
    }

    if (!Resvg) {
      it('needs resvg, which did not load', function() {
        assert.fail(`@resvg/resvg-wasm did not load, so the vector output is not checked: ${unavailable}`);
      });

      return;
    }

    for (const key of fixtures) {
      it(`${key} agrees with its paper`, async function() {
        const layout = layoutOf(key);
        const paper = paperOf(key);
        const document = toSvg(layout);

        /* One dot per unit: the width and the height of the document are the
           dots of the paper, so the original size is the size of the paper */

        const png = new Resvg(document, {fitTo: {mode: 'original'}}).render().asPng();
        const drawn = await fromPng(new Uint8Array(png));

        assert.equal(drawn.width, paper.width, 'the document is as wide as the paper');
        assert.equal(drawn.height, paper.height, 'and as tall');

        /* The rectangles and the images are dots on whole coordinates in both,
           so they agree dot for dot */

        let differing = 0;

        for (const region of regions(layout)) {
          for (let y = region.y; y < region.bottom; y++) {
            for (let x = region.x; x < region.right; x++) {
              if (Bitmap.getPixel(paper, x, y) !== Bitmap.getPixel(drawn, x, y)) {
                differing++;
              }
            }
          }
        }

        assert.equal(differing, 0, 'the rectangles and the images of the list agree dot for dot');

        /* And the whole paper agrees to the bound, the text being outlines
           against the dots the coverage rule of the rasterizer filled */

        const measure = dotAgreement(paper, drawn);

        measured.push({key, agreement: measure.agreement, missing: measure.missing, extra: measure.extra});

        assert.isAtLeast(
            measure.agreement,
            AGREEMENT,
            `${key} agrees to ${measure.agreement.toFixed(5)}, ` +
            `${measure.missing} dots of the paper missing and ${measure.extra} too many`,
        );
      }).timeout(60 * 1000);
    }

    /* No fixture combines the character spacing with a reverse or an underline,
       the escpost ones that do are external and are not rendered here, so the
       agreement of the two back-ends over the spacing is checked on a list
       written out here. The spacing carries no glyph, so the two agree dot for
       dot rather than to the bound of the outlines */

    it('the character spacing behind a cell agrees with its paper, dot for dot', async function() {
      const spacing = 5;

      const cells = [
        cell({x: 0, spacing, style: {bold: false, underline: 0, upperline: 0, invert: true}}),
        cell({x: 40, spacing, style: {bold: false, underline: 2, upperline: 1, invert: false}}),
        cell({x: 80, spacing, style: {bold: false, underline: 2, upperline: 1, invert: true}}),
        cell({x: 120, spacing, rotation: 90, width: 24, height: 12,
          style: {bold: false, underline: 2, upperline: 0, invert: true}}),
        cell({x: 160, spacing, rotation: 90, width: 24, height: 12,
          style: {bold: false, underline: 2, upperline: 0, invert: false}}),
        cell({x: 200, spacing, style: {bold: false, underline: 0, upperline: 0, invert: false}}),
      ];

      const layout = list(cells, {height: 30}, {height: 30});
      const paper = stitch(rasterize(layout), {width: layout.width});
      const png = new Resvg(toSvg(layout), {fitTo: {mode: 'original'}}).render().asPng();
      const drawn = await fromPng(new Uint8Array(png));

      let differing = 0;

      for (const one of cells) {
        for (let x = one.x + one.width; x < one.x + one.width + spacing; x++) {
          for (let y = 0; y < layout.height; y++) {
            if (Bitmap.getPixel(paper, x, y) !== Bitmap.getPixel(drawn, x, y)) {
              differing++;
            }
          }
        }
      }

      assert.equal(differing, 0, 'the writer and the bitmap back-end paint the spacing the same');
    }).timeout(60 * 1000);

    /* And the spacing stops at the right edge of the print area, which a right
       aligned reversed line runs up against. The list is laid out from a stream
       rather than written out here, because it is the layout that cuts the
       spacing to what fits, see the notes of section 22 */

    it('the spacing of a right aligned reversed line stops at the print area', async function() {
      /* ESC @, GS L 24, GS W 96, ESC a 2, ESC SP 4, GS B 1, 'AB', LF */

      const bytes = new Uint8Array([
        0x1b, 0x40, 0x1d, 0x4c, 24, 0, 0x1d, 0x57, 96, 0,
        0x1b, 0x61, 2, 0x1b, 0x20, 4, 0x1d, 0x42, 1, 0x41, 0x42, 0x0a,
      ]);

      const layout = new EscPosRenderer({width: WIDTH, codepageMapping: 'epson'}).layout(bytes);
      const paper = stitch(rasterize(layout), {width: layout.width});
      const png = new Resvg(toSvg(layout), {fitTo: {mode: 'original'}}).render().asPng();
      const drawn = await fromPng(new Uint8Array(png));

      let differing = 0;
      let inked = 0;

      for (let y = 0; y < layout.height; y++) {
        for (let x = 24 + 96; x < layout.width; x++) {
          if (Bitmap.getPixel(paper, x, y) !== Bitmap.getPixel(drawn, x, y)) {
            differing++;
          }

          inked += Bitmap.getPixel(paper, x, y) + Bitmap.getPixel(drawn, x, y);
        }
      }

      assert.equal(differing, 0, 'the two back-ends agree beside the area');
      assert.equal(inked, 0, 'and neither of them prints there');
    }).timeout(60 * 1000);

    after(function() {
      if (measured.length === 0) {
        return;
      }

      const sorted = measured.slice().sort((one, two) => one.agreement - two.agreement);
      const median = sorted[Math.floor(sorted.length / 2)];

      console.log(`\n    The agreement of the vector output with the paper, ${measured.length} fixtures:\n`);

      for (const one of measured) {
        console.log(
            `      ${one.key.padEnd(36)} ${one.agreement.toFixed(5)}` +
            `  ${String(one.missing).padStart(6)} missing ${String(one.extra).padStart(6)} too many`,
        );
      }

      console.log(
          `\n      lowest ${sorted[0].agreement.toFixed(5)} (${sorted[0].key}), ` +
          `median ${median.agreement.toFixed(5)}, highest ${sorted[sorted.length - 1].agreement.toFixed(5)}\n`,
      );
    });
  });

  describe('the golden files', function() {
    for (const key of GOLDEN) {
      it(`${key} is what the writer makes of its list`, function() {
        const golden = fs.readFileSync(path.join(root, `${key}.svg`), 'utf8');

        assert.equal(toSvg(layoutOf(key)), golden);
      });

      it(`${key} is well formed`, function() {
        const svg = parse(fs.readFileSync(path.join(root, `${key}.svg`), 'utf8'));

        assert.equal(svg.name, 'svg');

        /* Every reference of the document is defined in it */

        const ids = new Set(all(svg).map((element) => element.attributes.id).filter(Boolean));

        for (const element of all(svg)) {
          const references = [element.attributes['clip-path']];

          if (element.name === 'use') {
            references.push(element.attributes.href);
          }

          for (const reference of references) {
            if (reference) {
              assert.isTrue(
                  ids.has(reference.replace(/^(url\(#|#)/, '').replace(/\)$/, '')),
                  `${reference} is defined`,
              );
            }
          }
        }
      });
    }
  });
});
