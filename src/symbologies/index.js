import {ean13, ean8} from './ean.js';
import {upca, upce} from './upc.js';
import {code39} from './code39.js';
import {itf} from './itf.js';
import {codabar} from './codabar.js';
import {code93} from './code93.js';
import {code128, code128auto, gs1128} from './code128.js';

/**
 * @typedef {import('./pattern.js').Barcode} Barcode
 */

/*
    The one dimensional symbologies, by the names the encoder uses for them. A
    generator takes the data of the barcode and returns its module widths and
    the text a printer puts below the bars, or null when the data is not valid
    for the symbology, which a printer answers by printing nothing.
*/

const SYMBOLOGIES = {
  'upca': upca,
  'upce': upce,
  'ean13': ean13,
  'ean8': ean8,
  'code39': code39,
  'itf': itf,
  'codabar': codabar,
  'code93': code93,
  'code128': code128,
  'gs1-128': gs1128,
  'code128-auto': code128auto,
};

/**
 * Whether a symbology is one this package can draw
 *
 * @param  {string}    symbology   Name of the symbology
 * @return {boolean}               True when it is
 */
export function supports(symbology) {
  return Object.prototype.hasOwnProperty.call(SYMBOLOGIES, symbology);
}

/**
 * Encode a barcode
 *
 * @param  {string}         symbology   Name of the symbology
 * @param  {string}         data        The value of the barcode
 * @return {Barcode|null}               The barcode, or null when the data is not valid
 */
export function barcode(symbology, data) {
  if (!supports(symbology)) {
    return null;
  }

  return SYMBOLOGIES[symbology](data);
}

export {SYMBOLOGIES};
export {qrcode} from './qrcode.js';
