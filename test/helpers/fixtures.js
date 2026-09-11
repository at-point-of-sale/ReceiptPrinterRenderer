import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import Bitmap from '../../src/bitmap.js';

/* The fixtures of test/tools/make-fixtures.js: the bytes of a receipt, the
   paper it renders to, and the items that are not images */

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * Read a binary PBM file
 *
 * @param  {Uint8Array}   data   The contents of the file
 * @return {object}              The bitmap
 */
export function fromPbm(data) {
  const fields = [];

  let index = 0;

  /* The header is the magic number, the width and the height, separated by
     whitespace, and the body starts right after the whitespace that follows
     the height */

  while (fields.length < 3) {
    const end = data.indexOf(0x0a, index);

    if (end < 0) {
      throw new Error('Not a PBM file');
    }

    const line = new TextDecoder().decode(data.subarray(index, end));

    fields.push(...line.split(/\s+/).filter((value) => value.length));
    index = end + 1;
  }

  if (fields[0] !== 'P4') {
    throw new Error('Not a binary PBM file');
  }

  const width = parseInt(fields[1], 10);
  const height = parseInt(fields[2], 10);

  const bitmap = Bitmap.create(width, height);
  const body = data.subarray(index, index + bitmap.data.length);

  if (body.length < bitmap.data.length) {
    throw new Error(`PBM file of ${width} by ${height} is ${bitmap.data.length - body.length} bytes short`);
  }

  bitmap.data.set(body);

  return bitmap;
}

/**
 * The names of the fixtures of a language
 *
 * @param  {string}     language   Name of the directory, 'esc-pos'
 * @return {string[]}              The names, sorted
 */
export function names(language) {
  return fs.readdirSync(path.join(directory, language))
      .filter((file) => file.endsWith('.bin'))
      .map((file) => file.slice(0, -4))
      .sort();
}

/**
 * One fixture
 *
 * @param  {string}   language   Name of the directory, 'esc-pos'
 * @param  {string}   name       Name of the fixture
 * @return {object}              The bytes, the expected paper and the expected commands
 */
export function fixture(language, name) {
  const file = (extension) => path.join(directory, language, `${name}.${extension}`);

  return {
    name,
    bytes: new Uint8Array(fs.readFileSync(file('bin'))),
    paper: fromPbm(new Uint8Array(fs.readFileSync(file('pbm')))),
    commands: JSON.parse(fs.readFileSync(file('items.json'), 'utf8')),
  };
}
