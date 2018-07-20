/**
 * @file
 * A Scraper produces structured Records from a wesbite.
 *
 * Scrapers are structured as asynchronous generators. The simplest scraper
 * implements a single process method:
 *
 * async *process(browser, page) {}
 *
 * and then sets one or more URLs it would like to start with:
 *
 * Scraper.urls = ['http://foo/', 'http://bar/']
 */

const Page = require("puppeteer/lib/Page");
const { Browser } = require("puppeteer/lib/Browser");

const errors = require("./errors");
const utils = require("./utils");

/**
 * @description The base class for all scraper implementations.
 */
class Scraper {
  /**
   * @description Construct a scraper.
   * @param {string} name A unique name for the scraper. May also be set on class (MyScraper.name = "bar")
   * @param {string or Object or Array<string> or Array<object>} targets
   *    Optional list of targets to scrape. A target may be a URL string, or
   *    it may be an arbitrary object with a 'url' key that contains the
   *    associated URL to scrape.
   */
  constructor(runner, targets = null) {
    this.runner = runner;
    this.targets = targets ? utils.listify(targets) : null;
    this.name = this.constructor.scraperName || this.constructor.name;
  }

  /**
   * @description Generate the targets for the Scraper.
   *
   * Derived classes may wish to override this, for example if they wish
   * to generate targets dynamically.
   */
  async *getTargets() {
    const targets = utils.listify(
      this.targets || this.constructor.targets || null
    );
    for (const target of targets) {
      yield target;
    }
  }

  /**
   * @description Provide browser options that override the runner's default.
   */
  browserOptions() {
    return null;
  }

  /**
   * @description Enter a error-recoverable context.
   *
   * Lots of scrapers enter contexts where a failure can be recovered from.
   * By calling recoverable(), you can capture all inner errors, pass them
   * to the runner's error handler, and go about your merry way (assuming
   * the runner itself doesn't choose to blow up).
   *
   * Example:
   *
   * async *myBigLoop() {
   *   yield* this.recoverable(this.doScaryStuff, argument1);
   * }
   *
   * async *doScaryStuff(argument1) {
   *   throw new Error('Mwahaha. I blew up. Let recoverable(...) handle me.');
   * }
   */
  async *recoverable(f, ...args) {
    try {
      yield* f.bind(this)(...args);
    } catch (error) {
      // Special case: we do *not* allow ourselves to recover from session closed errors.
      if (`${error}`.includes("Session closed.")) {
        console.error(
          "jscrape: Scraper.recoverable saw nonrecoverable SESSION CLOSED."
        );
        throw error;
      }

      let url = null;
      try {
        url = await this._sniffCurrentUrl(...args);
      } catch (innerError) {
        url = null;
      }
      if (url) {
        console.error(`jscrape: Scraper.recoverable on ${url}: ${error}`);
      }
    }
  }

  /**
   * @description A HACK to determine the current URL from arbitrary arguments
   */
  async _sniffCurrentUrl(...args) {
    // TODO refactor so nonsense like this is not needed

    // extra clever HACKNOLOGY:
    // *attempt* to determine the url we're on when failing...
    let url = null;
    let page = null;
    let browser = null;

    for (const arg of args) {
      if (arg instanceof Page) {
        page = arg;
        break;
      } else if (arg instanceof Browser) {
        browser = arg;
      }
    }

    page = page || (await browser.currentPage());
    if (page) {
      url = page.url();
    }

    return url;
  }

  /**
   * @description Given a target (string or Object), get the associated URL
   */
  urlFromTarget(target) {
    let url = null;
    if (typeof target == "string") {
      // If the target is a string, just return it -- it's assumed to be the URL.
      url = target;
    } else if (typeof target == "object") {
      // If the target is an object, it must have a 'url' property.
      url = target.url;
    }
    return url;
  }

  /**
   * @description Run the scrape, using the provided puppeteer browser.
   * @param {puppeteer.Browser} browser A puppeteer Browser instance
   *
   * It's unlikely that derived classes will wish to override this.
   */
  async *scrape(browser) {
    this.browser = browser;
    for await (const target of this.getTargets()) {
      const url = this.urlFromTarget(target);
      const page = await browser.tryOpenPage(url);
      if (page) {
        yield* this.recoverable(this.process, page, target);
        await page.close();
      }
    }
  }

  /**
   * @description Process a puppeteer page, yielding data records along the way.
   * @param {puppeteer.Browser} browser A puppeteer Browser instance
   * @param {puppeteer.Page} page A puppeteer Page instance
   * @param {puppeteer.Target} string or Object The raw scrape target
   *
   * Derived classes should override this. The simplest scraper implementations
   * will yield data records, which will then be processed. More
   * sophisticated scraper implementations can also yield Action instances,
   * which manipulate the current crawl context in reversible ways and recurse.
   * But you don't need to do that! You can just emit a bunch of data, however
   * you like, and be happy.
   */
  async *process(page, target) {
    // Derived classes should probably do something here
    console.error(
      "Scraper: You should probably implement the process generator. Page = ",
      page
    );
  }
}

/**
 * @description One, or many, targets (websites) to scrape.
 *
 * This can be a String, an Array<String>, an Object, or an Array<Object>.
 *
 * If the underlying targets are strings, they're presumed to be URLs. If they're
 * Objects, they can contain arbitrary metadata about the target, but they must
 * have a 'url' property that contains the URL itself.
 */
Scraper.targets = undefined;

exports.Scraper = Scraper;
