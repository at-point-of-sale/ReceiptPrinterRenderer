/**
 * @typedef {import('../types.js').Layout} Layout
 * @typedef {import('../types.js').LayoutEntry} LayoutEntry
 * @typedef {import('../types.js').LineEntry} LineEntry
 * @typedef {import('../types.js').PageEntry} PageEntry
 * @typedef {import('../types.js').PageArea} PageArea
 * @typedef {import('../types.js').FeedEntry} FeedEntry
 * @typedef {import('../types.js').LineOperation} LineOperation
 * @typedef {import('../types.js').RenderLanguage} RenderLanguage
 */

/**
 * @typedef {object} CollectorOptions
 * @property {RenderLanguage} language   Language of the commands the entries came from
 * @property {number} width              Width of the paper in dots
 * @property {number} dpi                Resolution of the printer in dots per inch
 * @property {number} [cutterDistance]   Distance between the cutter and the print head in dots
 */

/* The version of the display list this collector writes */

const VERSION = 1;

/**
 * A copy of a bitmap the layout owns, so that nothing of the stream is shared
 * with the list and a consumer can keep it for as long as it likes
 *
 * @param  {object}   bitmap   The bitmap
 * @return {object}            A copy of it
 */
function copyBitmap(bitmap) {
  return {width: bitmap.width, height: bitmap.height, data: bitmap.data.slice()};
}

/**
 * A copy of the bytes something came from, two numbers the list owns
 *
 * @param  {object}   source   The range, or null
 * @return {object}            A copy of it, or null
 */
function copySource(source) {
  return source ? {offset: source.offset, length: source.length} : source;
}

/**
 * A copy of one operation of a line
 *
 * @param  {LineOperation}   operation   The operation
 * @return {LineOperation}               A copy of it
 */
function copyOperation(operation) {
  const result = Object.assign({}, operation);

  if (result.source) {
    result.source = copySource(operation.source);
  }

  if (result.cell) {
    result.cell = {width: operation.cell.width, height: operation.cell.height};
  }

  if (result.glyph) {
    result.glyph = {width: operation.glyph.width, height: operation.glyph.height};
  }

  if (result.scale) {
    result.scale = {x: operation.scale.x, y: operation.scale.y};
  }

  if (result.style) {
    result.style = Object.assign({}, operation.style);
  }

  if (result.bitmap) {
    result.bitmap = copyBitmap(operation.bitmap);
  }

  if (result.data) {
    result.data = operation.data.slice();
  }

  return result;
}

/**
 * A copy of one entry of the list
 *
 * @param  {LayoutEntry}   entry   The entry
 * @return {LayoutEntry}           A copy of it
 */
function copyEntry(entry) {
  const result = Object.assign({}, entry);

  if (result.source) {
    result.source = copySource(entry.source);
  }

  if (entry.operations) {
    result.operations = entry.operations.map(copyOperation);
  }

  if (entry.areas) {
    result.areas = entry.areas.map((area) => Object.assign({}, area, {
      entries: area.entries.map(copyEntry),
    }));
  }

  if (entry.data) {
    result.data = entry.data.slice();
  }

  return result;
}

/**
 * The collector is the sink that keeps what the layout engine emits, so that
 * `layout()` returns the display list of a stream instead of its dots. It
 * copies everything it is given, the bitmaps of the images and the downloaded
 * glyphs included, so the list owns what it holds.
 *
 * See documentation/display-list.md for the format.
 */
class Collector {
  #language;
  #width;
  #dpi;
  #cutterDistance;
  #entries;
  #height;

  /**
     * Create a collector
     *
     * @param  {CollectorOptions}   options   What the list says about the printer
     */
  constructor(options) {
    const settings = options || {};

    this.#language = settings.language;
    this.#width = settings.width;
    this.#dpi = settings.dpi;
    this.#cutterDistance = settings.cutterDistance || 0;

    this.discard();
  }

  /**
     * Keep a line box
     *
     * @param  {LineEntry}   entry   The line and its operations
     */
  line(entry) {
    this.#keep(entry);
  }

  /**
     * Keep a printed page
     *
     * @param  {PageEntry}   entry   The page and its areas
     */
  page(entry) {
    this.#keep(entry);
  }

  /**
     * Keep the rows the paper advanced without printing
     *
     * @param  {FeedEntry}   entry   The rows
     */
  feed(entry) {
    this.#keep(entry);
  }

  /**
     * Keep a command. The list is never filtered by the `commands` option of a
     * renderer: every cut, pulse, unknown and unsupported command is in it.
     *
     * @param  {object}   entry   The command and the row the paper is on
     */
  command(entry) {
    this.#entries.push(copyEntry(entry));
  }

  /**
     * The display list of this stream
     *
     * @return {Layout}   The list
     */
  end() {
    const list = {
      version: VERSION,
      language: this.#language,
      width: this.#width,
      height: this.#height,
      dpi: this.#dpi,
      entries: this.#entries,
    };

    /* The paper of a list says how far the cutter stands above the print head,
       so that a consumer that draws the list again knows which rows a command
       leaves in the printer. A printer without a distance, which is every list
       of a driver, carries no such field at all */

    if (this.#cutterDistance > 0) {
      list.cutterDistance = this.#cutterDistance;
    }

    return list;
  }

  /**
     * Throw away what this collector holds
     */
  discard() {
    this.#entries = [];
    this.#height = 0;
  }

  /**
     * Keep an entry that takes up rows of the paper, and grow the paper to hold
     * it: the height of the list is the extent of the paper, from its first row
     * to its last, which is the height stitch() gives the items of a render of
     * the same stream
     *
     * @param  {LayoutEntry}   entry   The entry
     */
  #keep(entry) {
    this.#entries.push(copyEntry(entry));
    this.#height = Math.max(this.#height, entry.y + entry.height);
  }
}

export default Collector;
export {Collector, VERSION};
