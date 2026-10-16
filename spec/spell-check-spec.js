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
    lumine.config.unset("spell-check.addKnownWords");
    lumine.config.unset("spell-check.severity");

    await lumine.packages.activatePackage("language-javascript");
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
    it("keeps correction shortcuts off readonly editors while allowing checks", () => {
      const sink = main.consumeLinterRegistry(() => ({
        setAllMessages() {},
        clearMessages() {},
        dispose() {},
      }));
      const target = editor.getElement();
      expect(
        lumine.keymaps.findKeyBindings({ target, command: "spell-check:correct-misspelling" })
          .length,
      ).toBeGreaterThan(0);
      target.setAttribute("readonly", "");
      expect(lumine.commands.canDispatch(target, "spell-check:check-spelling")).toBe(true);
      expect(lumine.commands.canDispatch(target, "spell-check:correct-misspelling")).toBe(false);
      expect(
        lumine.keymaps.findKeyBindings({ target, command: "spell-check:correct-misspelling" })
          .length,
      ).toBe(0);
      sink.dispose();
    });

    it("keeps editor commands unavailable on the workspace and toggles the dispatch editor", async () => {
      editor.setText("thiss");
      expect((await lint()).length).toBe(1);
      const other = await lumine.workspace.open();
      try {
        other.setGrammar(editor.getGrammar());
        other.setText("thiss");
        expect((await linter.lint(other)).length).toBe(1);
        for (const command of [
          "toggle",
          "correct-misspelling",
          "add-known-word",
          "check-spelling",
        ]) {
          expect(
            lumine.commands.canDispatch(lumine.workspace.getElement(), `spell-check:${command}`),
          ).toBe(false);
        }
        lumine.commands.dispatch(editor.getElement(), "spell-check:toggle");
        expect(await lint()).toEqual([]);
        expect((await linter.lint(other)).length).toBe(1);
      } finally {
        other.destroy();
      }
    });

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
      expect(messages[0].severity).toBe("hint");
      expect(messages[0].excerpt).toBe("thiss is not in the dictionary");
    });

    it("reports the severity the setting asks for", async () => {
      lumine.config.set("spell-check.severity", "error");
      editor.setText("thiss");

      expect((await lint())[0].severity).toBe("error");
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

      lumine.commands.dispatch(editor.getElement(), "spell-check:toggle");

      expect(await lint()).toEqual([]);
    });

    it("reports again once checking is toggled back on", async () => {
      editor.setText("thiss");
      lumine.commands.dispatch(editor.getElement(), "spell-check:toggle");
      expect(await lint()).toEqual([]);

      lumine.commands.dispatch(editor.getElement(), "spell-check:toggle");

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

  describe("explicit spelling checks", () => {
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

    const checkSpelling = () => main.checkSpelling({ target: lumine.views.getView(editor) });

    it("reports only what is selected, at its buffer position", async () => {
      editor.setText("line one\nhas a documnet here\n");
      editor.setSelectedBufferRange([
        [1, 6],
        [1, 14],
      ]);

      await checkSpelling();

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

      await checkSpelling();

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
      await checkSpelling();

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

      await checkSpelling();

      expect(published[0].length).toBe(2);
    });

    it("locates a selection by buffer while the buffer has no path", async () => {
      editor.setText("a documnet here");
      editor.setSelectedBufferRange([
        [0, 2],
        [0, 10],
      ]);

      await checkSpelling();

      expect(published[0][0].location.buffer).toBe(editor.getBuffer());
      expect(published[0][0].location.file).toBeUndefined();
    });

    it("checks the whole buffer when every selection is empty", async () => {
      editor.setText("a documnet here\na mispelled word");
      editor.setSelectedBufferRanges([
        [
          [0, 0],
          [0, 0],
        ],
        [
          [1, 0],
          [1, 0],
        ],
      ]);
      await checkSpelling();

      expect(published.length).toBe(1);
      expect(wordsIn(published[0])).toEqual(["documnet", "mispelled"]);
      expect(published[0].map((message) => message.location.position)).toEqual([
        [
          [0, 2],
          [0, 10],
        ],
        [
          [1, 2],
          [1, 11],
        ],
      ]);
      expect(published[0][0].location.buffer).toBe(editor.getBuffer());
      expect(main.checkers.get(editor).correctionsAt([1, 4])).not.toBeNull();
    });

    it("checks only allowed descendant scopes and preserves exclusions for a whole file", async () => {
      lumine.config.set("spell-check.grammars", ["source.js comment"]);
      lumine.config.set("spell-check.excludedScopes", ["comment.block"]);
      editor.setText('// thiss\nconst text = "thatt";\n/* documnet */');
      editor.setCursorBufferPosition([1, 0]);
      for (const [position, prefix] of [
        [[0, 3], "comment.line"],
        [[1, 15], "string.quoted"],
        [[2, 3], "comment.block"],
      ]) {
        await conditionPromise(() =>
          editor
            .scopeDescriptorForBufferPosition(position)
            .getScopesArray()
            .some((scope) => scope.startsWith(prefix)),
        );
      }

      await checkSpelling();

      expect(published.length).toBe(1);
      expect(wordsIn(published[0])).toEqual(["thiss"]);
      expect(published[0][0].location.position).toEqual([
        [0, 3],
        [0, 8],
      ]);
    });

    it("skips a whole file whose grammar is not checked", async () => {
      lumine.config.set("spell-check.grammars", ["text.restructuredtext"]);
      editor.setText("a documnet here");
      editor.setCursorBufferPosition([0, 0]);
      const manager = main.getInstance(main.globalArgs);
      spyOn(manager, "check").and.callThrough();

      await checkSpelling();

      expect(published).toEqual([[]]);
      expect(manager.check).not.toHaveBeenCalled();
    });

    it("checks only nonempty selections and bypasses scope settings when some cursors have no selection", async () => {
      lumine.config.set("spell-check.grammars", []);
      lumine.config.set("spell-check.excludedScopes", ["source.js"]);
      editor.setText("documnet and mispelled");
      editor.setSelectedBufferRanges([
        [
          [0, 0],
          [0, 0],
        ],
        [
          [0, 13],
          [0, 22],
        ],
      ]);

      await checkSpelling();

      expect(published.length).toBe(1);
      expect(wordsIn(published[0])).toEqual(["mispelled"]);
    });

    it("cancels a whole file's pending grammar wait when its results are cleared", async () => {
      lumine.config.set("spell-check.grammars", ["source.js comment"]);
      editor.setText("// thiss");
      editor.setCursorBufferPosition([0, 0]);
      let signal;
      const whenGrammarSettled = spyOn(editor, "whenGrammarSettled").and.callFake((options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(false), { once: true });
        });
      });
      const pending = checkSpelling();
      await conditionPromise(() => whenGrammarSettled.calls.any());

      lumine.commands.dispatch(
        lumine.workspace.getElement(),
        "spell-check:clear-checked-selection",
      );
      await pending;

      expect(signal.aborted).toBe(true);
      expect(published).toEqual(["cleared"]);
    });

    it("says so when a whole file has no misspellings", async () => {
      spyOn(lumine.notifications, "addInfo");
      editor.setText("every word here is correct");
      editor.setCursorBufferPosition([0, 0]);

      await checkSpelling();

      expect(published).toEqual([[]]);
      expect(lumine.notifications.addInfo).toHaveBeenCalledWith("No misspellings in the file.");
    });

    it("says so when the selection has no misspellings", async () => {
      spyOn(lumine.notifications, "addInfo");
      editor.setText("every word here is correct");
      editor.setSelectedBufferRange([
        [0, 0],
        [0, 26],
      ]);

      await checkSpelling();

      expect(published[0]).toEqual([]);
      expect(lumine.notifications.addInfo).toHaveBeenCalledWith(
        "No misspellings in the selection.",
      );
    });

    it("replaces the previous results rather than adding to them", async () => {
      editor.setText("documnet and mispelled\n");
      editor.setSelectedBufferRange([
        [0, 0],
        [0, 8],
      ]);
      await checkSpelling();
      editor.setSelectedBufferRange([
        [0, 13],
        [0, 22],
      ]);
      await checkSpelling();

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
        await checkSpelling();
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
      await checkSpelling();

      expect((await buffered).length).toBe(1);
      expect(published[0].length).toBe(1);
    });
  });

  describe("scope filtering", () => {
    // Scope filtering can only work once the grammar has parsed, and which
    // parse completes asynchronously. Wait until the editor reports a comment
    // scope where we put one.
    const commentIsParsed = (position) =>
      conditionPromise(() =>
        editor
          .scopeDescriptorForBufferPosition(position)
          .getScopesArray()
          .some((scope) => scope.startsWith("comment")),
      );

    it("skips a misspelling whose scope is excluded", async () => {
      lumine.config.set("spell-check.excludedScopes", ["comment"]);
      editor.setText("// thiss");
      await commentIsParsed([0, 3]);

      expect(await lint()).toEqual([]);
    });

    it("reports the same misspelling once nothing excludes its scope", async () => {
      editor.setText("// thiss");
      await commentIsParsed([0, 3]);

      expect(wordsIn(await lint())).toEqual(["thiss"]);
    });

    it("checks only the named descendant scope when the setting names one", async () => {
      lumine.config.set("spell-check.grammars", ["source.js comment"]);
      editor.setText("// thiss\nthatt();");
      await commentIsParsed([0, 3]);

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
      expect(await editor.whenGrammarSettled()).toBe(true);
    });

    it("ships defaults that exclude code", () => {
      const excludedScopes = require("../package.json").configSchema.excludedScopes.default;
      for (const scope of ["markup.raw", "markup.code", "meta.embedded"]) {
        expect(excludedScopes).toContain(scope);
      }
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

    it("leaves the README's HTML picture markup out of prose results", async () => {
      await lumine.packages.activatePackage("language-html");
      editor.setText(
        "A prosemistak outside the picture.\n" +
          "\n" +
          "<picture>\n" +
          '  <source media="(prefers-color-scheme: dark)" srcset="resources/brand/banner-dark.png">\n' +
          '  <img src="resources/brand/banner.png" alt="Lumine — your editor, your way." width="1600">\n' +
          "</picture>\n",
      );

      expect(wordsIn(await lint())).toEqual(["prosemistak"]);
    });

    it("checks inline and block HTML text while excluding tags and attributes", async () => {
      await lumine.packages.activatePackage("language-html");
      editor.setText(
        "Text <custommistak attributemistak=\"doublemistak\" singlemistak='singlevaluemistak' baremistak=unquotedmistak>inlinemistak</custommistak>.\n" +
          "\n" +
          "<div>\n" +
          "blockmistak\n" +
          "</div>\n",
      );

      expect(wordsIn(await lint())).toEqual(["inlinemistak", "blockmistak"]);
    });

    it("checks HTML attribute values again when the exclusions are cleared", async () => {
      await lumine.packages.activatePackage("language-html");
      editor.setText('<span title="thiss">thiss</span>\n');
      lumine.config.set("spell-check.excludedScopes", []);

      expect(wordsIn(await lint())).toEqual(["thiss", "thiss"]);
    });

    it("uses the public waiter for an editor whose parse is already settled", async () => {
      editor.setText("Prose with a prosemistak.\n");
      expect(await editor.whenGrammarSettled()).toBe(true);
      const whenGrammarSettled = spyOn(editor, "whenGrammarSettled").and.callThrough();

      expect(wordsIn(await lint())).toEqual(["prosemistak"]);
      expect(whenGrammarSettled).toHaveBeenCalledWith({ signal: undefined });
    });

    // The linter lints an editor as it opens, before it is attached to
    // anything, and a language mode that has not parsed does not refuse a
    // scope descriptor — it answers every position with the root scope alone,
    // so nothing is `markup.raw` yet and nothing is excluded. Nothing re-lints
    // once parsing catches up either, so a check that came back first left
    // every fenced block and inline span in the buffer underlined until the
    // next edit.
    it("holds its messages until the grammar has settled", async () => {
      editor.setText("Prose with a prosemistak and `inlinemistak` span.\n");
      const checker = main.checkerFor(editor);
      let releaseParsing;
      const whenGrammarSettled = spyOn(editor, "whenGrammarSettled").and.returnValue(
        new Promise((resolve) => (releaseParsing = resolve)),
      );

      let messages = null;
      const pending = checker.lint().then((result) => (messages = result));
      // The check itself has come back by now; only the wait is left.
      await conditionPromise(() => whenGrammarSettled.calls.any());
      expect(messages).toBeNull();

      releaseParsing(true);
      await pending;

      expect(wordsIn(messages)).toEqual(["prosemistak"]);
    });

    it("returns null when a grammar change invalidates the pending parse", async () => {
      editor.setText("a prosemistak here\n");
      const checker = main.checkerFor(editor);
      const whenGrammarSettled = spyOn(editor, "whenGrammarSettled").and.callFake(
        () =>
          new Promise((resolve) => {
            const subscription = editor.onDidChangeGrammar(() => {
              subscription.dispose();
              resolve(false);
            });
          }),
      );

      const pending = checker.lint();
      await conditionPromise(() => whenGrammarSettled.calls.any());
      editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));

      expect(await pending).toBeNull();
    });

    it("gives up the wait when the editor goes away", async () => {
      const fresh = await lumine.workspace.open();
      fresh.setGrammar(lumine.grammars.grammarForScopeName("source.gfm"));
      fresh.setText("a prosemistak here\n");
      const checker = main.checkerFor(fresh);
      const whenGrammarSettled = spyOn(fresh, "whenGrammarSettled").and.callFake(
        () =>
          new Promise((resolve) => {
            const subscription = fresh.onDidDestroy(() => {
              subscription.dispose();
              resolve(false);
            });
          }),
      );

      const pending = checker.lint();
      await conditionPromise(() => whenGrammarSettled.calls.any());
      fresh.destroy();

      // Null, not an empty array: the editor is gone, so there is nothing to
      // say about it rather than nothing wrong with it.
      expect(await pending).toBeNull();
    });

    it("forwards an AbortSignal and returns null when it is aborted", async () => {
      editor.setText("a prosemistak here\n");
      const checker = main.checkerFor(editor);
      const controller = new AbortController();
      const whenGrammarSettled = spyOn(editor, "whenGrammarSettled").and.callFake(
        ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve(false), { once: true });
          }),
      );

      const pending = checker.lint({ signal: controller.signal });
      await conditionPromise(() => whenGrammarSettled.calls.any());
      controller.abort();

      expect(await pending).toBeNull();
      expect(whenGrammarSettled).toHaveBeenCalledWith({ signal: controller.signal });
    });

    it("returns null when the waiter reports a parse error", async () => {
      editor.setText("a prosemistak here\n");
      const checker = main.checkerFor(editor);
      spyOn(editor, "whenGrammarSettled").and.returnValue(Promise.resolve(false));
      const scopes = spyOn(editor, "scopeDescriptorForBufferPosition").and.callThrough();

      expect(await checker.lint()).toBeNull();
      expect(scopes).not.toHaveBeenCalled();
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

    it("offers the known-word action by default", async () => {
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

    it("opens corrections for a checked mini editor instead of the file behind it", () => {
      const miniEditor = lumine.workspace.buildTextEditor({ mini: true });
      const registration = lumine.textEditors.add(miniEditor, { role: "input" });
      const miniElement = lumine.views.getView(miniEditor);
      lumine.workspace.getElement().appendChild(miniElement);
      main.checkers.set(miniEditor, {
        correctionsAt: jasmine.createSpy("correctionsAt").and.returnValue({}),
      });
      const dispatch = spyOn(lumine.commands, "dispatch");

      try {
        main.correctMisspelling({ target: miniElement });

        expect(dispatch).toHaveBeenCalledWith(miniElement, "autocomplete:activate", {
          activatedManually: true,
        });
      } finally {
        registration.dispose();
        miniEditor.destroy();
      }
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
