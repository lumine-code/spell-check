const path = require("node:path");
const { scopeDescriptorMatchesSelector } = require("../lib/scope-helper");
const SpellCheckTask = require("../lib/spell-check-task");

describe("spell-check", () => {
  let editor;
  let main;

  const markers = () => main.misspellingMarkersForEditor(editor);
  const markedWords = () =>
    markers().map((marker) => editor.getTextInBufferRange(marker.getBufferRange()));
  const refresh = () => main.viewsByEditor.get(editor).updateMisspellings();

  beforeEach(async () => {
    lumine.config.set("spell-check.grammars", ["source.js"]);
    lumine.config.set("spell-check.excludedScopes", []);
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    lumine.config.set("spell-check.knownWords", []);
    lumine.config.set("spell-check.addKnownWords", false);

    await lumine.packages.activatePackage("language-javascript");
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    const pack = await lumine.packages.activatePackage("spell-check");
    main = pack.mainModule;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("spell-check");
    editor.destroy();
  });

  it("marks misspellings and leaves correctly spelled words alone", async () => {
    editor.setText("This sentence has thiss misspelling.");
    await refresh();
    await conditionPromise(() => markedWords().includes("thiss"));

    expect(markedWords()).toEqual(["thiss"]);
  });

  it("drops stale asynchronous results after rapid edits", async () => {
    let text = "first";
    const callbacks = [];
    const fakeEditor = {
      id: 1,
      isDestroyed: () => false,
      getBuffer: () => ({ getPath: () => null, getText: () => text }),
    };
    const manager = {
      check: async (_args, checkedText) => ({
        misspellings: [checkedText],
      }),
    };
    const task = new SpellCheckTask(manager);
    const first = task.start(fakeEditor, (result) => callbacks.push(result));
    text = "second";
    const second = task.start(fakeEditor, (result) => callbacks.push(result));
    await Promise.all([first, second]);

    expect(callbacks).toEqual([["second"]]);
  });

  it("honors the known-word list alongside locale dictionaries", async () => {
    lumine.config.set("spell-check.knownWords", ["thiss"]);
    editor.setText("thiss");
    await refresh();
    await conditionPromise(() => markers().length === 0);

    expect(markers().length).toBe(0);
  });

  it("toggles checking for the active editor", async () => {
    editor.setText("thiss");
    await refresh();
    await conditionPromise(() => markedWords().includes("thiss"));
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "spell-check:toggle");

    expect(markers().length).toBe(0);
  });

  it("removes service checkers when their registration is disposed", () => {
    const checkerPath = path.join(__dirname, "fixtures", "service-checker.js");
    const checker = require(checkerPath);
    checker.deactivated = false;
    const firstRegistration = main.consumeSpellCheckers(checkerPath);
    const secondRegistration = main.consumeSpellCheckers(checkerPath);

    expect(main.instance.checkers).toContain(checker);
    firstRegistration.dispose();

    expect(main.instance.checkers).toContain(checker);
    expect(checker.deactivated).toBe(false);
    secondRegistration.dispose();

    expect(main.instance.checkers).not.toContain(checker);
    expect(checker.deactivated).toBe(true);
  });

  it("matches ordered descendant scopes and comma-separated alternatives", () => {
    const descriptor = ["source.js", "meta.function.js", "comment.block.js"];

    expect(scopeDescriptorMatchesSelector(descriptor, "source comment")).toBe(true);
    expect(scopeDescriptorMatchesSelector(descriptor, "string, comment.block")).toBe(true);
    expect(scopeDescriptorMatchesSelector(descriptor, "comment source")).toBe(false);
  });
});
