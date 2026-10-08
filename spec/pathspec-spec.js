const path = require("node:path");
const os = require("node:os");

describe("spell-check dictionary path specifications", () => {
  let main, pathspec;

  beforeEach(async () => {
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    lumine.config.unset("spell-check.localePaths");
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    pathspec = require("../lib/pathspec");
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("spell-check");
    for (const setting of ["useSystem", "useLocales", "locales", "localePaths"]) {
      lumine.config.unset(`spell-check.${setting}`);
    }
  });

  it("resolves ordinary relative dictionary directories from the working directory", () => {
    for (const spec of [
      "dictionaries",
      "dictionaries/custom",
      "./dictionaries",
      "../dictionaries",
    ]) {
      expect(pathspec.getPath(spec)).toBe(path.join(process.cwd(), spec));
    }
  });

  it("retains blank and absolute path specifications", () => {
    for (const spec of [
      "",
      null,
      path.join(process.cwd(), "dictionaries"),
      "/dictionaries",
      "\\dictionaries",
      "C:\\dictionaries",
      "C:/dictionaries",
    ]) {
      expect(pathspec.getPath(spec)).toBe(spec);
    }
  });

  it("resolves the existing home, application and configuration pseudo-drives", () => {
    const home = os.homedir();
    for (const [prefix, root] of [
      ["home:", home],
      ["~", home],
      ["application:", path.dirname(process.execPath)],
      ["config:", lumine.getConfigDirPath()],
      ["desktop:", path.join(home, "Desktop")],
      ["documents:", path.join(home, "Documents")],
      ["downloads:", path.join(home, "Downloads")],
    ]) {
      expect(pathspec.getPath(`${prefix}/dictionaries`)).toBe(path.join(root, "dictionaries"));
    }
    expect(pathspec.getPath("HOME:/dictionaries")).toBe(path.join(home, "dictionaries"));
    expect(pathspec.getPath("app-lication:/dictionaries")).toBe(
      path.join(path.dirname(process.execPath), "dictionaries"),
    );
  });

  it("retains unknown pseudo-drives and drive-relative Windows paths", () => {
    for (const spec of ["unknown:dictionary", "other-drive:/dictionaries", "C:dictionaries"]) {
      expect(pathspec.getPath(spec)).toBe(spec);
    }
  });

  it("still rejects project-scoped paths in global dictionary specifications", () => {
    expect(() => pathspec.getPath("project:dictionaries")).toThrowError(
      "Cannot use `project:` paths with global path specifications",
    );
  });

  it("loads a real dictionary through the current package's relative localePaths setting", async () => {
    const spellchecker = require("@lumine-code/native-spelling");
    const relative = path.relative(process.cwd(), spellchecker.getDictionaryPath());
    expect(path.isAbsolute(relative)).toBe(false);
    lumine.config.set("spell-check.localePaths", [relative]);
    const manager = main.getInstance(main.globalArgs);
    manager.init();
    const checker = manager.localeCheckers[0];
    expect(checker.paths).toEqual([relative]);
    const result = await checker.check({}, "correct thiss word");
    expect(checker.source).toBe(path.join(process.cwd(), relative));
    expect(result.incorrect).toHaveSize(1);
    expect(checker.suggest({}, "thiss")).toContain("this");
  });

  it("continues to the packaged dictionary after a missing relative search directory", async () => {
    lumine.config.set("spell-check.localePaths", ["missing-spell-check-dictionaries"]);
    const manager = main.getInstance(main.globalArgs);
    manager.init();
    const checker = manager.localeCheckers[0];
    const result = await checker.check({}, "correct thiss word");
    expect(checker.source).toBe("packaged");
    expect(result.incorrect).toHaveSize(1);
  });
});
