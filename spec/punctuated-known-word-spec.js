describe("configured technical known words", () => {
  it("preserves literal known words containing digits and dots in the actual manager result", async () => {
    const main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    lumine.config.set("spell-check.useLocales", false);
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.knownWords", ["ssh-keygen", "i3.large", "Lúmine.3"]);
    const manager = main.getInstance(main.globalArgs);
    // A valid negative checker answer is the only controlled dictionary boundary.
    manager.addPluginChecker({
      getId: () => "technical-word-control",
      getPriority: () => 1,
      isEnabled: () => true,
      providesSpelling: () => true,
      providesSuggestions: () => false,
      providesAdding: () => false,
      check: (_args, text) => ({
        id: "technical-word-control",
        incorrect: [{ start: 0, end: text.length }],
      }),
    });
    try {
      expect((await manager.check({}, "ssh-keygen")).misspellings).toEqual([]);
      expect((await manager.check({}, "i3.large")).misspellings).toEqual([]);
      expect((await manager.check({}, "lÚMINE.3")).misspellings).toEqual([]);
      expect((await manager.check({}, "unrelated")).misspellings.length).toBe(1);
    } finally {
      await lumine.packages.deactivatePackage("spell-check");
    }
  });
});
