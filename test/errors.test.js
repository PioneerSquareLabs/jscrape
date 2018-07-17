const errors = require("../lib/errors");

test("errors have a sensible default name", () => {
  const error = new errors.BaseError();
  expect(error.name).toBe("BaseError");
});
