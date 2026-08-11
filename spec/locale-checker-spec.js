const spellchecker = require("@lumine-code/spellchecker");
const LocaleChecker = require("../lib/locale-checker");
const KnownWordsChecker = require("../lib/known-words-checker");
const env = require("../lib/checker-env");

describe("spell checkers", () => {
  it("loads the bundled English dictionary and returns corrections", async () => {
    const checker = new LocaleChecker("en-US", [], false, false);
    const result = await checker.check({}, "correct thiss word");

    expect(checker.isEnabled()).toBe(true);
    expect(result.incorrect.length).toBe(1);
    expect(checker.suggest({}, "thiss")).toContain("this");
  });

  describe("when a locale is served by both Hunspell and the system", () => {
    // Whether the machine running this has a Windows spelling service, and
    // which locales it admits to, is not something a spec should depend on.
    // Stand in for both sides so the ordering is what is under test.
    let restore;

    beforeEach(() => {
      const original = spellchecker.Spellchecker;
      restore = () => {
        spellchecker.Spellchecker = original;
      };

      // Captured before any spec redirects `getDictionaryPath`, so pointing it
      // somewhere else genuinely makes the packaged attempt fail.
      const packagedPath = spellchecker.getDictionaryPath();
      built = [];
      spellchecker.Spellchecker = class FakeSpellchecker {
        constructor() {
          this.type = null;
          built.push(this);
        }

        setSpellcheckerType(type) {
          this.type = type;
        }

        // Both the packaged dictionary and the system service can serve this
        // locale. Only one of them should ever be asked.
        setDictionary(locale, path) {
          return this.type === spellchecker.ALWAYS_USE_HUNSPELL ? path === packagedPath : true;
        }
      };
    });

    afterEach(() => restore());

    let built;

    it("takes the packaged dictionary and never builds the system checker", () => {
      spyOn(env, "isWindows").and.returnValue(true);
      const checker = new LocaleChecker("pl-PL", [], false, false);

      checker.deferredInit();

      // The system service answers the same but costs about 13ms per kilobyte
      // against Hunspell's 0.05ms, so it has to come last.
      expect(checker.source).toBe("packaged");
      expect(built.length).toBe(1);
    });

    it("falls back to the system service when no dictionary is installed", () => {
      spyOn(env, "isWindows").and.returnValue(true);
      spyOn(spellchecker, "getDictionaryPath").and.returnValue("/no/such/place");
      const checker = new LocaleChecker("pl-PL", [], false, false);

      checker.deferredInit();

      // Slow checking still beats none for a language nobody ships a
      // dictionary for.
      expect(checker.source).toBe("system");
      expect(checker.isEnabled()).toBe(true);
    });
  });

  it("does not offer the operating system's service for whole-buffer checks on Windows", () => {
    // It exists there, but at 13ms per kilobyte — 35 seconds for a megabyte
    // against 52ms through Hunspell, for identical results — it cannot be used
    // the way this package checks, which is a buffer at a time.
    if (env.isWindows()) {
      expect(env.isSystemSupported()).toBe(false);
    } else {
      expect(env.isSystemSupported()).toBe(env.isDarwin());
    }
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
