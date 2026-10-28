describe("IPython Markdown spelling defaults", () => {
  let editor, main;
  const wordsIn = (messages) =>
    messages.map((message) => editor.getTextInBufferRange(message.location.position));

  beforeEach(async () => {
    for (const name of ["language-gfm", "language-python", "language-ipython"])
      await lumine.packages.activatePackage(name);
    lumine.config.unset("spell-check.grammars");
    lumine.config.unset("spell-check.excludedScopes");
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    lumine.config.set("spell-check.knownWords", []);
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    editor = await lumine.workspace.open();
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
  });

  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("spell-check");
  });

  it("checks Markdown prose while excluding Python, raw cells, code spans and link targets", async () => {
    editor.setText(
      '# %% Code\npythonmistak = "stringmistak"\n# commentmistak\n' +
        "# %% [markdown] headermistak\n# headingmistak\n\n" +
        "prosemistak **boldmistak** `inlinemistak`\n\n" +
        '[labelmistak](folder/pathmistak "titlemistak")\n\n' +
        "```python\nfencedmistak = 1\n```\n\n    indentedmistak\n\n" +
        "# %% [raw]\nrawmistak\n# %% Code\nlastmistak = 1\n",
    );

    expect(wordsIn(await main.provideLinter().lint(editor))).toEqual([
      "headingmistak",
      "prosemistak",
      "boldmistak",
      "labelmistak",
      "titlemistak",
    ]);
  });

  it("checks md markers and markdown magics and follows cell type changes", async () => {
    editor.setText(
      "# %% [md]\nmarkermistak\n# %% Code\n%%markdown\nmagicmistak `inlinemistak`\n" +
        "# %% End\npythonmistak = 1\n",
    );
    expect(wordsIn(await main.provideLinter().lint(editor))).toEqual([
      "markermistak",
      "magicmistak",
    ]);

    editor.setText(editor.getText().replace("[md]", "[raw]"));
    expect(wordsIn(await main.provideLinter().lint(editor))).toEqual(["magicmistak"]);
  });
});
