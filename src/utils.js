/**
 * @file
 * A grab bag of hopefully useful utility methods.
 *
 * XXX Probably some of this should be deleted, or moved elsewhere. -Dave
 */

/**
 * @description Return an array, no matter what.
 * @param {Any} atom_or_list Any value.
 */
exports.listify = atom_or_list => {
  let list = atom_or_list;

  if (atom_or_list == null) {
    list = [];
  } else if (!Array.isArray(atom_or_list)) {
    list = [atom_or_list];
  }

  return list;
};

/**
 * @description Get a boolean from option, if provided, otherwise use a default.
 */
exports.boolify = (option, defaultValue) => {
  return option == null ? defaultValue : Boolean(option);
};

/**
 * @description Merge multiple objects together, returning a new object.
 *
 * @example
 * merge({a: 1}, {b: 2, c: 3}, {a: 4, c: 5})
 * --> {a: 4, b: 2, c: 5}
 */
exports.merge = (...objects) => {
  return Object.assign({}, ...objects);
};

// Why aren't these part of the standard implementation of Set()?

/**
 * @description Return (a union b)
 */
exports.setUnion = (a, b) => {
  return new Set([...a, ...b]);
};

/**
 * @description Return (a intersect b)
 */
exports.setIntersection = (a, b) => {
  return new Set([...a].filter(item => b.has(item)));
};

/**
 * @description Return (a - b)
 */
exports.setDifference = (a, b) => {
  return new Set([...a].filter(item => !b.has(item)));
};

/**
 * @description Wrap an error of type A in an error of type B.
 */
exports.wrappedError = (klass, error, message = null) => {
  // Already of the expected type? Bail fast.
  if (error instanceof klass) {
    return error;
  }

  const wrapped = new klass();

  // A big hack to lop off the original error message and
  // keep the rest of the stack. Modifying error_instance.stack
  // effectively modifies error_instance.message too, at least with
  // our current javascript runtime.
  const cleanInnerStack = error.stack
    .split("\n")
    .slice(1)
    .join("\n");
  const finalMessage = message || error.message;
  wrapped.stack = `${klass.name}: ${finalMessage}\n${cleanInnerStack}`;

  return wrapped;
};

/**
 * @description Clean whitespace from string
 *
 * @example
 * cleanWhitespace('  Woodinville Landing - Building A\tWoodinville WA  \n')
 * --> 'Woodinville Landing - Building A Woodinville WA'
 */
exports.cleanWhitespace = s => {
  if (!s) {
    return s;
  }
  return s
    .replace(/\t|\n/g, " ")
    .split(/\s+/)
    .join(" ")
    .trim();
};

/**
 * @description Get an email address from a mailto: href.
 */
exports.emailFromMailto = mailto => {
  if (!mailto) {
    return null;
  }

  mailto = mailto.toLowerCase();
  if (!mailto.startsWith("mailto:")) {
    return null;
  }

  const partial = mailto.split("mailto:")[1] || null;
  if (!partial) {
    return null;
  }

  return partial.split("?")[0] || null;
};

/**
 * @description Get a telephone number from a tel: href.
 */
exports.phoneFromTel = tel => {
  if (!tel || !tel.startsWith("tel:")) {
    return null;
  }
  return tel.split("tel:")[1] || null;
};

/**
 * @description Sleep for a while, then come back to life.
 */
exports.sleep = delay => {
  return new Promise(resolve => {
    setTimeout(resolve, delay);
  });
};

/**
 * @description Return a promise for an EventEmitter event to complete.
 */
exports.asyncOnce = (emitter, event) => {
  return new Promise(resolve => {
    emitter.once(event, (...results) => resolve(...results));
  });
};
