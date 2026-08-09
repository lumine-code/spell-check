Register external spelling checker modules with the spell-check hub.

| Metadata    | Value                     |
| ----------- | ------------------------- |
| Version     | `1.0.0`                   |
| Provided by | Spelling checker packages |
| Consumed by | `spell-check`             |
| Owner       | `spell-check`             |

## Registration

Declare `spell-check` in `providedServices` and return an absolute module path, or an array of absolute module paths, from the registered provider method. Each module must export a checker object or a default checker class.

## Contract

```ts
type CheckArguments = {
  projectPath: string | null;
  relativePath: string | null;
  text?: string;
};

type CharacterRange = { start: number; end: number };

interface Checker {
  getId(): string;
  getName(): string;
  getPriority(): number;
  isEnabled(): boolean;
  getStatus(): string | null;
  providesSpelling(args: CheckArguments): boolean;
  providesSuggestions(args: CheckArguments): boolean;
  providesAdding(args: CheckArguments): boolean;
  check(args: CheckArguments, text: string): Promise<CheckResult> | CheckResult;
  suggest(args: CheckArguments, word: string): string[];
  getAddingTargets?(args: CheckArguments): AddingTarget[];
  add?(args: CheckArguments, target: AddingTarget & { word: string }): void;
  deactivate?(): void;
}

type CheckResult = {
  id: string;
  status?: string | null;
  correct?: CharacterRange[];
  incorrect?: CharacterRange[];
  invertIncorrectAsCorrect?: boolean;
};

type AddingTarget = {
  label: string;
  sensitive?: boolean;
};
```

## Minimal example

```js
const path = require("node:path");

module.exports = {
  provideSpellChecker() {
    return path.join(__dirname, "checker.js");
  },
};
```

## Behavior

The hub asks every enabled checker for spelling ranges. A range confirmed as correct overrides an incorrect range, while suggestions are merged by checker priority and deduplicated.

## Teardown

Lumine disposes the registration when the provider deactivates. The hub removes its checker and calls the optional `deactivate` method.

## Versioning

Version `1.0.0` accepts checker module paths. Backward-compatible fields and methods may be added within version 1; incompatible contract changes require a new major service version.
