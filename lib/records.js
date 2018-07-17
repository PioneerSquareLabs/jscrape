/**
 * @file
 * A Record is the fundamental unit of data emitted by a Scraper.
 *
 * Records are data objects coupled with a single validate() method
 * to ensure that their contents are valid according to some criterion.
 *
 * It's up to you to derive from Record and support a schema type of your
 * choosing.
 */
const errors = require("./errors");
const utils = require("./utils");

class RecordError extends errors.BaseError {}
exports.RecordError = RecordError;

/**
 * @description A single data record, capable of validating itself.
 */
class Record {
  /**
   * @description Validate the record, raising a RecordError on failure.
   *
   * This should be called before serializing the record.
   */
  validate() {}
}
exports.Record = Record;
