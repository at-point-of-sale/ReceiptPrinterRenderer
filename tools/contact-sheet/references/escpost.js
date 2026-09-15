import fs from 'node:fs';
import path from 'node:path';

import Bitmap from '../../../src/bitmap.js';
import {toPng} from '../../../src/formats/png.js';
import {references, root, locate, run, unavailable, outOfScope, fromPng} from './shared.js';

/*
    ESCPost as a reference renderer, section 16b.

    ESCPost, https://github.com/receiptful/escpost, Apache 2.0, v0.2.1, commit
    c4a766513c58cebf84bc4ec6c5da8514ae2e0d88. It renders an ESC/POS stream to
    one PNG per sheet with a printer profile of its own, so it is the closest
    thing to a second opinion on the same bytes this page has.

    It is a Rust program and ships no binary, so it has to be built once. There
    is no Docker here and the release profile of the workspace wants a frontend
    bundle that only a Docker or just build produces, so the debug binary is
    what is built; it renders the same pixels, slower.

        git clone https://github.com/receiptful/escpost build/references/escpost
        git -C build/references/escpost checkout c4a7665
        cd build/references/escpost && cargo build --bin escpost
        cp target/debug/escpost ../escpost-bin

    The module looks for the binary in this order:

      $RENDERER_ESCPOST
      build/references/escpost-bin
      build/references/escpost/target/debug/escpost
      build/references/escpost/target/release/escpost

    and reports itself unavailable when none of them is there. The exact
    invocation per fixture is on the contact sheet, next to the render.

    ESCPost cuts a stream into sheets and writes one PNG per sheet. Those sheets
    are the pieces of paper the column shows, one image each, section 24; for
    the agreement metric, which compares one paper with one paper, they are
    stacked in the order of the manifest into a single bitmap.

    ESCPost refuses a stream with a command it does not implement, by design:
    its decision DD-012 says it never guesses where an unknown command ends and
    never continues with a partial preview. Most of what it refuses in these
    fixtures are short commands that change nothing, or next to nothing,
    about the paper: GS a, the automatic status back the encoder sends after
    ESC @; GS r, a status request; FS ., FS S, FS -, FS !, FS W and FS ( A, the multibyte mode,
    spacing, underline, print mode, size and font that matter only to
    multibyte text; GS b, smoothing; ESC 4, italic, which no
    hardware prints; ESC {, upside down; ESC e, reverse feed; and ESC G, the
    double strike, the one whose removal shows, as a slightly lighter line.
    So when ESCPost refuses a stream, this module removes the command it
    named, at the offset it named, when the command is in the table below,
    and tries again, until ESCPost renders or names something the table does
    not hold. The framing is not a guess here: the table carries the length of
    every command in it, the way src/renderers/esc-pos.js parses it. A render
    that needed the filter is flagged on the sheet,
    with the error ESCPost gave for the stream as stored and the commands that
    were removed, and the invocation shown is the one with the filtered file,
    which is written next to the sheets.
*/

/* The commands the pre-filter removes, by their leading bytes, with the number
   of bytes the command takes, a number or a function of the stream and the
   offset for a command with a length prefix. Only commands whose removal
   leaves the paper as it is on a printer that ignores them, or as near to it
   as a double strike is. An error of ESCPost that names a command outside
   this table stands */

const FILTERS = [
  {name: 'GS a', bytes: [0x1d, 0x61], length: 3},
  {name: 'GS b', bytes: [0x1d, 0x62], length: 3},
  {name: 'GS r', bytes: [0x1d, 0x72], length: 3},
  {name: 'ESC 4', bytes: [0x1b, 0x34], length: 3},
  {name: 'ESC G', bytes: [0x1b, 0x47], length: 3},
  {name: 'ESC {', bytes: [0x1b, 0x7b], length: 3},
  {name: 'ESC e', bytes: [0x1b, 0x65], length: 3},
  {name: 'FS .', bytes: [0x1c, 0x2e], length: 2},
  {name: 'FS &', bytes: [0x1c, 0x26], length: 2},
  {name: 'FS C', bytes: [0x1c, 0x43], length: 3},
  {name: 'FS S', bytes: [0x1c, 0x53], length: 4},
  {name: 'FS -', bytes: [0x1c, 0x2d], length: 3},
  {name: 'FS !', bytes: [0x1c, 0x21], length: 3},
  {name: 'FS W', bytes: [0x1c, 0x57], length: 3},
  {
    name: 'FS ( A',
    bytes: [0x1c, 0x28, 0x41],
    length: (bytes, offset) => 5 + bytes[offset + 3] + 256 * bytes[offset + 4],
  },
];

/* How many commands the filter removes from one stream at most */

const FILTER_LIMIT = 64;

/* The error of ESCPost that names a command and where it is */

const REFUSAL =
  /unsupported (?:ESC\/POS command (?:ESC|GS) 0x[0-9a-f]{2}|data byte 0x[0-9a-f]{2}) at byte offset (\d+)/;

/**
 * The filter entry of the command at an offset of a stream, or null
 *
 * @param  {Uint8Array}   bytes    The stream
 * @param  {number}       offset   Where ESCPost stopped
 * @return {object|null}           The entry of FILTERS that matches there
 */
function filterAt(bytes, offset) {
  return FILTERS.find((entry) =>
    entry.bytes.every((byte, index) => bytes[offset + index] === byte)) || null;
}

export const name = 'escpost';

export const version = '0.2.1 (c4a7665)';

export const kind = 'image';

/** The profiles of ESCPost, by the print width of the fixture */

const PROFILES = {576: 'REFERENCE', 384: 'NT-5890K'};

/**
 * @typedef {import('./shared.js').Reference} Reference
 */

/**
 * Where the binary is, or an empty string
 *
 * @return {string}   The path
 */
export function binary() {
  return locate([
    process.env.RENDERER_ESCPOST,
    path.join(references, 'escpost-bin'),
    path.join(references, 'escpost', 'target', 'debug', 'escpost'),
    path.join(references, 'escpost', 'target', 'release', 'escpost'),
  ]);
}

/**
 * Stack the sheets of a render into one bitmap, in the order they came out
 *
 * @param  {object[]}   sheets   The bitmaps
 * @return {object}              One bitmap
 */
function stack(sheets) {
  const width = Math.max(...sheets.map((sheet) => sheet.width));
  const height = sheets.reduce((total, sheet) => total + sheet.height, 0);
  const result = Bitmap.create(width, height);

  let offset = 0;

  for (const sheet of sheets) {
    Bitmap.blit(sheet, result, 0, offset);
    offset += sheet.height;
  }

  return result;
}

/**
 * What ESCPost makes of one fixture
 *
 * @param  {object}              fixture   The fixture: library, name, input and provenance
 * @param  {object}              target    Where the render goes: directory and the path in the page
 * @return {Promise<Reference>}            The reference
 */
export async function reference(fixture, target) {
  const scope = outOfScope(fixture);

  if (scope) {
    return unavailable(name, version, scope);
  }

  const tool = binary();

  if (!tool) {
    return unavailable(name, version, 'no escpost binary, see tools/contact-sheet/references/escpost.js');
  }

  const profile = PROFILES[fixture.provenance.width] || 'REFERENCE';
  const output = path.join(target.directory, `${fixture.name}.escpost`);

  fs.rmSync(output, {recursive: true, force: true});

  const args = [
    'render', fixture.input,
    '--format', 'binary',
    '--profile', profile,
    '--non-interactive',
    '--no-antialias',
    '--output-dir', output,
  ];

  let command = `${path.relative(root, tool) || tool} ${args.join(' ')}`;
  let result = await run(tool, args);

  /* The pre-filter: while ESCPost names a command of the table, remove it and
     try again with the filtered stream, which is a file next to the sheets */

  const refused = result.code !== 0 ? (result.stderr || result.error).trim() : '';
  const removed = [];

  if (refused) {
    let bytes = new Uint8Array(fs.readFileSync(fixture.input));
    const filtered = path.join(target.directory, `${fixture.name}.escpost.filtered.bin`);

    while (result.code !== 0 && removed.length < FILTER_LIMIT) {
      const match = REFUSAL.exec(result.stderr || result.error);
      const entry = match ? filterAt(bytes, Number(match[1])) : null;

      if (!entry) {
        break;
      }

      const offset = Number(match[1]);
      const length = typeof entry.length === 'function' ? entry.length(bytes, offset) : entry.length;

      bytes = new Uint8Array([...bytes.subarray(0, offset), ...bytes.subarray(offset + length)]);
      removed.push(entry.name);

      fs.writeFileSync(filtered, bytes);
      fs.rmSync(output, {recursive: true, force: true});

      args[1] = filtered;
      command = `${path.relative(root, tool) || tool} ${args.join(' ')}`;
      result = await run(tool, args);
    }
  }

  /* What the sheet says about the filter, on a render and on a refusal alike:
     the error for the stream as stored, and the commands removed, counted */

  const counts = removed.reduce((total, entry) => Object.assign(total, {[entry]: (total[entry] || 0) + 1}), {});
  const removals = Object.entries(counts)
      .map(([entry, count]) => count > 1 ? `${entry} ×${count}` : entry).join(', ');

  if (result.code !== 0) {
    const final = (result.stderr || result.error).trim();
    const reason = removed.length ?
      `escpost refused the stream as stored (${refused.replace(/^error: /, '')}) and, ` +
        `after the pre-filter removed ${removals}, still refused it: ${final.replace(/^error: /, '')}` :
      `escpost render failed: ${final}`;

    return Object.assign(unavailable(name, version, reason), {command, filtered: removed});
  }

  const flag = removed.length ?
    `pre-filtered: refused as stored (${refused.replace(/^error: /, '')}); rendered after removing ${removals}` :
    '';

  const sheets = fs.existsSync(output) ?
    fs.readdirSync(output).filter((file) => file.endsWith('.png')).sort() :
    [];

  if (!sheets.length) {
    return Object.assign(unavailable(name, version, 'escpost wrote no sheet'), {command});
  }

  const bitmaps = [];

  for (const sheet of sheets) {
    bitmaps.push(await fromPng(new Uint8Array(fs.readFileSync(path.join(output, sheet)))));
  }

  /* ESCPost writes one sheet per cut. Since section 24 the page shows those
     sheets as the pieces of paper they are, next to our own render split at
     its cuts; the stacked bitmap below is what the agreement metric compares,
     so a receipt with cuts is measured whole and not as its first sheet */

  const bitmap = bitmaps.length === 1 ? bitmaps[0] : stack(bitmaps);
  const file = `${fixture.name}.escpost.png`;

  fs.writeFileSync(path.join(target.directory, file), await toPng(bitmap));

  return {
    tool: name,
    version,
    available: true,
    reason: '',
    kind: 'image',
    file: path.join(target.prefix, file),
    files: sheets.map((sheet) => path.join(target.prefix, `${fixture.name}.escpost`, sheet)),
    bitmap,
    note: sheets.length > 1 ? `${sheets.length} sheets` : '',
    flag,
    filtered: removed,
    command: `${command}, profile ${profile}`,
  };
}
