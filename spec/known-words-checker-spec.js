const KnownWordsChecker = require("../lib/known-words-checker");

// The checker's job is to mark ranges of a buffer as correct, and those ranges
// have to line up with the ones a dictionary flags. A dictionary splits a
// hyphenated compound and flags only the part it does not know, so marking the
// whole compound — or nothing at all — leaves a known word underlined.
describe("lib/known-words-checker", () => {
  const rangesFor = (words, text) => new KnownWordsChecker(words).check({}, text).correct;
  const textOf = (text, { start, end }) => text.slice(start, end);

  it("marks a known word standing on its own", () => {
    const text = "SOFiSTiK alone";

    expect(rangesFor(["SOFiSTiK"], text)).toEqual([{ start: 0, end: 8 }]);
  });

  // The reported case: accepted on its own, still underlined in `to-SOFiSTiK`.
  it("marks a known word inside a hyphenated compound", () => {
    const text = "the to-SOFiSTiK export";

    const ranges = rangesFor(["SOFiSTiK"], text);

    expect(ranges.map((range) => textOf(text, range))).toEqual(["SOFiSTiK"]);
    expect(ranges).toEqual([{ start: 7, end: 15 }]);
  });

  it("marks it at either end of the compound", () => {
    const text = "SOFiSTiK-export and to-SOFiSTiK";

    const ranges = rangesFor(["SOFiSTiK"], text);

    expect(ranges).toEqual([
      { start: 0, end: 8 },
      { start: 23, end: 31 },
    ]);
  });

  it("marks it before an apostrophe", () => {
    const text = "SOFiSTiK's export";

    expect(rangesFor(["SOFiSTiK"], text)).toEqual([{ start: 0, end: 8 }]);
  });

  // A known word may itself be hyphenated, so the whole token is still tried
  // first — splitting only would never match this.
  it("marks a hyphenated known word as one range", () => {
    const text = "a tree-sitter grammar";

    expect(rangesFor(["tree-sitter"], text)).toEqual([{ start: 2, end: 13 }]);
  });

  it("leaves the parts it does not know alone", () => {
    const text = "to-SOFiSTiK-exprot";

    const ranges = rangesFor(["SOFiSTiK"], text);

    expect(ranges.map((range) => textOf(text, range))).toEqual(["SOFiSTiK"]);
  });

  it("matches case-insensitively unless the entry is prefixed", () => {
    expect(rangesFor(["sofistik"], "to-SOFiSTiK").length).toBe(1);
    expect(rangesFor(["!SOFiSTiK"], "to-sofistik").length).toBe(0);
    expect(rangesFor(["!SOFiSTiK"], "to-SOFiSTiK").length).toBe(1);
  });

  it("reports ranges in ascending order, as the range maths expects", () => {
    const text = "SOFiSTiK to-SOFiSTiK plain SOFiSTiK-export";

    const ranges = rangesFor(["SOFiSTiK"], text);

    const starts = ranges.map((range) => range.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(ranges.length).toBe(3);
  });
});
