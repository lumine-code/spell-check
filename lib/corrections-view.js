const { CompositeDisposable } = require("lumine");

class CorrectionsView {
  constructor(editor, corrections, marker, updateTarget, updateCallback) {
    this.editor = editor;
    this.corrections = corrections;
    this.marker = marker;
    this.updateTarget = updateTarget;
    this.updateCallback = updateCallback;
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
    const item = this.corrections[this.selectedIndex];
    if (!item) return this.destroy();

    this.editor.transact(() => {
      if (item.isSuggestion) {
        this.editor.setSelectedBufferRange(this.marker.getBufferRange());
        this.editor.insertText(item.suggestion);
      } else {
        let projectPath = null;
        let relativePath = null;
        const filePath = this.editor.getPath();
        if (filePath) [projectPath, relativePath] = lumine.project.relativizePath(filePath);
        item.plugin.add({ projectPath, relativePath }, item);
        this.updateCallback.call(this.updateTarget);
      }
    });
    return this.destroy();
  }

  attach() {
    this.previouslyFocusedElement = document.activeElement;
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
    this.element.remove();
    this.previouslyFocusedElement?.focus();
    this.previouslyFocusedElement = null;
  }
}

module.exports = CorrectionsView;
