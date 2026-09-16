#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {run} from '../dist/receipt-printer-renderer-cli.mjs';

/*
    The shim of the command line.

    It is the one file of the package that holds the process: it hands the
    arguments and the three standard streams to run() of src/cli.js, bundled to
    dist/receipt-printer-renderer-cli.mjs, reads the version out of the manifest
    next to it, and puts what the command returns in the exit code. Everything
    else, the arguments, the files and the errors, is in the command itself, so
    that the tests drive it over buffers without spawning anything; this file is
    what test/bin/check.js spawns once the package is built.

    The exit code is set and not thrown at process.exit(), so that whatever
    standard output still holds is flushed before the process ends, which a pipe
    into another command needs. And a pipe that is closed before the image is
    through, `| head` on a PNG, is not an error of the command: standard output
    reports it as EPIPE, and the process ends quietly on that instead of dying
    with a stack trace.
*/

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }

  throw error;
});

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, '..', 'package.json'), 'utf8'));

process.exitCode = await run(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  version: manifest.version,
});
