#!/usr/bin/env node

import process from "node:process";

import { runCli } from "./index.js";
import { runServer } from "./server.js";

function printHelp() {
  process.stdout.write(
    `Usage:
  node src/main.js serve [--host 0.0.0.0] [--port 3000]
  node src/main.js scrape <url> [options]
  node src/main.js <url> [options]

Modes:
  serve   Start the browser-based frontend and API server.
  scrape  Run the scraper once from the command line.
`
  );
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  if (argv[0] === "serve" || argv.length === 0) {
    const serverArgs = argv[0] === "serve" ? argv.slice(1) : argv;
    await runServer(serverArgs);
    return;
  }

  if (argv[0] === "scrape") {
    await runCli(argv.slice(1));
    return;
  }

  await runCli(argv);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
