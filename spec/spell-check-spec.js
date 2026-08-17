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

  // Which editors are checked at all is the linter's question now — documents
  // only, plus whatever a package registered through `linter.editors` — so the
  // provider declares nothing about it.
  describe("which editors it asks for", () => {
    it("declares no editor target of its own", () => {
      expect("editors" in linter).toBe(false);
    });

    // A buffer nobody has saved yet is still a document, which is why the
    // narrowed default does not cost the untitled case.
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

    // The linter shows these, so they are underlined like anything else — and a
    // word you can see marked has to be a word you can act on. They reach the
    // corrections through the checker, the same way the buffer's own
    // misspellings do, even though an ordinary lint of this file reports none.
    describe("the corrections for them", () => {
      beforeEach(async () => {
        // A grammar the `grammars` setting does not cover: the case the command
        // exists for, and the one where `lint` contributes nothing.
        lumine.config.set("spell-check.grammars", ["source.gfm"]);
        editor.setText("a documnet here");
        editor.setSelectedBufferRange([
          [0, 2],
          [0, 10],
        ]);
        await checkSelected();
      });

      it("offers them at the cursor", () => {
        const found = main.checkers.get(editor).correctionsAt([0, 4]);

        expect(found).not.toBeNull();
        expect(found.corrections.map((correction) => correction.label)).toContain("document");
      });

      it("offers them through the autocomplete provider", async () => {
        const suggestions = await main.provideAutocomplete().getSuggestions({
          editor,
          bufferPosition: [0, 4],
          activatedManually: true,
        });

        expect(suggestions.map((suggestion) => suggestion.text)).toContain("document");
      });

      it("adds one to Known Words by command", () => {
        lumine.config.set("spell-check.knownWords", []);
        editor.setCursorBufferPosition([0, 4]);

        lumine.commands.dispatch(lumine.views.getView(editor), "spell-check:add-known-word");

        expect(lumine.config.get("spell-check.knownWords")).toContain("documnet");
      });

      it("forgets them once the results are cleared", () => {
        lumine.commands.dispatch(
          lumine.views.getView(lumine.workspace),
          "spell-check:clear-checked-selection",
        );

        expect(main.checkers.get(editor).correctionsAt([0, 4])).toBeNull();
      });

      // An ordinary lint replaces `messages`; these live beside it and must
      // survive that, or they would vanish on the next keystroke.
      it("survives an ordinary lint of the same buffer", async () => {
        await lint();

        expect(main.checkers.get(editor).correctionsAt([0, 4])).not.toBeNull();
      });
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

  // Code is not prose. The default Excluded Scopes keep it out of the check:
  // fenced and indented blocks and the fence's own info string, inline spans,
  // and embedded source regions, whatever language the fence names.
  describe("code inside a prose grammar", () => {
    beforeEach(async () => {
      await lumine.packages.activatePackage("language-gfm");
      lumine.config.set("spell-check.grammars", ["source.gfm"]);
      lumine.config.set(
        "spell-check.excludedScopes",
        require("../package.json").configSchema.excludedScopes.default,
      );
      editor.setGrammar(lumine.grammars.grammarForScopeName("source.gfm"));
      await editor.getBuffer().getLanguageMode().ready;
    });

    it("ships defaults that exclude code", () => {
      expect(require("../package.json").configSchema.excludedScopes.default).toEqual([
        "markup.raw",
        "markup.code",
        "meta.embedded",
      ]);
    });

    it("reports prose misspellings and leaves every kind of code alone", async () => {
      editor.setText(
        "# One heddingmistak\n" +
          "\n" +
          "Prose with a prosemistak and `inlinemistak` span.\n" +
          "\n" +
          "```js\n" +
          "const fencedmistak = 1;\n" +
          "```\n" +
          "\n" +
          "    indentedmistak block\n",
      );
      // The inline span's scopes come from an injected grammar, so wait until
      // they are actually in the tree before asking for messages.
      await conditionPromise(() => {
        const scopes = editor.scopeDescriptorForBufferPosition([2, 32]).getScopesArray();
        return scopes.some((scope) => /markup\.raw|meta\.embedded/.test(scope));
      });

      expect(wordsIn(await lint())).toEqual(["heddingmistak", "prosemistak"]);
    });

    // The linter lints an editor as it opens, before it is attached to
    // anything, and a language mode that has not tokenized does not refuse a
    // scope descriptor — it answers every position with the root scope alone,
    // so nothing is `markup.raw` yet and nothing is excluded. Nothing re-lints
    // once tokenizing catches up either, so a check that came back first left
    // every fenced block and inline span in the buffer underlined until the
    // next edit.
    it("holds its messages until the language mode has tokenized", async () => {
      editor.setText("Prose with a prosemistak and `inlinemistak` span.\n");
      const checker = main.checkerFor(editor);
      let releaseTokenization;
      spyOn(checker, "whenTokenized").and.returnValue(
        new Promise((resolve) => (releaseTokenization = resolve)),
      );

      let messages = null;
      const pending = checker.lint().then((result) => (messages = result));
      // The check itself has come back by now; only the wait is left.
      await conditionPromise(() => checker.whenTokenized.calls.any());
      expect(messages).toBeNull();

      releaseTokenization();
      await pending;

      expect(wordsIn(messages)).toEqual(["prosemistak"]);
    });

    // The wait is unbounded, so it cannot be the only way out: an editor that
    // is closed while its language mode is still parsing would otherwise leave
    // the linter holding a promise that never settles.
    it("gives up the wait when the editor goes away", async () => {
      const fresh = await lumine.workspace.open();
      fresh.setGrammar(lumine.grammars.grammarForScopeName("source.gfm"));
      fresh.setText("a prosemistak here\n");
      const checker = main.checkerFor(fresh);
      spyOn(checker, "tokenizationOf").and.returnValue(new Promise(() => {}));

      const pending = checker.lint();
      await conditionPromise(() => checker.tokenizationOf.calls.any());
      fresh.destroy();

      // Null, not an empty array: the editor is gone, so there is nothing to
      // say about it rather than nothing wrong with it.
      expect(await pending).toBeNull();
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

    // What the setting governs: the code action, not the capability.
    it("withholds that action from the code actions when the setting is off", async () => {
      lumine.config.set("spell-check.addKnownWords", false);
      editor.setText("thiss");
      await lint();

      const offered = await intentionsAt([0, 2]);

      expect(offered.length).toBeGreaterThan(0);
      expect(offered.map((intention) => intention.title)).not.toContain("Add to Known Words");
    });

    // The command is the user asking outright, so it needs no permission from a
    // setting about what a menu offers.
    it("still adds the word by command with the setting off", async () => {
      lumine.config.set("spell-check.addKnownWords", false);
      lumine.config.set("spell-check.knownWords", []);
      editor.setText("thiss");
      await lint();
      editor.setCursorBufferPosition([0, 2]);

      lumine.commands.dispatch(lumine.views.getView(editor), "spell-check:add-known-word");

      expect(lumine.config.get("spell-check.knownWords")).toEqual(["thiss"]);
    });

    it("says so when there is no misspelling to add", async () => {
      spyOn(lumine.notifications, "addWarning");
      editor.setText("correct");
      await lint();
      editor.setCursorBufferPosition([0, 2]);

      lumine.commands.dispatch(lumine.views.getView(editor), "spell-check:add-known-word");

      expect(lumine.notifications.addWarning).toHaveBeenCalled();
      expect(lumine.config.get("spell-check.knownWords")).toEqual([]);
    });

    // The command opens the autocomplete menu, which this package supplies the
    // corrections to. There is no picker of our own any more.
    it("opens the autocomplete menu from the command", async () => {
      editor.setText("thiss");
      await lint();
      const dispatched = [];
      spyOn(lumine.commands, "dispatch").and.callFake((target, name, detail) => {
        dispatched.push({ name, detail });
      });

      main.correctMisspelling({ target: lumine.views.getView(editor) });

      expect(dispatched).toEqual([
        { name: "autocomplete:activate", detail: { activatedManually: true } },
      ]);
    });

    it("opens nothing from the command away from a misspelling", async () => {
      editor.setText("correct");
      await lint();
      const dispatched = [];
      spyOn(lumine.commands, "dispatch").and.callFake((target, name) => dispatched.push(name));

      main.correctMisspelling({ target: lumine.views.getView(editor) });

      expect(dispatched).toEqual([]);
    });
  });

  // The corrections are autocomplete suggestions: one list in the editor, and
  // no picker of this package's own. Three fields carry the whole contract —
  // `ranges` for the geometry, the priorities for the ordering, and
  // `activatedManually` for when they appear at all.
  describe("the autocomplete provider", () => {
    let provider;

    beforeEach(() => {
      provider = main.provideAutocomplete();
    });

    const suggestionsAt = (bufferPosition, overrides = {}) =>
      provider.getSuggestions({
        editor,
        bufferPosition,
        activatedManually: true,
        ...overrides,
      });

    it("declares itself above the buffer's own words", () => {
      expect(provider.scopeSelector).toBe("*");
      expect(provider.inclusionPriority).toBe(100);
      expect(provider.suggestionPriority).toBe(100);
      // What the user typed says nothing about which correction applies.
      expect(provider.filterSuggestions).toBe(false);
    });

    it("serves the editors packages register, not just the workspace center", () => {
      // Corrections follow the linter into editors watched under the `default`
      // label — the commit box — and a provider without labels never reaches
      // them.
      expect(provider.labels).toEqual(["workspace-center", "default"]);
    });

    it("replaces the whole misspelling through `ranges`", async () => {
      editor.setText("thiss");
      await lint();

      const suggestions = await suggestionsAt([0, 2]);

      expect(suggestions.map((suggestion) => suggestion.text)).toContain("this");
      const [first] = suggestions;
      // The cursor sits mid-word, so a prefix-based insertion would mangle it;
      // the range covers the misspelling however the menu was reached.
      expect(first.ranges.length).toBe(1);
      expect(first.ranges[0].serialize()).toEqual([
        [0, 0],
        [0, 5],
      ]);
    });

    // Typing a word raises the same `triggerKind` as asking for the menu, so
    // this flag is the only thing that separates them. Without it every prose
    // keystroke would offer corrections.
    it("offers nothing when the menu was not asked for", async () => {
      editor.setText("thiss");
      await lint();

      expect(await suggestionsAt([0, 2], { activatedManually: false })).toEqual([]);
    });

    it("offers nothing away from a misspelling", async () => {
      editor.setText("correct thiss");
      await lint();

      expect(await suggestionsAt([0, 2])).toEqual([]);
    });

    // A suggestion inserts text. Adding a word to the dictionary changes a
    // setting instead, so it is a command rather than a menu row that would
    // have to insert the word it already found there.
    it("leaves the known-word action out of the menu and does it by command", async () => {
      lumine.config.set("spell-check.addKnownWords", true);
      editor.setText("thiss");
      await lint();

      const suggestions = await suggestionsAt([0, 2]);
      expect(suggestions.map((suggestion) => suggestion.text)).not.toContain("Add to Known Words");
      expect(suggestions.every((suggestion) => suggestion.ranges)).toBe(true);

      editor.setCursorBufferPosition([0, 2]);
      lumine.commands.dispatch(lumine.views.getView(editor), "spell-check:add-known-word");

      expect(lumine.config.get("spell-check.knownWords")).toContain("thiss");
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
