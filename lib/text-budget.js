const MAX_TEXT_UNITS = 2 * 1024 * 1024;
const MAX_RESULTS = 10000;
function checkText(length) {
  if (length > MAX_TEXT_UNITS)
    throw Object.assign(
      new RangeError(
        "Spell checking accepts at most 2 Mi UTF-16 units per request. Check a smaller selection.",
      ),
      { code: "ERR_SPELL_CHECK_LIMIT" },
    );
}
function checkResults(count, limit = MAX_RESULTS) {
  if (count > limit)
    throw Object.assign(
      new RangeError("Spell checking exceeds the 10,000-result budget. Check a smaller selection."),
      { code: "ERR_SPELL_CHECK_LIMIT" },
    );
}
module.exports = { checkText, checkResults, MAX_TEXT_UNITS, MAX_RESULTS };
