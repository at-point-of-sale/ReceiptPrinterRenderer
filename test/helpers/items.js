/*
   The items of a render that are not images, which is what the item fixtures
   record. The paper itself is joined with the package's own stitch(), see
   src/formats/stitch.js.
*/

/**
 * The items that are not images, which is what the item fixtures record
 *
 * @param  {object[]}   items   The items of a render
 * @return {object[]}           The commands, in order
 */
export function commands(items) {
  return items
      .filter((item) => item.type !== 'image')
      .map((item) => {
        const result = {type: item.type};

        for (const property of ['value', 'device', 'on', 'off', 'height']) {
          if (typeof item[property] !== 'undefined') {
            result[property] = item[property];
          }
        }

        if (item.type === 'unknown') {
          result.data = Array.from(item.data);
        }

        return result;
      });
}

export default commands;
