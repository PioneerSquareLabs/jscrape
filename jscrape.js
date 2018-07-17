// XXX TODO think about what this needs to look like...

const errors = require("./src/errors.js");

exports.BaseError = errors.BaseError;

const processors = require("./src/processors.js");

exports.ConsoleProcessor = processors.consoleProcessor;

const records = require("./src/records.js");

exports.Record = records.Record;
exports.RecordError = records.RecordError;

const runners = require("./src/runners.js");

exports.Runner = runners.Runner;

const scrapers = require("./src/scrapers.js");

exports.Scraper = scrapers.Scraper;

const utils = require("./src/utils.js");

exports.sleep = utils.sleep;
exports.cleanWhitespace = utils.cleanWhitespace;
