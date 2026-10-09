describe("Completed selection corrections", () => {
  let main, editor;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    lumine.config.set("spell-check.grammars", []);
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", true);
    lumine.config.set("spell-check.locales", ["en-US"]);
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("linter");
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("documnet");
    editor.selectAll();
    await main.checkSelected({ target: editor.getElement() });
    expect(main.indie.getMessages().length).toBe(1);
    expect(
      main.checkers
        .get(editor)
        .correctionsAt([0, 3])
        .corrections.map((x) => x.label),
    ).toContain("document");
  });

  afterEach(async () => {
    if (lumine.packages.isPackageActive("spell-check"))
      await lumine.packages.deactivatePackage("spell-check");
    if (lumine.packages.isPackageLoaded("spell-check"))
      await lumine.packages.unloadPackage("spell-check");
    editor?.destroy();
    for (const setting of ["grammars", "useSystem", "useLocales", "locales"])
      lumine.config.unset(`spell-check.${setting}`);
    main = editor = null;
  });

  it("drops old correction ranges after replacing the checked word", () => {
    editor.setText("document");
    expect(main.checkers.get(editor).misspellingAt([0, 3])).toBeNull();
    expect(
      main
        .provideAutocomplete()
        .getSuggestions({ editor, bufferPosition: [0, 3], activatedManually: true }),
    ).toEqual([]);
  });

  it("does not offer an old selection's correction for different text at the same position", () => {
    editor.setText("ordinary");
    expect(
      main.provideIntentionsList().getIntentions({ textEditor: editor, bufferPosition: [0, 3] }),
    ).toEqual([]);
  });

  it("keeps completed corrections when only the selection changes", () => {
    editor.setCursorBufferPosition([0, 3]);
    expect(
      main.checkers
        .get(editor)
        .correctionsAt([0, 3])
        .corrections.map((x) => x.label),
    ).toContain("document");
  });
});
