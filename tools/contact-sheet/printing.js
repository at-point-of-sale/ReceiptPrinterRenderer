import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/*
    Printing from the contact sheet, section 16g.

    The sheet shows what this package makes of every byte stream it carries. The
    part below sends one of those streams to a printer that is attached to the
    machine the sheet is opened on, so that the paper can be held against the
    picture. It is the last check no test can make.

    The three drivers of the ecosystem are copied out of node_modules into
    build/contact-sheet/lib and loaded with a script tag, so the page stays one
    directory that can be opened from a file:// URL or served from localhost.
    They are constructed WITHOUT a renderer option on purpose: a driver with a
    renderer renders the job itself and wraps it in the raster format of the
    printer, which is exactly what this sheet is checking, so it would be
    checking itself. Without it every driver reports the language of the printer
    and passes the bytes through untouched, and a fixture has to be sent to a
    printer that speaks its language, which is what the language filter of the
    header is for.

    The bytes travel in the page. A sheet is opened from file:// as often as
    from a server and fetch() is blocked there, so every fixture carries its
    stream as base64 in one script block. That is about a megabyte for the whole
    set, which a local page can carry.
*/

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The drivers the page loads, in the order the selector lists them. The two
 * linked ones are unpublished devDependencies that resolve through npm link,
 * see the notes of section 16g.
 */

const DRIVERS = [
  {
    id: 'usb',
    label: 'USB',
    package: '@point-of-sale/webusb-receipt-printer',
    file: 'webusb-receipt-printer.umd.js',
    global: 'WebUSBReceiptPrinter',
    feature: 'usb',
  },
  {
    id: 'serial',
    label: 'Serial',
    package: '@point-of-sale/webserial-receipt-printer',
    file: 'webserial-receipt-printer.umd.js',
    global: 'WebSerialReceiptPrinter',
    feature: 'serial',
  },
  {
    id: 'bluetooth',
    label: 'Bluetooth',
    package: '@point-of-sale/webbluetooth-receipt-printer',
    file: 'webbluetooth-receipt-printer.umd.js',
    global: 'WebBluetoothReceiptPrinter',
    feature: 'bluetooth',
  },
];

/** The default of the baud rate field, which is the default of the driver */

const BAUD_RATE = 9600;

/**
 * Copy the UMD build of every driver into the sheet and report what was found.
 * A driver that is not installed is reported rather than thrown: the sheet
 * builds on a machine without the links, it only cannot print there.
 *
 * @param  {string}     target   The build directory of the sheet
 * @return {object[]}            One entry per driver, with its version and whether it is there
 */
export function drivers(target) {
  const directory = path.join(target, 'lib');

  fs.mkdirSync(directory, {recursive: true});

  return DRIVERS.map((driver) => {
    const installed = path.join(root, 'node_modules', ...driver.package.split('/'));
    const source = path.join(installed, 'dist', driver.file);
    const manifest = path.join(installed, 'package.json');

    if (!fs.existsSync(source)) {
      return Object.assign({available: false, version: '', reason: `${source} is not there`}, driver);
    }

    fs.copyFileSync(source, path.join(directory, driver.file));

    return Object.assign({
      available: true,
      reason: '',
      version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version,
    }, driver);
  });
}

/**
 * The script tags that load the drivers
 *
 * @param  {object[]}   found   What drivers() returned
 * @return {string}             The HTML
 */
export function scripts(found) {
  return found
      .filter((driver) => driver.available)
      .map((driver) => `<script src="lib/${driver.file}"></script>`)
      .join('\n');
}

/* The chevron of the playground's selects, its SVG as a data URI */

const CHEVRON = 'url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHg9IjBweCIgeT0iMH' +
  'B4IiB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCI+CjxwYXRoIGZpbGw9IiMyMTk2RjMiIGQ9Ik00My' +
  'AxNy4xTDM5LjkgMTQgMjQgMjkuOSA4LjEgMTQgNSAxNy4xIDI0IDM2eiI+PC9wYXRoPgo8L3N2Zz4=)';

/**
 * The style of the header and of what printing adds to a card
 *
 * @return {string}   The CSS
 */
export function styles() {
  return `
  header { position: sticky; z-index: 2; display: flex; box-sizing: border-box;
    top: 0; height: 61px; padding: 0 0 0 15px; background: #eee; border-bottom: 1px solid #ddd; }
  header select, header input, header button {
    border: none; border-radius: 6px; height: 32px; margin: 15px 15px 0 0; padding: 0 8px;
    font-family: system-ui; font-weight: 600; font-size: 10pt; background: #fff; }
  header select { appearance: none; padding: 0 28px 0 6px;
    background-image: ${CHEVRON};
    background-repeat: no-repeat; background-position: right 6px center; background-size: 16px; }
  header input { width: 6em; }
  header button { cursor: pointer; user-select: none; }
  header button:disabled { cursor: default; opacity: .5; }
  header button[hidden] { display: none; }
  header #connect { background: #bbdefb; color: #1976d2; }
  header .status { align-self: center; margin: 15px 15px 0 0; color: #888;
    font-family: var(--font-stack-mono); font-size: 11px; }
  header .status.on { color: #1976d2; }
  header .status.error { color: #b71c1c; }
  header .filters { margin-left: auto; display: flex; }
  .print { display: flex; gap: 12px; align-items: center; margin-top: -4px; }
  .print button { border: none; border-radius: 6px; height: 32px; padding: 0 12px; cursor: pointer;
    font-family: system-ui; font-weight: 600; font-size: 10pt; background: #eaeaea; }
  .print button:disabled { cursor: default; opacity: .5; }
  .print .inspect { display: inline-flex; align-items: center; height: 32px; padding: 0 12px;
    border-radius: 6px; background: #eee; color: #333; text-decoration: none; font-size: 13px; }
  .print .inspect:hover { background: #e0e0e0; }
  .print .result { font-family: var(--font-stack-mono); font-size: 11px; color: #888; }
  .print .result.error { color: #b71c1c; }
  .language { color: #666; font-family: var(--font-stack-mono); }`;
}

/**
 * The sticky header, the driver and the connection, and the toolbar under it
 * with the libraries of the sheet and the language and width filters, which
 * narrow the sheet to the fixtures a printer can take
 *
 * @param  {object[]}   found       What drivers() returned
 * @param  {string[]}   languages   The languages the fixtures of the sheet are in
 * @param  {object[]}   widths      The widths they come in, as {columns, width} pairs
 * @param  {string[]}   libraries   The libraries of the sheet, for the links
 * @return {string}                 The HTML
 */
export function header(found, languages, widths, libraries) {
  const options = found.map((driver) =>
    `<option value="${driver.id}"${driver.available ? '' : ' disabled'}>${driver.label}${
      driver.available ? '' : ' (not installed)'}</option>`).join('\n    ');

  const filter = ['<option value="all">All languages</option>'].concat(languages.map((language) =>
    `<option value="${language}">${language}</option>`)).join('\n    ');

  const sizes = ['<option value="all">All widths</option>'].concat(widths.map((size) =>
    `<option value="${size.columns}|${size.width}">${size.columns} columns, ${size.width} dots</option>`))
      .join('\n    ');

  const links = ['<option value="">Libraries</option>'].concat(libraries.map((library) =>
    `<option value="${library}">${library}</option>`)).join('\n    ');

  return `<header>
    <select id="driver">
    ${options}
    </select>
    <span id="serial-settings" hidden>
      <input id="baudrate" type="number" value="${BAUD_RATE}" min="300" max="4000000" step="100" title="Baud rate">
    </span>
    <button id="connect">Connect</button>
    <button id="disconnect" hidden>Disconnect</button>
    <span class="status off" id="status"></span>
    <span class="filters">
      <select id="library" title="Go to a library">
      ${links}
      </select>
      <select id="language" title="Language">
      ${filter}
      </select>
      <select id="width" title="Width">
      ${sizes}
      </select>
    </span>
</header>`;
}

/**
 * The bytes of every fixture, as base64 in a script block, and the script that
 * drives the header and the print buttons
 *
 * @param  {object}     bytes   The base64 of every fixture, keyed by library/name
 * @param  {object[]}   found   What drivers() returned
 * @return {string}             The HTML
 */
export function script(bytes, found) {
  const constructors = found.filter((driver) => driver.available).map((driver) =>
    `  ${driver.id}: {
    feature: '${driver.feature}',
    label: '${driver.label}',
    create: (options) => new ${driver.global}(options),
  },`).join('\n');

  return `<script id="fixtures" type="application/json">${JSON.stringify(bytes)}</script>
<script>
/*
   The page. The drivers are the UMD globals of lib/, the bytes are the base64
   of the block above, and nothing here fetches anything: a sheet opened from
   file:// has no fetch and no modules.
*/

const FIXTURES = JSON.parse(document.getElementById('fixtures').textContent);

const DRIVERS = {
${constructors}
};

const driver = document.getElementById('driver');
const baudrate = document.getElementById('baudrate');
const serial = document.getElementById('serial-settings');
const connect = document.getElementById('connect');
const disconnect = document.getElementById('disconnect');
const status = document.getElementById('status');
const language = document.getElementById('language');
const library = document.getElementById('library');
const width = document.getElementById('width');

let printer = null;
let device = null;

/* Resolved by the connected event while a connect() is in progress. The
   drivers dispatch their events through a timer, so the event arrives after
   connect() has resolved and cannot be checked right after the call */

let awaiting = null;

/* The bytes of one fixture, decoded when it is printed and not before */

function bytes(key) {
  const binary = atob(FIXTURES[key]);
  const result = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    result[i] = binary.charCodeAt(i);
  }

  return result;
}

/* What the connected event reported, as the header writes it: the fields a
   driver has, and not the ones it does not. Only USB and Bluetooth name their
   device, only a printer the driver knows reports a language, and only a
   printer the driver renders for knows how many columns it has. */

function hex(value) {
  return '0x' + value.toString(16).padStart(4, '0');
}

function describe(event) {
  const parts = ['type ' + event.type];

  if (event.productName || event.name) {
    parts.push(event.productName || event.name);
  }

  if (event.manufacturerName) {
    parts.push(event.manufacturerName);
  }

  if (!event.productName && !event.name && typeof event.vendorId === 'number') {
    parts.push('vendor ' + hex(event.vendorId) + ', product ' + hex(event.productId));
  }

  if (event.language) {
    parts.push('language ' + event.language);
  }

  if (event.codepageMapping) {
    parts.push('codepage mapping ' + event.codepageMapping);
  }

  if (typeof event.columns !== 'undefined') {
    parts.push(event.columns + ' columns');
  }

  return parts.join(', ');
}

function report(text, kind) {
  status.textContent = text;
  status.className = 'status ' + kind;
}

function connected(event) {
  device = event;

  if (awaiting) {
    awaiting();
    awaiting = null;
  }

  report('Connected: ' + describe(event), 'on');

  connect.hidden = true;
  disconnect.hidden = false;
  driver.disabled = true;
  baudrate.disabled = true;

  for (const button of document.querySelectorAll('.print button')) {
    button.disabled = false;
  }
}

function disconnected() {
  printer = null;
  device = null;

  report('', 'off');

  connect.hidden = false;
  disconnect.hidden = true;
  driver.disabled = false;
  baudrate.disabled = false;

  for (const button of document.querySelectorAll('.print button')) {
    button.disabled = true;
  }
}

async function open() {
  const selected = DRIVERS[driver.value];

  if (!selected) {
    report('The driver for ' + driver.value + ' is not in this page, see tools/contact-sheet/printing.js', 'error');
    return;
  }

  if (!(selected.feature in navigator)) {
    report(
        'This browser has no Web ' + selected.label + ' here. It needs a secure context: ' +
        'http://localhost or https, not a file:// URL.',
        'error',
    );
    return;
  }

  try {
    printer = selected.create(
        driver.value === 'serial' ? {baudRate: parseInt(baudrate.value, 10)} : {},
    );

    printer.addEventListener('connected', connected);
    printer.addEventListener('disconnected', disconnected);

    report('Connecting...', 'off');

    await printer.connect();

    /* The drivers catch what goes wrong inside connect() and log it, so a
       picker that was cancelled and a printer the driver does not know both
       come back here as a connect() that resolved without an event. The event
       of a successful connection arrives a tick later, so wait for it briefly */

    if (!device) {
      await new Promise((resolve) => {
        awaiting = resolve;
        setTimeout(resolve, 2000);
      });

      awaiting = null;
    }

    if (!device) {
      printer = null;
      report(
          'No printer: nothing was picked, or the driver does not know this device. The console says which.',
          'error',
      );
    }
  } catch (error) {
    printer = null;
    report('Could not connect: ' + error.message, 'error');
  }
}

async function close() {
  try {
    if (printer) {
      await printer.disconnect();
    }
  } catch (error) {
    report('Could not disconnect: ' + error.message, 'error');
  }

  disconnected();
}

async function print(button) {
  const result = button.parentNode.querySelector('.result');
  const data = bytes(button.dataset.fixture);

  result.className = 'result';
  result.textContent = 'sending ' + data.length + ' bytes...';

  if (!printer) {
    result.className = 'result error';
    result.textContent = 'not connected';
    return;
  }

  try {
    button.disabled = true;

    await printer.print(data);

    result.textContent = 'sent ' + data.length + ' bytes';
  } catch (error) {
    result.className = 'result error';
    result.textContent = error.message;
  } finally {
    button.disabled = !printer;
  }
}

/* The filters. A fixture is sent as it is stored, so the sheet can be
   narrowed to the language and the width of the printer that is attached, and
   a library that has nothing left disappears with its heading. */

function filter() {
  for (const section of document.querySelectorAll('section[data-language]')) {
    const size = section.dataset.columns + '|' + section.dataset.width;

    section.hidden = (language.value !== 'all' && section.dataset.language !== language.value) ||
      (width.value !== 'all' && size !== width.value);
  }

  for (const group of document.querySelectorAll('.library')) {
    group.hidden = !group.querySelector('section[data-language]:not([hidden])');
  }
}

driver.addEventListener('change', () => {
  serial.hidden = driver.value !== 'serial';
});

language.addEventListener('change', filter);
width.addEventListener('change', filter);

/* The library menu is a shortcut: choosing one scrolls to its heading, and the
   menu goes back to its label so that it can be chosen again */

library.addEventListener('change', () => {
  const heading = document.getElementById(library.value);

  if (heading) {
    heading.scrollIntoView();
  }

  library.value = '';
});
connect.addEventListener('click', open);
disconnect.addEventListener('click', close);

for (const button of document.querySelectorAll('.print button')) {
  button.addEventListener('click', () => print(button));
}

serial.hidden = driver.value !== 'serial';

filter();
</script>`;
}

export {DRIVERS, BAUD_RATE};
