describe("Reset locale configuration", () => {
  let main, manager, previousLang;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    previousLang = process.env.LANG;
    process.env.LANG = "en_GB.UTF-8";
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    manager = main.getInstance(main.globalArgs);
    manager.init();
    expect(manager.localeCheckers.map((checker) => checker.locale)).toEqual(["en-US"]);
  });

  afterEach(async () => {
    if (lumine.packages.isPackageActive("spell-check"))
      await lumine.packages.deactivatePackage("spell-check");
    if (lumine.packages.isPackageLoaded("spell-check"))
      await lumine.packages.unloadPackage("spell-check");
    for (const setting of ["useSystem", "useLocales", "locales"])
      lumine.config.unset(`spell-check.${setting}`);
    if (previousLang === undefined) delete process.env.LANG;
    else process.env.LANG = previousLang;
    main = manager = null;
  });

  it("redetects the default locale after clearing an explicit locale list", () => {
    lumine.config.set("spell-check.locales", []);
    manager.init();
    expect(manager.locales).toEqual(["en_GB"]);
    expect(manager.localeCheckers.map((checker) => checker.locale)).toEqual(["en_GB"]);
  });

  it("preserves inferred dictionary identities when the empty configuration did not change", async () => {
    await lumine.packages.deactivatePackage("spell-check");
    await lumine.packages.unloadPackage("spell-check");
    lumine.config.set("spell-check.locales", []);
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    manager = main.getInstance(main.globalArgs);
    manager.init();
    const checkers = manager.localeCheckers;
    lumine.config.set("spell-check.knownWords", ["OwnedWord"]);
    manager.init();
    expect(manager.localeCheckers).toBe(checkers);
    expect(manager.locales).toEqual(["en_GB"]);
    lumine.config.unset("spell-check.knownWords");
  });
});
