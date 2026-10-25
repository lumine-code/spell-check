describe("spelling context correction target", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, editor, element, calls, dispatch;
  function seed() {
    const checker = main.checkers.get(editor);
    checker.messages = checker.buildMessages([
      [
        [0, 5],
        [0, 12],
      ],
    ]);
    const manager = main.getInstance(main.globalArgs);
    if (!jasmine.isSpy(manager.suggest)) spyOn(manager, "suggest");
    manager.suggest.and.returnValue([
      { isSuggestion: true, suggestion: "correct", label: "correct" },
    ]);
  }
  function contextTemplateAt(position = [0, 7], offset = {}) {
    const component = element.getComponent();
    const pixel = element.pixelPositionForBufferPosition(position);
    const rectangle = component.refs.lineTiles.getBoundingClientRect();
    const event = {
      target: element.querySelector(".line") ?? element,
      button: 2,
      clientX: rectangle.left + pixel.left + 1 + (offset.left ?? 0),
      clientY: rectangle.top + pixel.top + component.getLineHeight() / 2 + (offset.top ?? 0),
    };
    return lumine.contextMenu.templateForEvent(event);
  }
  function contextItem() {
    const item = contextTemplateAt().find(
      (item) => item.command === "spell-check:correct-misspelling",
    );
    expect(item).toBeDefined();
    return item;
  }
  beforeEach(async () => {
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "800px";
    workspace.style.height = "400px";
    jasmine.attachToDOM(workspace);
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("good zzzzzzz");
    editor.setCursorBufferPosition([0, 0]);
    element = lumine.views.getView(editor);
    seed();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    calls = [];
    dispatch = lumine.commands.dispatch.bind(lumine.commands);
    // Intercept the outer UI opener only; actual context templates and command/provider routes remain live.
    spyOn(lumine.commands, "dispatch").and.callFake((target, command, detail) => {
      if (command === "autocomplete:activate") {
        calls.push({
          target,
          detail,
          suggestions: main.provideAutocomplete().getSuggestions({
            editor,
            bufferPosition: editor.getCursorBufferPosition(),
            activatedManually: true,
          }),
        });
        return;
      }
      return dispatch(target, command, detail);
    });
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("spell-check");
    editor.destroy();
  });

  it("hides correction on correct text even when the caret is in a misspelling", () => {
    editor.setCursorBufferPosition([0, 7]);
    for (const position of [
      [0, 1],
      [0, 4],
    ]) {
      expect(
        contextTemplateAt(position).some(
          (item) => item.command === "spell-check:correct-misspelling",
        ),
      ).toBe(false);
    }
    expect(main.getInstance(main.globalArgs).suggest).not.toHaveBeenCalled();
    expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 7]);
  });

  it("includes correction for a typo found by an explicit check", () => {
    const checker = main.checkers.get(editor);
    checker.setSelectionMessages(checker.messages);
    checker.messages = [];
    contextItem();
    expect(main.getInstance(main.globalArgs).suggest).not.toHaveBeenCalled();
  });

  it("hides correction in blank space beside and below a misspelled final word", () => {
    for (const offset of [{ left: 100 }, { top: element.getComponent().getLineHeight() * 2 }]) {
      expect(
        contextTemplateAt([0, 12], offset).some(
          (item) => item.command === "spell-check:correct-misspelling",
        ),
      ).toBe(false);
    }
  });

  it("uses the caret to decide visibility for a keyboard context menu", () => {
    const hasCorrection = () =>
      lumine.contextMenu
        .templateForEvent({ target: element })
        .some((item) => item.command === "spell-check:correct-misspelling");
    expect(hasCorrection()).toBe(false);
    editor.setCursorBufferPosition([0, 7]);
    expect(hasCorrection()).toBe(true);
    editor.setCursorBufferPosition([0, 12]);
    expect(hasCorrection()).toBe(true);
    expect(main.getInstance(main.globalArgs).suggest).not.toHaveBeenCalled();
  });

  it("moves to the clicked typo only when the actual context correction is confirmed", async () => {
    const item = contextItem();
    expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 0]);
    await lumine.commands.dispatch(element, item.command, item.commandDetail);
    expect(calls.length).toBe(1);
    expect(calls[0]?.suggestions.map((item) => item.text)).toEqual(["correct"]);
    expect(editor.getCursorBufferPosition().column).toBeGreaterThanOrEqual(5);
    expect(editor.getText()).toBe("good zzzzzzz");
  });

  it("declines a retained context item after its captured buffer text changes", async () => {
    const item = contextItem();
    editor.setText("good correct");
    editor.setCursorBufferPosition([0, 7]);
    await lumine.commands.dispatch(element, item.command, item.commandDetail);
    expect(calls.length).toBe(0);
    expect(editor.getText()).toBe("good correct");
  });

  it("declines an old context item after the package is reactivated", async () => {
    const item = contextItem();
    await lumine.packages.deactivatePackage("spell-check");
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    seed();
    editor.setCursorBufferPosition([0, 7]);
    await lumine.commands.dispatch(element, item.command, item.commandDetail);
    expect(calls.length).toBe(0);
  });

  it("keeps the current caret semantics for the ordinary command", async () => {
    editor.setCursorBufferPosition([0, 7]);
    await lumine.commands.dispatch(element, "spell-check:correct-misspelling");
    expect(calls.length).toBe(1);
    expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 7]);
  });
});
