# JavaScript / Node.js Coding Conventions

Based on Airbnb JavaScript Style Guide and StandardJS.

## Naming
- `camelCase`: variables, functions, methods
- `PascalCase`: classes, constructors
- `UPPER_SNAKE_CASE`: module-level constants
- File names: `kebab-case.js`, or match exported class (`PascalCase.js`) for class modules

## Formatting
- 2 spaces indentation
- Max line length: 100
- Single quotes for strings, backticks for interpolation
- Semicolons required (Airbnb); follow project's existing choice if it differs

## Modules
- Prefer ES modules (`import` / `export`); don't mix with CommonJS in the same file
- Group order: builtin (`node:` prefix) → third-party → local
- Prefer named exports; one default export per file at most

## Language Features
- `const` by default, `let` only when reassigned, never `var`
- Arrow functions for callbacks; named `function` for top-level / hoisted use
- Template literals over string concatenation
- Destructuring for object/array access
- Strict equality (`===` / `!==`); never `==`
- Immutable updates (spread, `map`, `filter`) over in-place mutation

## Async
- Prefer `async` / `await` over raw Promise chains
- No floating promises — always `await` or attach `.catch`
- Use `Promise.all` for independent parallel awaits

## Error Handling
- Throw `Error` (or subclass), never strings
- Catch specifically; rethrow if not handling
- Don't swallow errors silently

## References
- https://github.com/airbnb/javascript
- https://standardjs.com/rules
