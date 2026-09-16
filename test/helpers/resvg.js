import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/*
    The wasm build of resvg, a dev dependency of the tests alone.

    It is loaded here rather than in each file that rasterizes, because
    initWasm() may be called once per process and more than one test file
    renders: test/svg.js, which compares a whole receipt with its paper, and
    test/outlines.js, which compares a box drawing path with its cell. The
    module is loaded at import time rather than in a hook, so that the tests
    that need it are defined only when it is there and a machine without it
    runs the rest of the suite.
*/

const WASM = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm',
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

export {Resvg, unavailable};
