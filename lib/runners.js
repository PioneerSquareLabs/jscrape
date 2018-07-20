/**
 * @file
 * Runners provide an environment in which scrapers can execute to completion.
 *
 * Runners construct and invoke Scrapers, collecting the Records they emit
 * and (optionally) passing them through an abitrary set of Processors.
 *
 * Right now, we only offer a simple runner that keeps our work in a single
 * process, but you can imagine arbitrarily complex runners that farm out work
 * to a set of processes across a cluster of machines.
 */

// XXX after revisiting this today, I'm pretty sure the options management code
// is hot spaghetti nonsense. NEEDS IMMEDIATE CLEANUP. -Dave 7/2/2018

const puppeteer = require("puppeteer");

const errors = require("./errors");
const processors = require("./processors");
const proxies = require("./proxies");
const records = require("./records");
const utils = require("./utils");

const fs = require("fs");
const path = require("path");
const rp = require("request-promise-native");
const { AdBlockClient, FilterOptions } = require("ad-block");

/**
 * @description Provides an environment for and executes scrapers to completion.
 */
class Runner {
  /**
   * @description Create a runner with one or more scrapers.
   * @param {Object} options Options for puppeteer.
   * @param {boolean} options.headless If true, run the browser in headless mode. (Default: true).
   * @param {boolean} options.images If true, allow the browser to load images. (Default: true)
   * @param {boolean} options.ads If true, allow the browser to load ad-like things. (Default: true)
   * @param {boolean} options.browserConsole If true, capture and emit console.logs from the browser context. (Default: false).
   * @param {boolean} options.sandbox If true, run chromium sandboxed. (Default: true).
   * @param {boolean} options.throttle If provided, limit page loads to one per throttle milliseconds. (Default: 0).
   * @param {string} options.userAgent If provided, override the default user agent.
   * @param {number} options.navigationTimeout If provided, override the default navigation timeout.
   * @param {number} options.hardTimeout If provided, override the default result timeout of 10 minutes. A new result must be produced in this amount of time.
   * @param {boolean} options.slow If true, run chromium slowly. (Default: false).
   * @param {Object} options.proxy If provided, override various proxy settings.
   * @param {string} options.proxy.url If provided, the URL for a proxy to scrape through
   * @param {string} options.proxy.auth If provided, an auth string to use for HTTP Proxy Authentication
   * @param {boolean} options.clearCookies If true, remove cookies prior to every page load. (Default: false)
   * @param {boolean} options.clearCache If true, clear cache prior to every page load.
   */
  constructor(options = {}) {
    this.defaultProcessor = new processors.ConsoleProcessor();
    this.processors = {};
    this._headless = utils.boolify(options.headless, true);
    this._sandbox = utils.boolify(options.sandbox, true);
    this._slow = utils.boolify(options.slow, false);
    this._ads = utils.boolify(options.ads, true);
    this._adclient = null;
    this._proxy = options.proxy || null;
    this._hardTimeout =
      options.hardTimeout == null ? 600000 : options.hardTimeout; // Must see new results within 10 minutes of previous, or we tear down the process.
    this._browserOptions = options;
  }

  /**
   * @description The primary entry point to running scrapers.
   *
   * @param {jscrape.Scraper or Array[jscrape.Scraper]} scrapers The scrapers to run.
   */
  async run(scrapers) {
    // build ad blocklist, if requested
    if (!this._ads) {
      this._adclient = await this.buildAdClient();
      this._browserOptions.adclient = this._adclient;
    }

    // open processors
    await this.defaultProcessor.open();
    for (const processorName in this.processors) {
      await this.processors[processorName].open();
    }

    // run the scrapers
    const scraperList = utils.listify(scrapers);
    for (const scraper of scraperList) {
      await this.runScraper(scraper, scraper.browserOptions());
    }

    // close processors
    for (const processorName in this.processors) {
      await this.processors[processorName].close();
    }
    await this.defaultProcessor.close();
  }

  /**
   * @description Load uBlock origin block lists into a bloom filter.
   */
  async buildAdClient() {
    console.error("jscrape: Loading blocklists...");
    const client = new AdBlockClient();
    const blocklistList = path.join(__dirname, "./blocklists.json");
    const blocklists = JSON.parse(fs.readFileSync(blocklistList));
    for (const blocklist of blocklists) {
      console.error(`jscrape: Downloading ${blocklist.title}...`);
      const list = await rp(blocklist.url);
      console.error(`jscrape: Processing ${blocklist.title}...`);
      client.parse(list);
    }
    console.error("jscrape: All blocklists processed.");
    return client;
  }

  /**
   * @description Launch chromium.
   */
  async launchBrowser(browserOptions = {}) {
    const chromeArgs = ["--disable-dev-shm-usage"];

    if (!this._sandbox) {
      chromeArgs.push("--no-sandbox", "--disable-setuid-sandbox");
    }

    const useProxy = Boolean(this._proxy && this._proxy.url);
    if (useProxy) {
      chromeArgs.push(`--proxy-server=${this._proxy.url}`);
    }

    const launchArgs = {
      headless: this._headless,
      args: chromeArgs,
      // CONSIDER having a separate ignore HTTPS option? It's ugly, this.
      ignoreHTTPSErrors: useProxy
    };

    if (this._slow) {
      launchArgs.slowMo = 250;
    }

    const browser = await puppeteer.launch(launchArgs);

    const finalBrowserOptions = utils.merge(
      this._browserOptions,
      browserOptions
    );
    return proxies.browserProxy(browser, finalBrowserOptions);
  }

  /**
   * @description Get a processor (or the default) for a given record type.
   */
  getProcessorFor(record) {
    return this.processors[record.constructor.name] || this.defaultProcessor;
  }

  /**
   * @description Wrapper around scraper.scrape() that catches all exceptions.
   */
  async *getScraperItems(browser, scraper) {
    const makeHardTimeout = () => {
      return setTimeout(() => {
        // This error will throw outward and tear down the containing
        // node process.
        throw new errors.BaseError(
          `Runner.getScraperItems: hardTimeout of ${
            this._hardTimeout
          } was hit. Hard bailing on scraper.`
        );
      }, this._hardTimeout);
    };

    try {
      let timeout = this._hardTimeout ? makeHardTimeout() : null;

      for await (const item of scraper.scrape(browser)) {
        if (this._hardTimeout) {
          clearTimeout(timeout);
        }
        yield item;
        if (this._hardTimeout) {
          timeout = makeHardTimeout();
        }
      }

      if (this._hardTimeout) {
        clearTimeout(timeout);
      }
    } catch (error) {
      this.handleUnwrappedError(error);
    }
  }

  /**
   * @description Run a scraper, pipelining scraped data to our processor.
   */
  async runScraper(scraper, browserOptions = {}) {
    const browser = await this.launchBrowser(browserOptions);

    for await (const item of this.getScraperItems(browser, scraper)) {
      // Scrapers can yield any type they like, typically bare
      // objects like { name: 'value' }. If we see bare values,
      // we wrap them in the base Record class.
      //
      // More advanced scrapers can yield their own Record types,
      // which can have advanced cleaning/post-processing methods on them.
      let record = item;

      // Wrap bare values.
      if (!(item instanceof records.Record)) {
        record = Object.assign(new records.Record(), item);
      }

      // Validate the record.
      try {
        record.validate();
      } catch (error) {
        this.handleUnwrappedError(error);
      }

      // Process the record.
      const processor = this.getProcessorFor(record);
      try {
        await processor.process(record);
      } catch (error) {
        this.handleUnwrappedError(error);
      }
    }

    await browser.close();

    return true;
  }

  /**
   * @description Process an arbitrary javascript error.
   */
  handleUnwrappedError(error, url = null) {
    // Handle any errors, wrapping them in ScrapeError if they
    // don't happen to fit.
    let wrapped = utils.wrappedError(errors.BaseError, error);
    this.handleError(wrapped, url);
  }

  /**
   * @description Process a ScrapeError instance.
   *
   * By default, just raises it outward; derived runners can do as they please.
   */
  handleError(error, url = null) {
    throw error;
  }
}

exports.Runner = Runner;
