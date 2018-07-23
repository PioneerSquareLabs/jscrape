#!/usr/bin/env node

//
// Process command line options
//
let program = require("commander");
const path = require("path");

program
  .version("0.0.7")
  .option(
    "-s, --scraper [scraper]",
    "File and export from a runner module. Ex: foo/scraper.Scraper"
  )
  .option(
    "-r, --runner [runner]",
    "File and export from a runner module. Ex: foo/runner.Runner"
  )
  .option("-v, --visible", "Show Chromium when scraping")
  .option("-s, --slow", "Run the scrape in slow motion")
  .option("-x, --nosandbox", "Disable Chromium's sandbox capabilities")
  .option("-c, --nocookies", "Clear cookies prior to every page load")
  .option("-h, --nocache", "Clear browser cache prior to every page load")
  .option("-b, --browserconsole", "Emit console logs from the browser context")
  .option("-p, --proxy [proxy]", "Optional URL for an HTTP proxy")
  .option(
    "-a, --auth [auth]",
    "Optional proxy authorization in the form USER:PASS"
  )
  .option("-i, --noimages", "Disable loading of all images")
  .option("-d, --noads", "Disable ads and trackers using recent-ish blocklists")
  .option("-u, --url [url]", "An optional URL from which to start scraping")
  .option(
    "-t, --throttle [ms]",
    "If provided, perform at most one page load in the given timeframe"
  )
  .option("-z, --ztest", "Run jscrape in test mode")
  .parse(process.argv);

if (!program.scraper) {
  console.error(
    "Specify the name of a scraper with, for example, --scraper foo/scraper.Scraper\n" +
      "(This will load the Scraper export from foo/scraper.js)"
  );
  process.exit(1);
}

// Catch all unhandled promise rejections and bail out with gusto
process.on("unhandledRejection", error => {
  console.error(
    `jscrape: Encountered an unhandled promise rejection: ${error}. Bailing.`
  );
  console.error(error);
  process.exit(1);
});

let proxyOptions = null;
if (program.proxy) {
  proxyOptions = {};
  proxyOptions.url = program.proxy;
  proxyOptions.auth = program.auth || null;
}

const runnerOptions = {
  headless: !Boolean(program.visible),
  sandbox: !Boolean(program.nosandbox),
  images: !Boolean(program.noimages),
  ads: !Boolean(program.noads),
  slow: Boolean(program.slow),
  throttle: program.throttle || 0,
  browserConsole: Boolean(program.browserconsole),
  proxy: proxyOptions,
  clearCookies: !Boolean(program.nocookies),
  clearCache: !Boolean(program.nocache)
};

const isModuleError = error => {
  // TODO remove this HACK HACK
  return error.toString().includes("Cannot find module");
};

// Helper routine to instantiate a named class with arbitrary arguments:
const newClass = (moduleAndClassName, defaultClassName, ...args) => {
  const splits = moduleAndClassName.split(".");
  const moduleName =
    splits.length > 1 ? splits.slice(0, -1).join(".") : splits[0];
  const className =
    splits.length > 1 && splits[splits.length - 1] != "js"
      ? splits[splits.length - 1]
      : defaultClassName;
  let module = null;
  try {
    // Assume the module is in our load path by default...
    module = require(moduleName);
  } catch (error) {
    // TODO XXX this logic is garbage -Dave

    // Particularly when we're actively developing jscrape, an error here
    // could indicate a bug in jscrape's code itself. For now, try to
    // discern the difference and explode with prejudice if it's a bug in
    // jscrape.
    if (!isModuleError(error)) {
      throw error;
    }

    // ...blew up? Try to load it another way.
    const cwdModuleName = path.join(process.cwd(), moduleName);
    module = require(cwdModuleName);
  }
  const instance = new module[className](...args);
  return instance;
};

// Load the specified Runner instance.
program.runner = program.runner || "@pioneersquare/jscrape";
console.error(`jscrape: loading runner from ${program.runner}`);
let runner = null;

if (program.ztest) {
  const module = require("../lib/runners.js");
  runner = new module.Runner(runnerOptions);
} else {
  runner = newClass(program.runner, "Runner", runnerOptions);
}

// Load the specified Scraper instance.
console.error(`jscrape: loading scraper from ${program.scraper}`);
const scraper = newClass(
  program.scraper,
  "Scraper",
  runner,
  program.url || null
);

// Run that puppy
console.error(`jscrape: running...`);
const promise = runner.run(scraper);

// Wait.
promise
  .then(value => {
    if (value) {
      console.error(`jscrape: runner returned ${value}`);
    } else {
      console.error(`jscrape: runner exited successfully`);
    }
    process.exit(0);
  })
  .catch(error => {
    console.error("jscrape: runner raised an error:", error);
    process.exit(1);
  });
