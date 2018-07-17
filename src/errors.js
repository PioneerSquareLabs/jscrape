/**
 * @file
 * Defines a base error class used by all jscrape framework code.
 */

/**
 * @description Base class for all errors raised by jscrape.
 */
class BaseError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name || this.name;
  }
}

exports.BaseError = BaseError;
