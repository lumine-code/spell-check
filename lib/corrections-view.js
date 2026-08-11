const { CompositeDisposable } = require("lumine");

// The corrections for one misspelling, as a list beside it.
//
// This is the same set the `intentions.list` service offers as code actions, on
// a dedicated keystroke that does not need the `intentions` package installed.
class CorrectionsView {
  constructor(editor, range, corrections, onConfirm) {
    this.editor = editor;
    this.range = range;
    this.corrections = corrections;
    this.onConfirm = onConfirm;
    this.selectedIndex = 0;
    this.disposables = new CompositeDisposable();
    this.element = document.createElement("div");
    this.element.className = "spell-check-corrections corrections popover-list";
    this.element.tabIndex = -1;
    this.list = document.createElement("ol");
    this.element.appendChild(this.list);
    this.render();

    this.disposables.add(
      lumine.commands.add(this.element, {
        "core:move-up": () => this.move(-1),
        "core:move-down": () => this.move(1),
        "core:confirm": () => this.confirm(),
        "core:cancel": () => this.destroy(),
      }),
    );
  }

  render() {
    this.list.replaceChildren();
    if (this.corrections.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-message";
      empty.textContent = "No corrections";
      this.list.appendChild(empty);
      return;
    }

    this.corrections.forEach((correction, index) => {
      const item = document.createElement("li");
      item.textContent = correction.label;
      item.classList.toggle("selected", index === this.selectedIndex);
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.selectedIndex = index;
        this.confirm();
      });
      this.list.appendChild(item);
    });
  }

  move(delta) {
    if (this.corrections.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.corrections.length) % this.corrections.length;
    this.render();
  }

  confirm() {
    const correction = this.corrections[this.selectedIndex];
    if (correction) this.onConfirm(correction);
    return this.destroy();
  }

  attach() {
    this.previouslyFocusedElement = document.activeElement;
    // An overlay decoration needs a marker, and the misspellings are the
    // linter's markers now — not this package's. One of its own, for as long as
    // the list is up, is cheaper than reaching for someone else's.
    this.marker = this.editor.markBufferRange(this.range, { invalidate: "never" });
    this.overlayDecoration = this.editor.decorateMarker(this.marker, {
      type: "overlay",
      item: this,
    });
    process.nextTick(() => this.element.focus());
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disposables.dispose();
    this.overlayDecoration?.destroy();
    this.marker?.destroy();
    this.element.remove();
    this.previouslyFocusedElement?.focus();
    this.previouslyFocusedElement = null;
  }
}

module.exports = CorrectionsView;
