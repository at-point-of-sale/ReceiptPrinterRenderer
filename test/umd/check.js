import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

/*
    The UMD build, checked the way a script tag loads it.

    Run with `npm run test:umd`, which needs a build, so it is a script of its
    own and not part of the mocha suite, the same as `npm run test:types`. The
    bundle is evaluated in a context without a module system, which is what a
    browser gives it, and the global it leaves behind must be the class itself,
    with the renderers and the image format helpers attached to it.
*/

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

const bundle = path.join(dist, 'receipt-printer-renderer.umd.js');
const svgBundle = path.join(dist, 'receipt-printer-renderer-svg.umd.js');

for (const file of [bundle, svgBundle]) {
  if (!fs.existsSync(file)) {
    console.error('No UMD build found, run npm run build first');
    process.exit(1);
  }
}

/* A script tag has no exports, no module and no define, so the bundle falls
   through to the global. Only the globals a browser has are in the context.

   structuredClone is one of them and it has to be here: the codepage encoder
   calls it to hand out a codepage definition, and without it every byte of a
   render decodes to the fallback glyph instead of its character, which is what
   this check missed for as long as it only compared the shape of the items */

const context = vm.createContext({console, TextDecoder, TextEncoder, atob, btoa, URL, structuredClone});

/* Both bundles go into the one context, the way two script tags load them on
   one page: the renderer lays a stream out and the writer draws the list */

vm.runInContext(fs.readFileSync(bundle, 'utf8'), context, {filename: 'receipt-printer-renderer.umd.js'});
vm.runInContext(fs.readFileSync(svgBundle, 'utf8'), context, {filename: 'receipt-printer-renderer-svg.umd.js'});

const ReceiptPrinterRenderer = context.ReceiptPrinterRenderer;

assert.equal(typeof ReceiptPrinterRenderer, 'function', 'the global is the class, not an object of exports');

/* The bundle runs in its own context, so its arrays have another Array
   prototype than this module's and are compared as text */

assert.equal(ReceiptPrinterRenderer.languages.join(' '), 'esc-pos star-prnt star-line star-graphics');

assert.equal(typeof ReceiptPrinterRenderer.EscPosRenderer, 'function');
assert.equal(typeof ReceiptPrinterRenderer.StarPrntRenderer, 'function');
assert.equal(ReceiptPrinterRenderer.EscPosRenderer.language, 'esc-pos');
assert.equal(ReceiptPrinterRenderer.StarPrntRenderer.language, 'star-prnt');

for (const helper of ['rasterize', 'pieces', 'toPbm', 'toPng', 'toImageData', 'stitch']) {
  assert.equal(typeof ReceiptPrinterRenderer[helper], 'function', `${helper} is attached to the class`);
}

/* And it renders, in every language, from a script tag */

for (const language of ReceiptPrinterRenderer.languages) {
  const renderer = new ReceiptPrinterRenderer({
    language,
    width: 576,
    codepageMapping: language === 'esc-pos' ? 'epson' : 'star',
    commands: ['cut'],
  });

  assert.equal(renderer.language, language);
  assert.equal(renderer.columns, 48);

  const items = renderer.render(new Uint8Array([0x1b, 0x40, 0x41, 0x0a]));

  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'image');
  assert.equal(items[0].width, 576);

  const paper = ReceiptPrinterRenderer.stitch(items, {width: 576});

  assert.equal(ReceiptPrinterRenderer.toPbm(paper).length, paper.data.length + `P4\n576 ${paper.height}\n`.length);
}

assert.throws(() => new ReceiptPrinterRenderer({language: 'meow', width: 576}), /Unknown language meow/);

/* The display list and the rasterizer, which a page that draws a receipt of
   its own needs from the same global */

{
  const renderer = new ReceiptPrinterRenderer({language: 'esc-pos', width: 576, commands: ['cut']});
  const layout = renderer.layout(new Uint8Array([0x1b, 0x40, 0x41, 0x0a]));

  assert.equal(layout.version, 1);
  assert.equal(layout.language, 'esc-pos');
  assert.equal(layout.width, 576);
  assert.equal(layout.height, 30);
  assert.equal(layout.entries.length, 1);
  assert.equal(layout.entries[0].type, 'line');
  assert.equal(layout.entries[0].operations.length, 1);
  assert.equal(layout.entries[0].operations[0].type, 'text');
  assert.equal(layout.entries[0].operations[0].codepoint, 0x41);
  assert.equal(layout.entries[0].operations[0].width, 12);
  assert.equal(layout.entries[0].operations[0].height, 24);

  const drawn = ReceiptPrinterRenderer.rasterize(layout, {commands: ['cut']});
  const items = renderer.render(new Uint8Array([0x1b, 0x40, 0x41, 0x0a]));

  assert.equal(drawn.length, items.length);
  assert.equal(drawn[0].height, items[0].height);
  assert.equal(Array.from(drawn[0].data).join(','), Array.from(items[0].data).join(','));
}

/* The SVG sub-entry, loaded from a second script tag, draws the list the main
   global made */

{
  const ReceiptPrinterRendererSvg = context.ReceiptPrinterRendererSvg;

  assert.equal(typeof ReceiptPrinterRendererSvg, 'object', 'the SVG global is an object of exports');
  assert.equal(typeof ReceiptPrinterRendererSvg.toSvg, 'function', 'toSvg is on the SVG global');

  const renderer = new ReceiptPrinterRenderer({language: 'esc-pos', width: 576, codepageMapping: 'epson'});
  const svg = ReceiptPrinterRendererSvg.toSvg(renderer.layout(new Uint8Array([0x1b, 0x40, 0x41, 0x0a])));

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="576" height="30" '));
  assert.ok(svg.includes('viewBox="0 0 576 30"'), 'the viewBox is the paper in dots');
  assert.ok(svg.includes('<path id="a41"'), 'the A of the stream is defined as a path');
  assert.ok(svg.includes('<use href="#a41"'), 'and drawn once');
  assert.ok(svg.trimEnd().endsWith('</svg>'));

  /* And the outlines are in that bundle and in no other one: a driver that
     renders images for a printer must not carry 344 kB of glyph paths. The
     needle is the path of the capital A, which nothing else in the package
     holds */

  const needle = /<path id="a41" d="([^"]+)"/.exec(svg)[1].slice(0, 24);

  assert.ok(fs.readFileSync(svgBundle, 'utf8').includes(needle), 'the SVG bundle holds the outlines');
  assert.ok(!fs.readFileSync(bundle, 'utf8').includes(needle), 'the main bundle holds none of them');
  assert.ok(
      !fs.readFileSync(path.join(dist, 'receipt-printer-renderer.esm.js'), 'utf8').includes(needle),
      'and neither does the module build',
  );
}

/* And it draws the same dots as the module build of the same sources, text
   included, which is the check that a bundle that decodes nothing would fail */

{
  const module = await import(
      pathToFileURL(path.join(path.dirname(bundle), 'receipt-printer-renderer.esm.js')).href
  );

  const options = {language: 'esc-pos', width: 576, codepageMapping: 'epson', commands: ['cut', 'pulse', 'feed']};
  const bytes = new Uint8Array([
    0x1b, 0x40,
    ...Array.from('Total').map((character) => character.charCodeAt(0)),
    0x0a,
    0x1b, 0x21, 0x30,
    ...Array.from('16.75').map((character) => character.charCodeAt(0)),
    0x0a,
    0x1d, 0x56, 0x00,
  ]);

  const drawn = new ReceiptPrinterRenderer(options).render(bytes);
  const expected = new module.ReceiptPrinterRenderer(options).render(bytes);

  assert.equal(drawn.length, expected.length, 'the UMD build returns the items of the module build');

  for (let index = 0; index < expected.length; index++) {
    assert.equal(drawn[index].type, expected[index].type);

    if (expected[index].type === 'image') {
      assert.equal(drawn[index].height, expected[index].height);
      assert.equal(
          Array.from(drawn[index].data).join(','),
          Array.from(expected[index].data).join(','),
          'the UMD build draws the dots of the module build',
      );
    }
  }

  /* Something is drawn at all: a render that decodes nothing still fills its
     rows with fallback glyphs, so the dots above are the check, and this is the
     guard against comparing two empty papers */

  assert.ok(expected.some((item) => item.type === 'image' && item.data.some((byte) => byte !== 0)));
}

console.log(
    'UMD global is ReceiptPrinterRenderer, renders and lays out esc-pos, star-prnt, star-line and star-graphics, ' +
    'draws the dots of the module build, and ReceiptPrinterRendererSvg writes the SVG of a list it made',
);
