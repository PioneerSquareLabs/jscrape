/**
 * @file
 * Provides convenient wrappers around Google's Puppeteer APIs.
 *
 * Puppeteer's Page, Element, Frame, etc. abstractions are useful but quite
 * low level. This file provides several higher-level APIs on top of these
 * classes, to hopefully make writing Scraper classes a little bit easier.
 *
 * Under the hood, we use Javascript Proxy() objects to provide these wrappers.
 * Proxy code is full of indirection, alas, but I think we've mostly contained
 * the madness in the BaseHandler class below, and if you'd like to write
 * a custom method on (say) Page, it should be relatively easy to do so at this
 * point. I hope. -Dave
 */

const utils = require("./utils");

/**
 * Hello! We're using Javascript Proxy() objects to provide nice wrappers
 * around puppeteer Page and ElementHandle instances, and maybe more in the
 * future. Proxy code can get a bit hard to follow, so hopefully the
 * documentation is useful here... -Dave
 */

/**
 * @description Proxy a puppeteer Browser object.
 * @param {Object} options Options for each page.
 * @param {boolean} options.browserConsole If true, capture and emit from the browser context. (Default: false).
 * @param {string} options.userAgent If provided, override the default user agent.
 * @param {number} options.navigationTimeout If provided, override the default navigation timeout.
 * @param {number} options.waitTimeout If provided, override the default wait timeout.
 * @param {Array<string>} options.waitUntil If provided, override the default navigation waitUntil.
 * @param {number} options.throttle If provided, override the default throttling time.
 *
 */
const browserProxy = (browser, options = {}) => {
  return new Proxy(browser, new BrowserHandler(options));
};
exports.browserProxy = browserProxy;

/**
 * @description Proxy a puppeteer Page object.
 */
const pageProxy = (page, options = {}, browserHandler) => {
  return new Proxy(page, new PageHandler(options, browserHandler));
};
exports.pageProxy = pageProxy;

/**
 * @description Proxy a puppeteer Frame object.
 */
const frameProxy = frame => {
  return new Proxy(frame, new FrameHandler());
};

/**
 * @description Return a function that proxies a puppeteer ElementHandle object.
 * @param {puppeteer.Page} page The page from which the ElementHandle came.
 *
 * This is a bit confusing, because to provide meaningful convenience methods on
 * an ElementHandle, you need to know the Page it came from too. Hence, we
 * return a function that proxies an ElementHandle *for a given page*.
 */
const elementHandleProxy = page => {
  const impl = elementHandle => {
    return new Proxy(elementHandle, new ElementHandleHandler(page));
  };
  return impl;
};

/**
 * @description A convient base handler for implementing proxy handler objects.
 *
 * Implementing the Handler side of an ES6 proxy turns out to be kind of a pain.
 * This BaseHandler hides most of that pain, at the cost of being somewhat
 * less flexible than a direct implementation.
 *
 * The basic idea is that you can define methods (and values) that exactly match
 * those found on the underlying class you're proxying. If you've defined them,
 * BaseHandler will invoke your implementation directly.
 *
 * @example
 * class Bar {
 *   foo(x) { return x + 42; }
 * }
 *
 * class BarHandler extends BaseHandler {
 *   foo(target, x) { return target.foo(x) - 42; } // mwahahaha
 * }
 *
 * const bar = new Bar();
 * bar.foo(0) == 42;  // true
 * const proxiedBar = Proxy(bar, new BarHandler());
 * proxiedBar.foo(0) == 0; // true
 */
class BaseHandler {
  /**
   * @description Trap for invocation of methods on the underlying proxied object.
   *
   * By default, if we implement the same method name, return our method
   * implementation. Otherwise, return the underlying object's implementation.
   */
  get(target, key) {
    let value; // undefined by default

    let localValue = this[key];
    if (localValue) {
      // Our handler defines a value for this key. It had better be a method,
      // because if it isn't, we've probably done something wrong.
      if (!(localValue instanceof Function)) {
        // Something is wrong.
        throw new Error(
          `Inside ${
            this.constructor.name
          }, got an invalid request for ${key}. Is your Handler accidentally hiding an underlying member on the target?`
        );
      }

      // Our handler defines a method for this key.  Use it to return
      // a method outward that looks identical to the method on the underlying
      // proxied object. (Fun thought exercise to check understanding: how does
      // this work when the underlying proxied method is async?)
      value = (...args) => {
        return localValue.bind(this)(target, ...args);
      };
    } else {
      // Our handler does not define a value for this key.
      // Return the proxied object's definition instead.
      value = target[key];
    }

    return value;
  }
}

/**
 * @description Handler side for a proxy on a puppeteer.ElementHandle
 */
class ElementHandleHandler extends BaseHandler {
  /**
   * @description Construct a proxy to a puppeteer.ElementHandle
   * @param {puppeteer.Page} page The puppeteer.Page from which the underlying
   *   target comes from.
   */
  constructor(page) {
    super();
    // Choose a name that will not conflict with anything in Puppeteer.
    // As it happens, we originally used _page, which Puppeteer's own
    // ElementHandles sometimes use! And that was... bad.
    this.__page__ = page;
  }

  /**
   * @description An ElementHandle.$$ method that proxies the returned ElementHandles.
   */
  async $$(elementHandle, ...args) {
    const rawElementHandles = await elementHandle.$$(...args);
    return rawElementHandles.map(elementHandleProxy(this.__page__));
  }

  /**
   * @description An ElementHandle.$ method that proxies the returned ElementHandle.
   */
  async $(elementHandle, ...args) {
    const rawElementHandle = await elementHandle.$(...args);
    let result = null;
    if (rawElementHandle) {
      result = elementHandleProxy(this.__page__)(rawElementHandle);
    }
    return result;
  }

  /**
   * @description Convenience method: return the innerText of underlying element.
   * If a selector is present, convert to a handle and get the text.
   * @return {String} The text, or an empty string if we couldn't get it.
   */
  async text(elementHandle, selector) {
    let result = null;
    let textHandle = null;

    if (selector) {
      elementHandle = await elementHandle.$(selector);
    }

    if (elementHandle) {
      textHandle = await this.__page__.evaluateHandle(
        element => element.innerText,
        elementHandle
      );
    }

    if (textHandle) {
      result = await textHandle.jsonValue();
    }

    return result || "";
  }

  /**
   * @description Return whitespace-cleaned/trimmed text, or an empty string.
   */
  async cleanText(elementHandle, selector) {
    const text = await this.text(elementHandle, selector);
    return utils.cleanWhitespace(text);
  }

  /**
   * @description Convenience method: return the value of a named property.
   * (Contrast with attr()).
   *
   * @example
   * await handle.prop('href');
   * or
   * await handle.prop('selector', 'href');
   */
  async prop(elementHandle, ...args) {
    let selector = null;
    let name = null;

    // handle two separate possible calling structures
    if (args.length == 1) {
      name = args[0];
    } else if (args.length == 2) {
      selector = args[0];
      name = args[1];
    }

    // extra convenience, to match text(...) above.
    if (selector) {
      elementHandle = await elementHandle.$(selector);
    }

    // grab the property handle
    const propertyHandle = await elementHandle.getProperty(name);

    // grab the property value
    let result = null;
    if (propertyHandle) {
      result = await propertyHandle.jsonValue();
    }
    return result;
  }

  /**
   * @description Convenience method: set the value of a named property.
   *
   * @example
   * await handle.setProp('value', 'neato burrito');
   */
  async setProp(elementHandle, name, value) {
    let result = await this.evaluate(
      elementHandle,
      (name, value, element) => {
        element[name] = value;
      },
      name,
      value
    );

    return result;
  }

  /**
   * @description Convenience method: return the text value of a named attribute.
   * Always returns a string, even if it's empty.
   * (Contrast with prop()).
   *
   * @example
   * await handle.attr('style');
   * or
   * await handle.attr('selector', 'style');
   */
  async attr(elementHandle, ...args) {
    let selector = null;
    let name = null;

    // handle two separate possible calling structures
    if (args.length == 1) {
      name = args[0];
    } else if (args.length == 2) {
      selector = args[0];
      name = args[1];
    }

    // extra convenience, to match text(...) above.
    if (selector) {
      elementHandle = await elementHandle.$(selector);
    }

    // grab the property handle
    const attributeValueHandle = await this.__page__.evaluateHandle(
      (element, name) => element.getAttribute(name),
      elementHandle,
      name
    );

    // grab the attribute value
    let result = null;
    if (attributeValueHandle) {
      result = await attributeValueHandle.jsonValue();
    }
    return result || "";
  }

  /**
   * @description Convenience method: get the absolute url for a given element.
   * If a selector is present, convert to a handle and get the text.
   */
  async href(elementHandle, selector) {
    if (selector) {
      elementHandle = await elementHandle.$(selector);
    }
    let result = null;
    if (elementHandle) {
      result = await this.prop(elementHandle, "href");
    }
    return result;
  }

  /**
   * @description Convenience method: return the parent elementHandle of this
   * elementHandle.
   */
  async parentNode(elementHandle) {
    const raw = await this.evaluate(elementHandle, e => {
      return e.parentNode;
    });
    return elementHandleProxy(this.__page__)(raw);
  }

  /**
   * @description Convenience method.
   *
   * Equivalent to calling page.evaluateHandle(function, ...elementHandle) on the
   * underlying page.
   */
  async evaluate(elementHandle, ...args) {
    return await this.__page__.evaluateHandle(...args, elementHandle);
  }
}

/**
 * @description Handler side for a proxy on a puppeteer.Page
 */
class PageHandler extends BaseHandler {
  constructor(options = {}, browserHandler) {
    super();

    this.__browserHandler__ = browserHandler;

    this.__clearCookies__ = utils.boolify(options.clearCookies, false);

    const navigationTimeout =
      options.navigationTimeout || this.constructor.NAVIGATION_TIMEOUT;
    const waitUntil = options.waitUntil || ["load", "networkidle0"];

    this.__navigationOptions__ = {
      timeout: navigationTimeout,
      waitUntil: waitUntil
    };

    const waitTimeout = options.waitTimeout || this.constructor.WAIT_TIMEOUT;
    this.__waitOptions__ = {
      timeout: waitTimeout
    };
  }

  /**
   * @description A Page.frames method that proxies the returned Frame[].
   */
  frames(page) {
    return page.frames().map(frame => frameProxy(frame));
  }

  /**
   * @description A Page.mainFrame method that proxies the returned Frame
   */
  mainFrame(page) {
    return frameProxy(page.mainFrame());
  }

  /**
   * @description A convenience method to find a specific iframe within a page.
   *
   * Returns null if no frame matching the URL is found.
   */
  findFrame(page, url) {
    const frames = page.frames() || [];
    const frame = frames.find(f => f.url().includes(url));
    return frame != null ? frameProxy(frame) : null;
  }

  /**
   * @description A Page.$$ method that proxies the returned ElementHandle[].
   */
  async $$(page, ...args) {
    const rawElementHandles = await page.$$(...args);
    return rawElementHandles.map(elementHandleProxy(page));
  }

  /**
   * @description A Page.$ method that proxies the returned ElementHandle.
   */
  async $(page, ...args) {
    const rawElementHandle = await page.$(...args);
    let result = null;
    if (rawElementHandle) {
      result = elementHandleProxy(page)(rawElementHandle);
    }
    return result;
  }

  /**
   * @description A Page.waitForFunction method that respects local WAIT_TIMEOUT
   */
  async waitForFunction(page, pageFunction, options = {}, ...args) {
    const fullOptions = utils.merge(this.__waitOptions__, options);
    return await page.waitForFunction(pageFunction, fullOptions, ...args);
  }

  /**
   * @description A Page.waitForSelector method that respects local WAIT_TIMEOUT
   */
  async waitForSelector(page, selector, options = {}) {
    const fullOptions = utils.merge(this.__waitOptions__, options);
    return await page.waitForSelector(selector, fullOptions);
  }

  /**
   * @description A helper method to clear cookies if desired.
   */
  async maybeClearCookies(page) {
    if (this.__clearCookies__) {
      const cookies = await page.cookies();
      await page.deleteCookie(...cookies);
    }
  }

  /**
   * @description A Page.waitForXPath method that respects local WAIT_TIMEOUT
   */
  async waitForXPath(page, xpath, options = {}) {
    const fullOptions = utils.merge(this.__waitOptions__, options);
    return await page.waitForXPath(xpath, fullOptions);
  }

  /**
   * @description A Page.browser method that proxies the returned browser
   */
  browser(page) {
    return new Proxy(page.browser(), this.__browserHandler__);
  }

  /**
   * @description A Page.goto method that proxies and uses local nav options.
   */
  async goto(page, url, options = {}) {
    await this.__browserHandler__.throttle();
    await this.maybeClearCookies(page);
    const fullOptions = utils.merge(this.__navigationOptions__, options);
    return await page.goto(url, fullOptions);
  }

  /**
   * @description A Page.goBack method that proxies and uses local nav options.
   */
  async goBack(page, options = {}) {
    await this.__browserHandler__.throttle();
    await this.maybeClearCookies(page);
    const fullOptions = utils.merge(this.__navigationOptions__, options);
    return await page.goBack(fullOptions);
  }

  /**
   * @description A Page.goForward method that proxies and uses local nav options.
   */
  async goForward(page, options = {}) {
    await this.__browserHandler__.throttle();
    await this.maybeClearCookies(page);
    const fullOptions = utils.merge(this.__navigationOptions__, options);
    return await page.goForward(fullOptions);
  }

  /**
   * @description A convenience method that clicks an elent and waits for navigation.
   *
   * @returns true on success, false on failure (such as a navigation timeout)
   */
  async clickAndNavigate(page, elementHandle) {
    await this.__browserHandler__.throttle();
    await this.maybeClearCookies(page);
    let success;
    try {
      const [response] = await Promise.all([
        page.waitForNavigation(this.__navigationOptions__),
        elementHandle.click()
      ]);
      success = true;
    } catch (error) {
      // most likely, a navigation failure
      console.error(`jscrape: clickAndNavigate failed: ${error}`);
      success = false;
    }
    return success;
  }

  /**
   * @description Convenience method for getting text directly from a page selector.
   */
  async text(page, selector) {
    const elementHandle = await this.$(page, selector);
    const result = elementHandle ? await elementHandle.text() : "";
    return result;
  }

  /**
   * @description Convenience method for getting text directly from a page selector.
   */
  async cleanText(page, selector) {
    const elementHandle = await this.$(page, selector);
    const result = elementHandle ? await elementHandle.cleanText() : "";
    return result;
  }

  /**
   * @description Convenience method for getting the full URL, including after #
   */
  async fullUrl(page) {
    const result = await page.evaluate(() => {
      return window.location.href;
    });
    return result;
  }

  /**
   * @description Convenience method for scrolling to the bottom of a page.
   */
  async scrollToTop(page) {
    const scroll = page.evaluate(() => {
      window.scrollBy(0, -document.body.scrollHeight);
    });
    const verify = page.waitForFunction(
      () => {
        return (window.scrollY = 0);
      },
      { polling: 100 }
    );
    await Promise.all([scroll, verify]);
  }

  /**
   * @description Convenience method for scrolling to the bottom of a page.
   */
  async scrollToBottom(page) {
    const scroll = page.evaluate(() => {
      window.scrollBy(0, document.body.scrollHeight);
    });
    const verify = page.waitForFunction(
      () => {
        return (
          window.innerHeight + window.scrollY == document.body.scrollHeight
        );
      },
      { polling: 100 }
    );
    await Promise.all([scroll, verify]);
  }

  /**
   * @description A page.close method that proxies and optionally clears cookies
   */
  async close(page) {
    // Cookies should be cleared when pages are closed -- otherwise,
    // depending on what the Scraper is doing, it's possible we'll leave
    // unwanted cookies around.
    await this.maybeClearCookies(page);
    await page.close();
  }
}

PageHandler.WAIT_TIMEOUT = 30000;
PageHandler.NAVIGATION_TIMEOUT = 60000;

/**
 * @description Handler side for a proxy on a puppeteer.Frame
 */
class FrameHandler extends BaseHandler {
  /**
   * @description A Frame.$$ method that proxies the returned ElementHandle[].
   */
  async $$(frame, ...args) {
    const rawElementHandles = await frame.$$(...args);
    return rawElementHandles.map(elementHandleProxy(frame));
  }

  /**
   * @description A Frame.$ method that proxies the returned ElementHandle.
   */
  async $(frame, ...args) {
    const rawElementHandle = await frame.$(...args);
    let result = null;
    if (rawElementHandle) {
      result = elementHandleProxy(frame)(rawElementHandle);
    }
    return result;
  }

  /**
   * @description A Frame.childFrames method that proxies the returned Frame[]
   */
  childFrames(frame) {
    return frame.childFrames().map(frame => frameProxy(frame));
  }
}

/**
 * @description Handler side for a proxy on puppeteer.Browser
 */
class BrowserHandler extends BaseHandler {
  constructor(options = {}) {
    super();
    this.__browserConsole__ = utils.boolify(options.browserConsole, false);
    this.__userAgent__ = options.userAgent || this.constructor.USER_AGENT;
    this.__loadImages__ = utils.boolify(options.images, true);
    this.__loadAds__ = utils.boolify(options.ads, true);
    this.__adclient__ = options.adclient || null;
    this.__pageOptions__ = options;
    this.__clearCookies__ = utils.boolify(options.clearCookies, false);
    this.__clearCache__ = utils.boolify(options.clearCache, false);
    this.__pageViewport__ = {
      width: options.viewportWidth || 960,
      height: options.viewportHeight || 1200
    };
    this.__lastPageLoad = 0;

    if (this.__browserConsole__) {
      console.error(
        "BrowserHandler: will capture browser console messages and log them outward"
      );
    }
  }

  /**
   * @description A Browser.newPage method that proxies the returned Page
   */
  async newPage(browser) {
    const rawPage = await browser.newPage();

    const page = pageProxy(rawPage, this.__pageOptions__, this);
    page.setUserAgent(this.__userAgent__);
    if (this.__clearCache__) {
      await page.setCacheEnabled(false);
    }

    // Prevent image or ad loads if desired
    if (!this.__loadImages__ || this.__adclient__) {
      await page.setRequestInterception(true);
      page.on("request", request => {
        // If image blocking is enabled and this is an image, abort...
        const abortForImage =
          !this.__loadImages__ && request.resourceType() === "image";
        // If ad blocking is enabled and this is an ad, abort...
        const abortForAd =
          this.__adclient__ && this.__adclient__.matches(request.url());
        // Should we abort?
        const abort = abortForImage || abortForAd;
        if (abortForImage || abortForAd) {
          request.abort();
        } else {
          request.continue();
        }
      });
    }

    // Install the Proxy auth header. (Not the same thing as a javascript proxy!)
    if (this.__pageOptions__.proxy && this.__pageOptions__.proxy.auth) {
      // See RFC 7617 section 2
      const basicAuth = Buffer.from(this.__pageOptions__.proxy.auth).toString(
        "base64"
      );
      const authHeaders = {
        "Proxy-Authorization": `Basic ${basicAuth}`
      };
      await page.setExtraHTTPHeaders(authHeaders);
    }

    if (this.__browserConsole__) {
      const _log = message => {
        console.error(
          `${this.constructor.ANSI_YELLOW}Browser [${page.url()}]:${
            this.constructor.ANSI_RESET
          } ${message}`
        );
      };

      page.on("console", async message => {
        try {
          //
          // Try to log messages the 'fancy' way:
          //
          let texts = [];

          for (let i = 0; i < message.args().length; ++i) {
            const text = await message.args()[i].jsonValue();
            texts.push(text);
          }

          _log(texts.join(" "));
        } catch (error) {
          //
          // Welp. That failed -- I think it's a puppeteer edge issue.
          // Let's just do the simple thing (that may not lead to much):
          //
          _log(message.text());
        }
      });
    }

    // XXX what *should* we do when a page crashes? We don't want to take
    // down the whole scraper process, but at the same time, it's hard to
    // fit this into our flow. So for now we just...
    rawPage.on("error", async error => {
      console.error(
        `BrowserHandler.newPage: CRITICAL ERROR: received an uncaught error for page: ${error}.`
      );
      await rawPage.close();
    });

    await page.setViewport({
      width: this.__pageViewport__.width,
      height: this.__pageViewport__.height
    });

    return page;
  }

  /**
   * @description Convenience method that tries to open a new page to a given URL.
   *
   * Returns null if the load fails -- for example, if it times out.
   */
  async tryOpenPage(browser, url, options = {}) {
    // wait the right amount of time
    await this.throttle(options);

    // open a blank tab
    let page = null;

    try {
      page = await this.newPage(browser);
    } catch (error) {
      console.error(
        `BrowserHandler.tryOpenPage: failed to await newPage: ${error}; closing.`
      );
      page = null;
    }

    // try to open the page
    if (page) {
      try {
        await page.goto(url, options);
      } catch (error) {
        // drat, we probably had a navigation timeout. try to close it.
        try {
          console.error(
            `BrowserHandler.tryOpenPage: failed to load ${url}: ${error}; closing.`
          );
          await page.close();
        } catch (error) {
          // who even knows what happened here?
          console.error(
            `BrowserHandler.tryOpenPage: failed to close ${url}: ${error}; shrug.`
          );
        }

        page = null;
      }
    }

    return page;
  }

  /**
   * @description Throttle to make sure we are being good citizens
   * We want to keep track of the last time a page was opened, and make sure that
   * we maintain a reasonable time between new page loads.
   * @param {number} options.throttle If provided, override the default throttle rate.
   */
  async throttle(options = {}) {
    const throttle = options.throttle || this.__pageOptions__.throttle || 0;
    const duration = new Date().getTime() - this.__lastPageLoad;
    if (duration < throttle) {
      await utils.sleep(throttle - duration);
    }
    this.__lastPageLoad = new Date().getTime();
  }

  /**
   * @description A Browser.pages method that proxies the returned Page[]
   */
  async pages(browser) {
    const rawPages = await browser.pages();
    return rawPages.map(rawPage =>
      pageProxy(rawPage, this.__pageOptions__, this)
    );
  }

  /**
   * @description Convenience method: return the most recently opened page.
   */
  async currentPage(browser) {
    let rawPages = await browser.pages();
    let page = null;
    if (rawPages.length > 0) {
      page = pageProxy(
        rawPages[rawPages.length - 1],
        this.__pageOptions__,
        this
      );
    }
    return page;
  }

  /**
   * @description Convenience method: close the most recently opened page.
   */
  async closeCurrentPage(browser) {
    const page = await this.currentPage(browser);
    if (page) {
      await page.close();
    }
  }
}

BrowserHandler.USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36";
BrowserHandler.ANSI_YELLOW = "\x1b[33m";
BrowserHandler.ANSI_RESET = "\x1b[0m";
