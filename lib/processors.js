/**
 * @file
 * Defines the API by which data records are processed after being scraped.
 */

const fs = require("fs");

const errors = require("./errors");
const utils = require("./utils");

class ProcessorError extends errors.BaseError {}
exports.ProcessorError = ProcessorError;

/**
 * @description A base class capable of processing arbitrary data Records.
 */
class Processor {
  constructor() {}

  /**
   * @description Perform any necessary actions to prepare for processing.
   */
  async open() {
    // intentional no-op
  }

  async process(item) {
    // intentional no-op
  }

  /**
   * @description Perform any necessary actions to finalize processing.
   */
  async close() {
    // intentional no-op
  }
}
exports.Processor = Processor;

/**
 * @description A processor that simply emits items as JSON to the console.
 */
class ConsoleProcessor extends Processor {
  constructor() {
    super();
  }

  async process(item) {
    console.log(JSON.stringify(item));
  }
}
exports.ConsoleProcessor = ConsoleProcessor;

/**
 * @description An abstract processor that emits items to a local file.
 */
class LocalFileProcessor extends Processor {
  constructor(path, options = {}) {
    super();
    this.path = path;
    this.options = options;
    this.stream = null;
  }

  async open() {
    if (this.stream) {
      throw ProcessorError(
        `Attempted to open an already-opened LocalFileProcessor with path ${
          this.path
        }.`
      );
    }
    this.stream = fs.createWriteStream(path, options);
  }

  async process(item) {
    if (!this.stream) {
      throw ProcessorError(
        `Attempted to write an un-opened LocalFileProcessor with path ${
          this.path
        }.`
      );
    }

    // intentional no-op
  }

  async close() {
    if (!this.stream) {
      throw ProcessorError(
        `Attempted to close an un-opened LocalFileProcessor with path ${
          this.path
        }.`
      );
    }
    this.stream.end();
    this.stream = null;
  }
}
exports.LocalFileProcessor = LocalFileProcessor;

/**
 * @description Emits items as JSONLines to a local file.
 */
class JSONLinesProcessor extends LocalFileProcessor {
  async process(item) {
    super.process(item);
    this.stream.write(`${JSON.stringify(item, null, 2)}\n`);
  }
}
exports.JSONLinesProcessor = JSONLinesProcessor;

/**
 * @description Emits items as CSV lines to a local file.
 */
class CSVProcessor extends LocalFileProcessor {
  constructor(path, columns, options = {}) {
    super(path, options);
    this.columns = utils.listify(columns);
  }

  async open() {
    await super.open();
    this.writer = csv.stringify({ header: true, columns: columns });
    this.writer.pipe(this.stream);
  }

  async process(item) {
    super.process(item);
    this.writer.write(item);
  }

  async close() {
    this.writer.end();
    await super.close();
  }
}

/**
 * @description Delegates to any number of child processors.
 */
class DelegatingProcessor extends Processor {
  constructor(processors) {
    super();
    this.processors = utils.listify(processors);
  }

  async open() {
    for (const processor of this.processors) {
      await processor.open();
    }
  }

  async process(item) {
    for (const processor of this.processors) {
      await processor.process(item);
    }
  }

  async close() {
    for (const processor of this.processors) {
      await processor.close();
    }
  }
}
exports.DelegatingProcessor = DelegatingProcessor;
