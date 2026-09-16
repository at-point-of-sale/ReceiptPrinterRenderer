import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer, {stitch, toPng} from '../../src/receipt-printer-renderer.js';
import {toSvg} from '../../src/svg.js';

/*
    The command line, checked the way a shell runs it.

    Run with `npm run test:bin`, which needs a build, so it is a script of its
    own and not part of the mocha suite, the same as `npm run test:umd`. The
    mocha suite drives run() of src/cli.js over buffers and checks the interface
    there; what is left for here is the three things a buffer cannot show: that
    the shim in bin/ starts at all, that the bundle it imports is the command
    the sources make, and that a real pipe and a real file carry the bytes.

    The bytes it writes are compared with what the sources give for the same
    stream, so a bundle that lost its fonts or its compression fails here the
    way the UMD check would.
*/

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const bin = path.join(root, 'bin', 'receipt-printer-renderer.js');
const bundle = path.join(root, 'dist', 'receipt-printer-renderer-cli.mjs');
const fixtures = path.join(root, 'test', 'fixtures', 'esc-pos');

if (!fs.existsSync(bundle)) {
  console.error('No command line build found, run npm run build first');
  process.exit(1);
}

/* The paper of the fixtures, which is the default of the command as well */

const WIDTH = 576;

/**
 * Run the built command
 *
 * @param  {string[]}     args       The arguments
 * @param  {Uint8Array}   [input]    What standard input carries
 * @return {Buffer}                  What standard output carried
 */
function command(args, input) {
  return execFileSync(process.execPath, [bin, ...args], {
    input: typeof input === 'undefined' ? Buffer.alloc(0) : Buffer.from(input),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The bytes of a fixture
 *
 * @param  {string}       name   Name of the fixture
 * @return {Uint8Array}          The commands
 */
function bytes(name) {
  return new Uint8Array(fs.readFileSync(path.join(fixtures, `${name}.bin`)));
}

const target = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-printer-renderer-bin-'));

try {
  /* A file in and a file out, which is the invocation of the README */

  {
    const output = path.join(target, 'receipt.png');

    command([path.join(fixtures, 'receipt.bin'), '-o', output]);

    const renderer = new ReceiptPrinterRenderer({width: WIDTH});
    const expected = await toPng(stitch(renderer.render(bytes('receipt')), {width: WIDTH}));

    assert.deepEqual(
        Array.from(new Uint8Array(fs.readFileSync(output))),
        Array.from(expected),
        'the command writes the PNG the sources make',
    );
  }

  /* A pipe in and a pipe out, which is the other invocation of the README */

  {
    const written = command(['-f', 'svg'], bytes('receipt')).toString('utf8');
    const expected = toSvg(new ReceiptPrinterRenderer({width: WIDTH}).layout(bytes('receipt')));

    assert.equal(written, expected, 'the command writes the SVG the sources make, through a pipe');
    assert.ok(written.includes('<path id="a'), 'and the bundle carries the glyph outlines');
  }

  /* And the pieces of a cut receipt, named the way the contact sheet names
     them: the first keeps the name and the rest are numbered from two */

  {
    const output = path.join(target, 'cut.png');

    command([path.join(fixtures, 'cut.bin'), '--pieces', '-o', output]);

    for (const name of ['cut.png', 'cut.2.png', 'cut.3.png']) {
      assert.ok(fs.existsSync(path.join(target, name)), `${name} was written`);
    }

    assert.ok(!fs.existsSync(path.join(target, 'cut.4.png')), 'and nothing behind the last piece');
  }

  /* The version of the manifest and the usage, which is what a shell asks for
     before anything else */

  {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    assert.equal(command(['--version']).toString('utf8'), `${manifest.version}\n`);
    assert.ok(command(['--help']).toString('utf8').startsWith('Usage: receipt-printer-renderer'));
  }

  console.log(
      'The built command writes the PNG of a file, the SVG of a pipe and the three pieces of a cut receipt, ' +
      'all as the sources make them, and reports version ' +
      `${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version}`,
  );
} finally {
  fs.rmSync(target, {recursive: true, force: true});
}
