import * as thermal from './thermal.js';
import * as escpost from './escpost.js';
import * as receiptio from './receiptio.js';
import * as svg from './svg.js';

/*
    The reference renderers of section 16b, in the order the contact sheet shows
    them. Every one of them produces an image, which is what the agreement
    metric needs: a renderer that produces markup says nothing about whether the
    paper agrees, see the notes of the section.

    receiptio, of section 16f, is the odd one out and its header says so: it
    renders the document a receiptline fixture was made from and not the bytes
    of the fixture, so the page titles its column `receiptio, from the
    document`.

    svg, of section 4 of the SVG plan, is odder still: it is not another
    project's renderer at all but our own SVG output, rasterized by resvg, so
    that the vector output stands next to the dots with the number of the dots
    that agree. Its column is titled `our SVG, rasterized by resvg`.

    Every module says what it is, where it looks for its tool and what it runs,
    in its own header. None of them is needed by npm test, none of them is a
    runtime dependency, and a machine without any of them builds the same sheet
    with "not available" in their place.
*/

export const modules = [thermal, escpost, receiptio, svg];

/**
 * What every reference module made of one fixture, in the order of the list
 *
 * @param  {object}                fixture   The fixture: library, name, input and provenance
 * @param  {object}                target    Where the renders go: directory and the path in the page
 * @return {Promise<object[]>}               The references
 */
export async function references(fixture, target) {
  const result = [];

  for (const module of modules) {
    try {
      result.push(await module.reference(fixture, target));
    } catch (error) {
      result.push({
        tool: module.name,
        version: module.version,
        available: false,
        reason: `the module threw: ${error.message}`,
      });
    }
  }

  return result;
}
