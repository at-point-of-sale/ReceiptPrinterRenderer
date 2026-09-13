/*
   The display list as JSON, so that a golden layout can be frozen next to a
   fixture and read back. Everything of a list is JSON already except the
   bitmaps, which become base64: the data of an image operation, the dots of a
   downloaded glyph and the bytes of an unknown command.
*/

/**
 * Base64 of a byte array, without the APIs of one platform
 *
 * @param  {Uint8Array}   data   The bytes
 * @return {string}              The base64
 */
function encodeBase64(data) {
  let binary = '';

  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }

  /* eslint-disable no-undef */
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(data).toString('base64');
  /* eslint-enable no-undef */
}

/**
 * The bytes of a base64 string
 *
 * @param  {string}       value   The base64
 * @return {Uint8Array}           The bytes
 */
function decodeBase64(value) {
  /* eslint-disable no-undef */
  const binary = typeof atob === 'function' ? atob(value) : Buffer.from(value, 'base64').toString('binary');
  /* eslint-enable no-undef */

  const result = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    result[index] = binary.charCodeAt(index);
  }

  return result;
}

/**
 * A display list as plain JSON data, with every byte array as base64
 *
 * @param  {object}   value   The list, or a part of it
 * @return {object}           The same thing without typed arrays
 */
export function toJson(value) {
  if (value instanceof Uint8Array) {
    return encodeBase64(value);
  }

  if (Array.isArray(value)) {
    return value.map(toJson);
  }

  if (value && typeof value === 'object') {
    const result = {};

    for (const key of Object.keys(value)) {
      result[key] = toJson(value[key]);
    }

    return result;
  }

  return value;
}

/**
 * A display list read back from JSON, with the base64 of every byte array
 * turned back into bytes
 *
 * @param  {object}   value   The JSON data, or a part of it
 * @return {object}           The list
 */
export function fromJson(value) {
  if (Array.isArray(value)) {
    return value.map(fromJson);
  }

  if (value && typeof value === 'object') {
    const result = {};

    for (const key of Object.keys(value)) {
      result[key] = key === 'data' && typeof value[key] === 'string' ?
        decodeBase64(value[key]) :
        fromJson(value[key]);
    }

    return result;
  }

  return value;
}

export default toJson;
