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

  describe("scope filtering", () => {
    const view = () => main.viewsByEditor.get(editor);

    // Scope filtering can only work once the grammar has tokenized, and which
    // engine backs `source.js` is not this spec's business. Wait until the
    // editor actually reports a comment scope where we put one.
    const commentIsTokenized = (position) =>
      conditionPromise(() =>
        editor
          .scopeDescriptorForBufferPosition(position)
          .getScopesArray()
          .some((scope) => scope.startsWith("comment")),
      );

    it("skips a misspelling whose scope is excluded", async () => {
      lumine.config.set("spell-check.excludedScopes", ["comment"]);
      editor.setText("// thiss");
      await commentIsTokenized([0, 3]);
      await refresh();

      expect(markers().length).toBe(0);
    });

    it("marks the same misspelling once nothing excludes its scope", async () => {
      editor.setText("// thiss");
      await commentIsTokenized([0, 3]);
      await refresh();
      await conditionPromise(() => markers().length === 1);

      expect(markedWords()).toEqual(["thiss"]);
    });

    it("checks only the named descendant scope when the setting names one", async () => {
      lumine.config.set("spell-check.grammars", ["source.js comment"]);
      editor.setText("// thiss\nthatt();");
      await commentIsTokenized([0, 3]);
      await refresh();
      await conditionPromise(() => markers().length > 0);

      expect(markedWords()).toEqual(["thiss"]);
      expect(markers()[0].getBufferRange().start.row).toBe(0);
    });

    it("does not resolve scope descriptors when nothing narrows the buffer", async () => {
      spyOn(editor, "scopeDescriptorForBufferPosition").and.callThrough();
      editor.setText("thiss and thatt");
      await refresh();
      await conditionPromise(() => markers().length === 2);

      // Every checked grammar is a bare root scope and nothing is excluded, so
      // no descriptor can change the outcome and none should be asked for.
      expect(editor.scopeDescriptorForBufferPosition).not.toHaveBeenCalled();
    });

    it("resolves scope descriptors once something does narrow the buffer", async () => {
      lumine.config.set("spell-check.excludedScopes", ["comment"]);
      spyOn(editor, "scopeDescriptorForBufferPosition").and.callThrough();
      editor.setText("thiss and thatt");
      await refresh();
      await conditionPromise(() => markers().length === 2);

      expect(editor.scopeDescriptorForBufferPosition).toHaveBeenCalled();
    });

    it("keeps the same marker layer across updates", async () => {
      editor.setText("thiss");
      await refresh();
      await conditionPromise(() => markers().length === 1);
      const layer = view().markerLayer;

      editor.setText("thiss thatt");
      await refresh();
      await conditionPromise(() => markers().length === 2);

      expect(view().markerLayer).toBe(layer);
      expect(layer.isDestroyed()).toBe(false);
    });
  });

  it("leaves a toggled-off editor alone when the font size changes", async () => {
    editor.setText("thiss");
    await refresh();
    await conditionPromise(() => markedWords().includes("thiss"));
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "spell-check:toggle");

    expect(markers().length).toBe(0);

    lumine.config.set("editor.fontSize", lumine.config.get("editor.fontSize") + 2);
    await refresh();

    expect(markers().length).toBe(0);
  });

  it("stops listening for context menus once the view is destroyed", () => {
    const view = main.viewsByEditor.get(editor);
    const element = lumine.views.getView(editor);
    spyOn(element, "removeEventListener").and.callThrough();

    view.destroy();

    expect(element.removeEventListener).toHaveBeenCalledWith(
      "contextmenu",
      view.addContextMenuEntries,
    );
  });

  it("matches ordered descendant scopes and comma-separated alternatives", () => {
    const descriptor = ["source.js", "meta.function.js", "comment.block.js"];

    expect(scopeDescriptorMatchesSelector(descriptor, "source comment")).toBe(true);
    expect(scopeDescriptorMatchesSelector(descriptor, "string, comment.block")).toBe(true);
    expect(scopeDescriptorMatchesSelector(descriptor, "comment source")).toBe(false);
  });
});
