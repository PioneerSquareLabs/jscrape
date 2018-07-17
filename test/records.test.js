const records = require("../lib/records");

test("base record validation is a no-op", () => {
  const record = new records.Record();
  record.validate();
});
