describe("Spell Check command availability", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, editor;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    editor = await lumine.workspace.open();
  });
  afterEach(async () => {
    editor.destroy();
    await lumine.packages.deactivatePackage("spell-check");
  });
  it("uses cached results-sink presence without constructing a dictionary", () => {
    const previous = main.indie;
    spyOn(main, "getInstance").and.callThrough();
    main.indie = null;
    expect(lumine.commands.canDispatch(editor.element, "spell-check:check-spelling")).toBe(false);
    main.indie = {};
    expect(lumine.commands.canDispatch(editor.element, "spell-check:check-spelling")).toBe(true);
    main.indie = previous;
    expect(main.getInstance).not.toHaveBeenCalled();
  });
});
