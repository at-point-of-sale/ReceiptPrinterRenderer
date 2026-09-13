import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/*
    The contact sheet over localhost, section 16g.

    Web USB and Web Serial are only there in a secure context, and a file:// URL
    is not one. localhost is, so the sheet is served from here rather than
    opened from the file system when a fixture has to go to a printer:

        npm run contact-sheet
        npm run contact-sheet:serve

    and then http://localhost:8080. A port of its own:

        node tools/contact-sheet/serve.js 8081

    It serves build/contact-sheet and nothing else, over the loopback interface
    only, with no directory listing and no caching, because the sheet is
    regenerated while the page is open. There is nothing to install, and nothing
    here runs during npm test.
*/

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const directory = path.join(root, 'build', 'contact-sheet');

const PORT = 8080;

const HOST = '127.0.0.1';

/** What the sheet is made of, which is all this server hands out */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The file a request asks for, or an empty string when it asks for something
 * outside the sheet
 *
 * @param  {string}   url   The URL of the request
 * @return {string}         The path of the file
 */
function resolve(url) {
  const asked = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const file = path.join(directory, asked.endsWith('/') ? `${asked}index.html` : asked);

  /* A path that climbs out of the directory is not served, whatever it points
     at: the sheet is the only thing this server knows about */

  if (!file.startsWith(directory + path.sep)) {
    return '';
  }

  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : '';
}

const server = http.createServer((request, response) => {
  const file = request.method === 'GET' || request.method === 'HEAD' ? resolve(request.url) : '';

  if (!file) {
    response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
    response.end('Not in the contact sheet\n');
    return;
  }

  const body = fs.readFileSync(file);

  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });

  response.end(request.method === 'HEAD' ? undefined : body);
});

const port = parseInt(process.argv[2], 10) || PORT;

if (!fs.existsSync(path.join(directory, 'index.html'))) {
  console.error(`There is no contact sheet in ${directory}, run npm run contact-sheet first`);
  process.exitCode = 1;
} else {
  server.listen(port, HOST, () => {
    console.log(`The contact sheet is at http://localhost:${port}/`);
    console.log('Web USB and Web Serial need this, a file:// URL is not a secure context. Stop it with ctrl-c.');
  });
}
