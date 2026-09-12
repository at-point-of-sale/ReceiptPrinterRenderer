import * as thermal from './thermal.js';
import * as escpost from './escpost.js';

/*
    The reference renderers of section 16b, in the order the contact sheet shows
    them. Both produce an image, which is what the agreement metric needs: a
    renderer that produces markup says nothing about whether the paper agrees,
    see the notes of the section.

    Every module says what it is, where it looks for its tool and what it runs,
    in its own header. None of them is needed by npm test, none of them is a
    runtime dependency, and a machine without any of them builds the same sheet
    with "not available" in their place.
*/

export const modules = [thermal, escpost];

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
