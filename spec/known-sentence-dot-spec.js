describe("known word sentence punctuation", () => {
  it("keeps configured whole words with sentence dots in the actual manager result", async () => {
    const main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    lumine.config.set("spell-check.useLocales", false);
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.knownWords", [
      "ssh-keygen",
      "e-mail",
      "o'clock",
      "i3.large",
      ".NET",
    ]);
    const manager = main.getInstance(main.globalArgs);
    manager.addPluginChecker({
      getId: () => "sentence-dot-control",
      isEnabled: () => true,
      providesSpelling: () => true,
      // A dictionary reports only the known word, excluding surrounding sentence punctuation.
      check: (_args, text) => ({
        id: "sentence-dot-control",
        incorrect: [
          { start: text.match(/^\.+/)?.[0].length ?? 0, end: text.replace(/\.+$/, "").length },
        ],
      }),
    });
    try {
      for (const text of [
        "ssh-keygen.",
        "e-mail.",
        "o'clock.",
        "i3.large.",
        "...ssh-keygen...",
        ".NET.",
      ]) {
        expect((await manager.check({}, text)).misspellings)
          .withContext(text)
          .toEqual([]);
      }
    } finally {
      await lumine.packages.deactivatePackage("spell-check");
    }
  });
});
