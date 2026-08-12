class KnownWordsChecker {
  constructor(knownWords = []) {
    this.enableAdd = false;
    this.setKnownWords(knownWords);
  }

  deactivate() {}

  getId() {
    return "spell-check:known-words";
  }

  getName() {
    return "Known Words";
  }

  getPriority() {
    return 10;
  }

  // Enabled when there is anything to contribute: words to accept, or the action
  // that adds one. Without the second clause the action was unreachable from an
  // empty list — which is exactly when a user wants to start filling it.
  isEnabled() {
    return this.enableAdd || this.sensitive.size > 0 || this.insensitive.size > 0;
  }

  getStatus() {
    return "Working correctly.";
  }

  providesSpelling() {
    return true;
  }

  providesSuggestions() {
    return false;
  }

  providesAdding() {
    return this.enableAdd;
  }

  isKnown(word) {
    return this.sensitive.has(word) || this.insensitive.has(word.toLocaleLowerCase());
  }

  check(_args, text) {
    const correct = [];
    // Hyphens and apostrophes are part of a token, so a known word may be
    // written with them — `e-mail`, `tree-sitter`, `o'clock`.
    const tokenPattern = /[\p{L}\p{M}'’-]+/gu;
    // The same token's letter runs. A dictionary splits a compound and flags
    // only the part it does not know, so a known word inside one has to be
    // marked at that granularity too, or the two never line up: `SOFiSTiK` was
    // accepted on its own while `to-SOFiSTiK` stayed underlined.
    const partPattern = /[\p{L}\p{M}]+/gu;

    for (const match of text.matchAll(tokenPattern)) {
      const token = match[0];
      if (this.isKnown(token)) {
        correct.push({ start: match.index, end: match.index + token.length });
        continue;
      }

      for (const part of token.matchAll(partPattern)) {
        if (this.isKnown(part[0])) {
          const start = match.index + part.index;
          correct.push({ start, end: start + part[0].length });
        }
      }
    }

    return { id: this.getId(), correct };
  }

  suggest() {
    return [];
  }

  getAddingTargets() {
    return this.enableAdd ? [{ sensitive: false, label: `Add to ${this.getName()}` }] : [];
  }

  add(_args, target) {
    const knownWords = [...lumine.config.get("spell-check.knownWords")];
    if (!knownWords.includes(target.word)) knownWords.push(target.word);
    return lumine.config.set("spell-check.knownWords", knownWords);
  }

  setAddKnownWords(newValue) {
    this.enableAdd = newValue;
  }

  setKnownWords(knownWords = []) {
    this.sensitive = new Set();
    this.insensitive = new Set();

    for (const entry of knownWords) {
      if (typeof entry !== "string" || entry.length === 0) continue;
      if (entry.startsWith("!")) this.sensitive.add(entry.slice(1));
      else this.insensitive.add(entry.toLocaleLowerCase());
    }
  }
}

module.exports = KnownWordsChecker;
