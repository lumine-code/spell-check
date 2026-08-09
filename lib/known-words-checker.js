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

  isEnabled() {
    return this.sensitive.size > 0 || this.insensitive.size > 0;
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

  check(_args, text) {
    const correct = [];
    const tokenPattern = /[\p{L}\p{M}'’-]+/gu;

    for (const match of text.matchAll(tokenPattern)) {
      const word = match[0];
      if (this.sensitive.has(word) || this.insensitive.has(word.toLocaleLowerCase())) {
        correct.push({
          start: match.index,
          end: match.index + word.length,
        });
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
