describe("Markdown spelling ranges", () => {
  let main, editor, linter;
  const wordsIn = (messages) =>
    messages.map((message) => editor.getTextInBufferRange(message.location.position));

  beforeEach(async () => {
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    lumine.config.set("spell-check.knownWords", []);
    lumine.config.set("spell-check.grammars", ["source.gfm"]);
    lumine.config.unset("spell-check.excludedScopes");
    await lumine.packages.activatePackage("language-gfm");
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.gfm"));
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    linter = main.provideLinter();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("spell-check");
    editor.destroy();
  });

  it("leaves an image's relative path out of the README caption check", async () => {
    editor.setText(
      "![Bookmark important lines and navigate between them in the editor.](.github/demo.png)\n",
    );
    expect(wordsIn(await linter.lint(editor))).toEqual([]);
  });

  it("checks link text, image descriptions and titles while skipping destinations", async () => {
    editor.setText(
      '[labelmistak](https://hostmistak.invalid/pathmistak "titlemistak")\n' +
        '![captionmistak](images/assetmistak.png "imagemistak")\n' +
        "<https://automistak.invalid/pathmistak>\n",
    );
    expect(wordsIn(await linter.lint(editor))).toEqual([
      "labelmistak",
      "titlemistak",
      "captionmistak",
      "imagemistak",
    ]);
  });

  it("checks a selected destination directly while whole-file checks respect its scope", async () => {
    editor.setText("[correct](folder/pathmistak.txt)\n");
    let published;
    main.consumeLinterRegistry(() => ({
      setAllMessages: (messages) => (published = messages),
      clearMessages() {},
      dispose() {},
    }));

    editor.setCursorBufferPosition([0, 0]);
    await main.checkSpelling({ target: editor.getElement() });
    expect(wordsIn(published)).toEqual([]);

    const column = editor.getText().indexOf("pathmistak");
    editor.setSelectedBufferRange([
      [0, column],
      [0, column + "pathmistak".length],
    ]);
    await main.checkSpelling({ target: editor.getElement() });
    expect(wordsIn(published)).toEqual(["pathmistak"]);
  });

  it("checks reference link text and titles while skipping reference destinations", async () => {
    editor.setText(
      "[labelmistak][correct]\n\n" + '[correct]: folder/pathmistak.txt "titlemistak"\n',
    );
    expect(wordsIn(await linter.lint(editor))).toEqual(["labelmistak", "titlemistak"]);
  });

  it("checks destinations again when the exclusions are cleared", async () => {
    editor.setText("[correct](pathmistak)\n");
    lumine.config.set("spell-check.excludedScopes", []);
    expect(wordsIn(await linter.lint(editor))).toEqual(["pathmistak"]);
  });
});
