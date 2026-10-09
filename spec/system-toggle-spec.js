const path = require("path");

describe("supported system checker setting", () => {
  it("checks again when the user re-enables system dictionaries", async () => {
    const pack = await lumine.packages.activatePackage("spell-check");
    const main = pack.mainModule;
    const env = require(path.join(pack.path, "lib/checker-env"));
    // Model a supported spelling service on every CI host; only its native answer is controlled.
    spyOn(env, "isSystemSupported").and.returnValue(true);
    const SystemChecker = require(path.join(pack.path, "lib/system-checker"));
    spyOn(SystemChecker.prototype, "isEnabled").and.returnValue(true);
    spyOn(SystemChecker.prototype, "check").and.callFake((_args, text) => ({
      id: "spell-check:system",
      invertIncorrectAsCorrect: true,
      incorrect: [{ start: 0, end: text.length }],
    }));
    lumine.config.set("spell-check.useLocales", false);
    lumine.config.set("spell-check.knownWords", []);
    lumine.config.set("spell-check.useSystem", true);
    const manager = main.getInstance(main.globalArgs);
    try {
      expect((await manager.check({}, "zzzzzzzh")).misspellings.length).toBe(1);
      lumine.config.set("spell-check.useSystem", false);
      expect((await manager.check({}, "zzzzzzzh")).misspellings.length).toBe(0);
      lumine.config.set("spell-check.useSystem", true);
      expect((await manager.check({}, "zzzzzzzh")).misspellings.length).toBe(1);
    } finally {
      await lumine.packages.deactivatePackage("spell-check");
    }
  });
});
