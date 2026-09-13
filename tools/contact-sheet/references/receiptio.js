import fs from 'node:fs';
import path from 'node:path';

import {unavailable, fromPng, notApplicable} from './shared.js';

/*
    receiptio as a reference rendering, section 16f.

    receiptio, https://github.com/receiptline/receiptio, Apache 2.0, 5.0.1, a
    dev dependency of this repository.

    This module is not like the others. thermal and ESCPost render the bytes of
    a fixture, and receiptio renders the document those bytes were made from:
    it takes the ReceiptLine source of a receiptline fixture and rasterizes it
    into a PNG at the same columns, `-p png -c <columns> -l en`, which is the
    same rasterization the stargraphic fixtures of section 16f carry. So it
    answers a question the other references cannot: whether our render of a
    receiptline stream is the receipt the document describes, whatever command
    set the stream was written in. The page says so in the column title and the
    agreement table in its own row.

    It runs for the receiptline fixtures and for no others: every one of them
    names its document in the `file` of its provenance and the columns next to
    it, and a fixture of another library has no ReceiptLine source at all.

    The capture script next to it does the work, tools/external/receiptio/
    capture.js: it holds the shim that hands receiptio a `puppeteer` and it
    knows where a Chromium is, see its header. This module reports itself
    unavailable with the reason when receiptio, puppeteer-core or a browser is
    missing, the way every reference module does.

    One PNG per document and width, not one per fixture: the fixtures of a
    document share its rendering, and a document at 48 columns is captured in up
    to seven of them. Nothing is cached between runs.
*/

export const name = 'receiptio';

export const title = 'receiptio, from the document';

export const version = '5.0.1';

export const kind = 'image';

/**
 * @typedef {import('./shared.js').Reference} Reference
 */

/** The renderings of this run, keyed by document and columns */

const renders = new Map();

/** The capture script, loaded once, or the reason it could not be */

let capture = null;

/**
 * The capture script next to receiptio, which is where the library, the shim
 * and the browser are. It is imported on the first fixture and not when this
 * module is loaded, so that a machine without receiptio builds the sheet.
 *
 * @return {Promise<object>}   The module, or what went wrong
 */
async function tool() {
  if (!capture) {
    try {
      capture = {module: await import('../../external/receiptio/capture.js')};
    } catch (error) {
      capture = {reason: `receiptio is not installed: ${error.message}`};
    }
  }

  return capture;
}

/**
 * The document and the columns of a fixture, out of its provenance: the `file`
 * of a receiptline capture is the ReceiptLine source it transformed
 *
 * @param  {object}   fixture   The fixture, with its provenance
 * @return {object}             The document and the columns, or null
 */
function document(fixture) {
  if (fixture.library !== 'receiptline') {
    return null;
  }

  const match = fixture.provenance.file.match(/([^/]+)\.receipt$/);

  return match ? {document: match[1], columns: fixture.provenance.columns} : null;
}

/**
 * What receiptio makes of the document of one fixture
 *
 * @param  {object}              fixture   The fixture: library, name, input and provenance
 * @param  {object}              target    Where the render goes: directory and the path in the page
 * @return {Promise<Reference>}            The reference
 */
export async function reference(fixture, target) {
  const source = document(fixture);

  if (!source) {
    return notApplicable(name, version, 'the fixture is not a receiptline document');
  }

  const key = `${source.document}-${source.columns}`;
  const file = `${key}.receiptio.png`;
  const command = `receiptio -p png -c ${source.columns} -l en ${source.document}.receipt`;

  if (!renders.has(key)) {
    const loaded = await tool();

    if (!loaded.module) {
      return unavailable(name, version, loaded.reason);
    }

    try {
      renders.set(key, await loaded.module.png(source.document, source.columns));
    } catch (error) {
      renders.set(key, error.message);
    }
  }

  const png = renders.get(key);

  if (typeof png === 'string') {
    return Object.assign(unavailable(name, version, png), {command});
  }

  fs.writeFileSync(path.join(target.directory, file), png);

  return {
    tool: name,
    title,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    bitmap: await fromPng(png),
    note: 'the document, not the bytes',
    command,
  };
}
