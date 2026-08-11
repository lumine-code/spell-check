const path = require("node:path");
const { scopeDescriptorMatchesSelector } = require("../lib/scope-helper");

describe("spell-check", () => {
  let editor;
  let main;
  let linter;

  // What the linter would be told, and the words those messages cover.
  const lint = () => linter.lint(editor);
  const wordsIn = (messages) =>
    messages.map((message) => editor.getTextInBufferRange(message.location.position));

  beforeEach(async () => {
    lumine.config.set("spell-check.grammars", ["source.js"]);
    lumine.config.set("spell-check.excludedScopes", []);
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    lumine.config.set("spell-check.knownWords", []);
    lumine.config.set("spell-check.addKnownWords", false);
    lumine.config.set("spell-check.severity", "error");
    lumine.config.set("spell-check.editors", "center");

    await lumine.packages.activatePackage("language-javascript");
    // `spell-check:correct-misspelling` is registered on the workspace and
    // resolved from the dispatch target, so a dispatch aimed at an editor has to
    // be able to reach the workspace element through the document.
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    const pack = await lumine.packages.activatePackage("spell-check");
    main = pack.mainModule;
    linter = main.provideLinter();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("spell-check");
    editor.destroy();
  });

  describe("the linter it provides", () => {
    it("describes itself the way the service requires", () => {
      expect(linter.name).toBe("Spell Check");
      expect(linter.scope).toBe("file");
      expect(linter.lintsOnChange).toBe(true);
      // Every editor arrives, because the `grammars` setting understands
      // descendant scopes that `grammarScopes` cannot express.
      expect(linter.grammarScopes).toEqual(["*"]);
    });

    it("reports a misspelling and leaves correctly spelled words alone", async () => {
      editor.setText("This sentence has thiss misspelling");

      const messages = await lint();

      expect(wordsIn(messages)).toEqual(["thiss"]);
      expect(messages[0].severity).toBe("error");
      expect(messages[0].excerpt).toBe("thiss is not in the dictionary");
    });

    it("reports the severity the setting asks for", async () => {
      lumine.config.set("spell-check.severity", "hint");
      editor.setText("thiss");

      expect((await lint())[0].severity).toBe("hint");
    });

    it("locates a message by path once the buffer has one", async () => {
      const filePath = path.join(__dirname, "fixtures", "service-checker.js");
      editor.getBuffer().setPath(filePath);
      editor.setText("thiss");

      expect((await lint())[0].location.file).toBe(filePath);
    });

    // A buffer that has never been saved has no path, so the message names the
    // buffer. Untitled buffers are in the default grammar list, so this is the
    // ordinary case rather than an edge one.
    it("locates a message by buffer while the buffer has no path", async () => {
      editor.setText("thiss");

      const [message] = await lint();
      expect(message.location.file).toBeUndefined();
      expect(message.location.buffer).toBe(editor.getBuffer());
    });

    it("clears its messages for a grammar that is not checked", async () => {
      lumine.config.set("spell-check.grammars", ["text.plain"]);
      editor.setText("thiss");

      expect(await lint()).toEqual([]);
    });

    it("honors the known-word list", async () => {
      lumine.config.set("spell-check.knownWords", ["thiss"]);
      editor.setText("thiss");

      expect(await lint()).toEqual([]);
    });

    it("clears its messages for an editor checking has been toggled off in", async () => {
      editor.setText("thiss");
      expect((await lint()).length).toBe(1);

      lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "spell-check:toggle");

      expect(await lint()).toEqual([]);
    });

    it("reports again once checking is toggled back on", async () => {
      editor.setText("thiss");
      const workspace = lumine.views.getView(lumine.workspace);
      lumine.commands.dispatch(workspace, "spell-check:toggle");
      expect(await lint()).toEqual([]);

      lumine.commands.dispatch(workspace, "spell-check:toggle");

      expect((await lint()).length).toBe(1);
    });
  });

  // A diff view, a patch preview, a commit box in a dock, the field inside a
  // picker: all real editors, none of them carrying a grammar, so the plain-text
  // entry in `grammars` matched every one and the command palette came up
  // underlined in red. Declaring the target set is what keeps them out, and the
  // linter is what enforces it.
  describe("which editors it asks for", () => {
    it("asks only for the documents the centre holds by default", () => {
      expect(lumine.config.get("spell-check.editors")).toBe("center");
      expect(linter.editors).toBe("center");
    });

    // Read on every run, so the setting takes effect without the provider being
    // registered again.
    it("widens to every editor when the setting says so", () => {
      lumine.config.set("spell-check.editors", "all");

      expect(linter.editors).toBe("any");

      lumine.config.set("spell-check.editors", "center");

      expect(linter.editors).toBe("center");
    });

    // A buffer nobody has saved yet is still one of those documents, which is why
    // narrowing the set does not cost the untitled case.
    it("still reports for an editor with no path", async () => {
      editor.setText("documnet");

      expect((await lint()).length).toBe(1);
    });
  });

  describe("checking a selection", () => {
    let published;

    beforeEach(() => {
      published = [];
      main.consumeLinterRegistry(() => ({
        name: "Spell Check/Selection",
        setAllMessages: (messages) => published.push(messages),
        clearMessages: () => published.push("cleared"),
        dispose: () => {},
      }));
    });

    const checkSelected = () => main.checkSelected({ target: lumine.views.getView(editor) });

    it("reports only what is selected, at its buffer position", async () => {
      editor.setText("line one\nhas a documnet here\n");
      editor.setSelectedBufferRange([
        [1, 6],
        [1, 14],
      ]);

      await checkSelected();

      expect(published.length).toBe(1);
      expect(published[0].length).toBe(1);
      expect(published[0][0].location.position).toEqual([
        [1, 6],
        [1, 14],
      ]);
      expect(editor.getTextInBufferRange(published[0][0].location.position)).toBe("documnet");
    });

    // Only the first row of a selection starts partway along a buffer row, so
    // only its columns shift.
    it("offsets a selection that starts mid-line and spans rows", async () => {
      editor.setText("line one\nhas a documnet here\n");
      editor.setSelectedBufferRange([
        [0, 5],
        [1, 18],
      ]);

      await checkSelected();

      const words = published[0].map((m) => editor.getTextInBufferRange(m.location.position));
      expect(words).toEqual(["documnet"]);
    });

    // The whole point: the text a user selects is usually text `grammars` does
    // not cover, whose ordinary lint reports nothing.
    it("checks a selection in a grammar that is not checked at all", async () => {
      lumine.config.set("spell-check.grammars", ["text.restructuredtext"]);
      editor.setText("a documnet here");
      expect(await lint()).toEqual([]);

      editor.setSelectedBufferRange([
        [0, 2],
        [0, 10],
      ]);
      await checkSelected();

      expect(published[0].length).toBe(1);
    });

    it("reports every selection when there are several", async () => {
      editor.setText("documnet and mispelled\n");
      editor.setSelectedBufferRanges([
        [
          [0, 0],
          [0, 8],
        ],
        [
          [0, 13],
          [0, 22],
        ],
      ]);

      await checkSelected();

      expect(published[0].length).toBe(2);
    });

    it("locates a selection by buffer while the buffer has no path", async () => {
      editor.setText("a documnet here");
      editor.setSelectedBufferRange([
        [0, 2],
        [0, 10],
      ]);

      await checkSelected();

      expect(published[0][0].location.buffer).toBe(editor.getBuffer());
      expect(published[0][0].location.file).toBeUndefined();
    });

    it("says so rather than publishing when nothing is selected", async () => {
      spyOn(lumine.notifications, "addWarning");
      editor.setText("a documnet here");
      editor.setCursorBufferPosition([0, 0]);

      await checkSelected();

      expect(published).toEqual([]);
      expect(lumine.notifications.addWarning).toHaveBeenCalled();
    });

    it("says so when the selection has no misspellings", async () => {
      spyOn(lumine.notifications, "addInfo");
      editor.setText("every word here is correct");
      editor.setSelectedBufferRange([
        [0, 0],
        [0, 26],
      ]);

      await checkSelected();

      expect(published[0]).toEqual([]);
      expect(lumine.notifications.addInfo).toHaveBeenCalled();
    });

    it("replaces the previous results rather than adding to them", async () => {
      editor.setText("documnet and mispelled\n");
      editor.setSelectedBufferRange([
        [0, 0],
        [0, 8],
      ]);
      await checkSelected();
      editor.setSelectedBufferRange([
        [0, 13],
        [0, 22],
      ]);
      await checkSelected();

      expect(published.length).toBe(2);
      expect(published[1].length).toBe(1);
      expect(editor.getTextInBufferRange(published[1][0].location.position)).toBe("mispelled");
    });

    it("clears them on request", () => {
      lumine.commands.dispatch(
        lumine.views.getView(lumine.workspace),
        "spell-check:clear-checked-selection",
      );

      expect(published).toEqual(["cleared"]);
    });

    // A selection check and the ongoing check of the same buffer are different
    // questions; neither may cancel the other.
    it("does not supersede the buffer's own check", async () => {
      editor.setText("a documnet here");
      editor.setSelectedBufferRange([
        [0, 2],
        [0, 10],
      ]);

      const buffered = lint();
      await checkSelected();

      expect((await buffered).length).toBe(1);
      expect(published[0].length).toBe(1);
    });
  });

  describe("scope filtering", () => {
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

      expect(await lint()).toEqual([]);
    });

    it("reports the same misspelling once nothing excludes its scope", async () => {
      editor.setText("// thiss");
      await commentIsTokenized([0, 3]);

      expect(wordsIn(await lint())).toEqual(["thiss"]);
    });

    it("checks only the named descendant scope when the setting names one", async () => {
      lumine.config.set("spell-check.grammars", ["source.js comment"]);
      editor.setText("// thiss\nthatt();");
      await commentIsTokenized([0, 3]);

      const messages = await lint();
      expect(wordsIn(messages)).toEqual(["thiss"]);
      // A raw range pair, not a `Range`: normalizing these into the editor's
      // types is the linter's job, not the provider's.
      expect(messages[0].location.position[0][0]).toBe(0);
    });

    it("does not resolve scope descriptors when nothing narrows the buffer", async () => {
      spyOn(editor, "scopeDescriptorForBufferPosition").and.callThrough();
      editor.setText("thiss and thatt");

      expect((await lint()).length).toBe(2);
      // Every checked grammar is a bare root scope and nothing is excluded, so
      // no descriptor can change the outcome and none should be asked for.
      expect(editor.scopeDescriptorForBufferPosition).not.toHaveBeenCalled();
    });

    it("resolves scope descriptors once something does narrow the buffer", async () => {
      lumine.config.set("spell-check.excludedScopes", ["comment"]);
      spyOn(editor, "scopeDescriptorForBufferPosition").and.callThrough();
      editor.setText("thiss and thatt");

      await lint();

      expect(editor.scopeDescriptorForBufferPosition).toHaveBeenCalled();
    });
  });

  describe("the corrections", () => {
    let intentions;

    beforeEach(() => {
      intentions = main.provideIntentionsList();
    });

    const intentionsAt = (bufferPosition) =>
      intentions.getIntentions({ textEditor: editor, bufferPosition });

    it("offers the dictionary's suggestions at a misspelling", async () => {
      editor.setText("thiss");
      await lint();

      const offered = await intentionsAt([0, 2]);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.map((intention) => intention.title)).toContain("this");
    });

    it("offers nothing away from a misspelling", async () => {
      editor.setText("correct thiss");
      await lint();

      expect(await intentionsAt([0, 2])).toEqual([]);
    });

    it("offers nothing before anything has been checked", async () => {
      editor.setText("thiss");

      expect(await intentionsAt([0, 2])).toEqual([]);
    });

    it("applies the correction it is asked for", async () => {
      editor.setText("thiss");
      await lint();
      const offered = await intentionsAt([0, 2]);
      const correction = offered.find((intention) => intention.title === "this");

      await correction.selected();

      expect(editor.getText()).toBe("this");
    });

    it("offers the known-word action when the setting allows it", async () => {
      // Changing the setting rebuilds the known-words checker, which is where
      // the action comes from.
      lumine.config.set("spell-check.addKnownWords", true);
      editor.setText("thiss");
      await lint();

      const offered = await intentionsAt([0, 2]);

      expect(offered.map((intention) => intention.title)).toContain("Add to Known Words");
    });

    // The same set on a dedicated keystroke, for a user who has `linter` but not
    // `intentions` installed.
    it("lists the same corrections from the command", async () => {
      editor.setText("thiss");
      await lint();

      lumine.commands.dispatch(lumine.views.getView(editor), "spell-check:correct-misspelling");

      const view = main.correctionsView;
      expect(view).not.toBeNull();
      expect(view.corrections.map((correction) => correction.label)).toContain("this");

      view.confirm();
      expect(editor.getText()).toBe("this");
    });

    it("opens nothing from the command away from a misspelling", async () => {
      editor.setText("correct");
      await lint();
      main.correctionsView = null;

      lumine.commands.dispatch(lumine.views.getView(editor), "spell-check:correct-misspelling");

      expect(main.correctionsView).toBeNull();
    });
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
