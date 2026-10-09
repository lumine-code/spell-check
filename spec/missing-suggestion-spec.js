const path = require("path");

describe("missing dictionary suggestions", () => {
  let main, LocaleChecker;
  beforeEach(async () => {
    const pack = await lumine.packages.activatePackage("spell-check");
    main = pack.mainModule;
    LocaleChecker = require(path.join(pack.path, "lib/locale-checker"));
    lumine.config.set("spell-check.noticesMode", "console");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("spell-check");
  });

  it("returns no native suggestions when dictionary initialization disables the locale", () => {
    const checker = new LocaleChecker("xx-MISSING", [], false, false);
    checker.checkDefaultPaths = false;
    checker.checkDictionaryPath = false;
    expect(checker.suggest({}, "word")).toEqual([]);
    expect(checker.isEnabled()).toBe(false);
  });

  it("keeps the actual manager suggestion workflow usable for an unavailable locale", () => {
    const args = {
      locales: ["xx-MISSING"],
      localePaths: [],
      useSystem: false,
      useLocales: true,
      knownWords: [],
      addKnownWords: false,
      checkerPaths: [],
    };
    const manager = main.getInstance(args);
    manager.setGlobalArgs(args);
    expect(manager.suggest({ projectPath: null, relativePath: null }, "word")).toEqual([]);
    expect(manager.localeCheckers[0].isEnabled()).toBe(false);
  });
});
