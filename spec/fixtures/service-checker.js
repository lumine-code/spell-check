module.exports = {
  deactivated: false,
  getId: () => "spell-check:test-service",
  getName: () => "Test service checker",
  getPriority: () => 1,
  isEnabled: () => true,
  getStatus: () => null,
  providesSpelling: () => true,
  providesSuggestions: () => false,
  providesAdding: () => false,
  check: () => ({ id: "spell-check:test-service", correct: [] }),
  suggest: () => [],
  deactivate() {
    this.deactivated = true;
  },
};
