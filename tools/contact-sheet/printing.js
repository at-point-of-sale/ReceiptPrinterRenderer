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

/**
 * The style of the header and of what printing adds to a card
 *
 * @return {string}   The CSS
 */
export function styles() {
  return `
  header { position: sticky; top: 0; z-index: 2; margin: -2rem -2rem 1.5rem; padding: .75rem 2rem;
    background: #fff; border-bottom: 1px solid #ccc; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  header .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  header label { color: #666; }
  header select, header input, header button { font: inherit; padding: .25rem .5rem; }
  header button { cursor: pointer; }
  header button:disabled { cursor: default; opacity: .5; }
  header .note { color: #666; margin: .5rem 0 0; max-width: 60rem; }
  header .status { margin: .5rem 0 0; font-family: ui-monospace, monospace; }
  header .status.on { color: #1b5e20; }
  header .status.off { color: #666; }
  header .status.error { color: #b71c1c; }
  .print { margin-top: .75rem; display: flex; gap: .5rem; align-items: center; }
  .print button { font: inherit; padding: .25rem .75rem; cursor: pointer; }
  .print button:disabled { cursor: default; opacity: .5; }
  .print .result { font-family: ui-monospace, monospace; color: #666; }
  .print .result.error { color: #b71c1c; }
  .language { color: #666; font-family: ui-monospace, monospace; }`;
}

/**
 * The sticky header: the driver, the connection and the language filter
 *
 * @param  {object[]}   found       What drivers() returned
 * @param  {string[]}   languages   The languages the fixtures of the sheet are in
 * @return {string}                 The HTML
 */
export function header(found, languages) {
  const options = found.map((driver) =>
    `<option value="${driver.id}"${driver.available ? '' : ' disabled'}>${driver.label}${
      driver.available ? '' : ' (not installed)'}</option>`).join('\n    ');

  const filter = ['all'].concat(languages).map((language) =>
    `<option value="${language}">${language}</option>`).join('\n    ');

  const versions = found.map((driver) =>
    `${driver.label} ${driver.available ? driver.version : 'not installed'}`).join(', ');

  return `<header>
  <div class="row">
    <label for="driver">Printer</label>
    <select id="driver">
    ${options}
    </select>
    <span id="serial-settings" hidden>
      <label for="baudrate">Baud rate</label>
      <input id="baudrate" type="number" value="${BAUD_RATE}" min="300" max="4000000" step="100" size="8">
    </span>
    <button id="connect">Connect</button>
    <button id="disconnect" disabled>Disconnect</button>
    <span style="margin-left:auto"></span>
    <label for="language">Show</label>
    <select id="language">
    ${filter}
    </select>
  </div>
  <p class="status off" id="status">Not connected.</p>
  <p class="note">The drivers are constructed without a renderer, so they report the raw protocol of the
  printer and pass the bytes of a fixture through as they are stored: bytes are sent as stored, choose
  fixtures whose language your printer speaks. The filter above is there for that. Web USB and Web Serial
  need a secure context, so open this page over <code>npm run contact-sheet:serve</code> at
  <code>http://localhost:8080</code>; opening <code>index.html</code> from the file system shows everything
  but cannot connect. Drivers in this page: ${versions}.</p>
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

let printer = null;
let device = null;

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

  report('Connected: ' + describe(event), 'on');

  connect.disabled = true;
  disconnect.disabled = false;
  driver.disabled = true;
  baudrate.disabled = true;

  for (const button of document.querySelectorAll('.print button')) {
    button.disabled = false;
  }
}

function disconnected() {
  printer = null;
  device = null;

  report('Not connected.', 'off');

  connect.disabled = false;
  disconnect.disabled = true;
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
       come back here as a connect() that resolved without an event */

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

/* The filter. A fixture is sent as it is stored, so the sheet can be narrowed
   to the language of the printer that is attached, and a library that has
   nothing in that language disappears with its heading. */

function filter() {
  for (const section of document.querySelectorAll('section[data-language]')) {
    section.hidden = language.value !== 'all' && section.dataset.language !== language.value;
  }

  for (const group of document.querySelectorAll('.library')) {
    group.hidden = !group.querySelector('section[data-language]:not([hidden])');
  }
}

driver.addEventListener('change', () => {
  serial.hidden = driver.value !== 'serial';
});

language.addEventListener('change', filter);
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
