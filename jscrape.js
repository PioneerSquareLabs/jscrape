// XXX TODO think about what this needs to look like...

const errors = require("./lib/errors.js");

exports.BaseError = errors.BaseError;

const processors = require("./lib/processors.js");

exports.ConsoleProcessor = processors.consoleProcessor;

const records = require("./lib/records.js");

exports.Record = records.Record;
exports.RecordError = records.RecordError;

const runners = require("./lib/runners.js");

exports.Runner = runners.Runner;

const scrapers = require("./lib/scrapers.js");

exports.Scraper = scrapers.Scraper;

const utils = require("./lib/utils.js");

exports.sleep = utils.sleep;
exports.cleanWhitespace = utils.cleanWhitespace;
