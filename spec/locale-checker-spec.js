const LocaleChecker = require("../lib/locale-checker");
const KnownWordsChecker = require("../lib/known-words-checker");

describe("spell checkers", () => {
  it("loads the bundled English dictionary and returns corrections", async () => {
    const checker = new LocaleChecker("en-US", [], false, false);
    const result = await checker.check({}, "correct thiss word");

    expect(checker.isEnabled()).toBe(true);
    expect(result.incorrect.length).toBe(1);
    expect(checker.suggest({}, "thiss")).toContain("this");
  });

  it("recognizes insensitive and explicitly sensitive known words", () => {
    const checker = new KnownWordsChecker(["Lumine", "!API"]);
    const result = checker.check({}, "lumine LUMINE API api");
    const words = result.correct.map(({ start, end }) => "lumine LUMINE API api".slice(start, end));

    expect(words).toEqual(["lumine", "LUMINE", "API"]);
  });

  it("adds known words without mutating the configuration value in place", () => {
    lumine.config.set("spell-check.knownWords", ["first"]);
    const checker = new KnownWordsChecker(["first"]);
    checker.add({}, { word: "second" });

    expect(lumine.config.get("spell-check.knownWords")).toEqual(["first", "second"]);
  });
});
