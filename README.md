# @sec-ant/finder

[![Test](https://github.com/sec-ant/finder/actions/workflows/test.yml/badge.svg)](https://github.com/sec-ant/finder/actions/workflows/test.yml)

**The Asynchronous CSS Selector Generator**

A fork of [antonmedv/finder](https://github.com/antonmedv/finder) with an asynchronous function signature powered by [astoilkov/main-thread-scheduling](https://github.com/astoilkov/main-thread-scheduling).

## Features

- Generates **shortest** CSS selectors
- **Unique** CSS selectors per page
- Stable and **robust** CSS selectors
- **Asynchronous** function signature, no frozen UI
- **ESM**, **CJS** and **IIFE** exports

## Install

```bash
npm i @sec-ant/finder
```

## Usage

```ts
import { finder } from "@sec-ant/finder";

document.addEventListener("click", async (event) => {
  const selector = await finder(event.target);
  // Use the selector, e.g., console.log(selector);
});
```

## Example

An example of a generated selector:

```css
.blog > article:nth-of-type(3) .add-comment
```

## Configuration

```js
const selector = await finder(event.target, {
  root: document.body,
  timeoutMs: 1000,
});
```

### root

Defines the root of the search. Defaults to `document.body`.

### timeoutMs

Timeout to search for a selector. Defaults to `1000ms`. After the timeout, finder fallbacks to `nth-child` selectors.

### className

Function that determines if a class name may be used in a selector. Defaults to a word-like class names.

You can extend the default behaviour wrapping the `className` function:

```js
import { finder, className } from "@medv/finder";

finder(event.target, {
  className: (name) => className(name) || name.startsWith("my-class-"),
});
```

### tagName

Function that determines if a tag name may be used in a selector. Defaults to `() => true`.

### attr

Function that determines if an attribute may be used in a selector. Defaults to a word-like attribute names and values.

You can extend the default behaviour wrapping the `attr` function:

```js
import { finder, attr } from "@medv/finder";

finder(event.target, {
  attr: (name, value) => attr(name, value) || name.startsWith("data-my-attr-"),
});
```

### idName

Function that determines if an id name may be used in a selector. Defaults to a word-like id names.

### seedMinLength

Minimum length of levels in fining selector. Defaults to `3`.

### optimizedMinLength

Minimum length for optimising selector. Defaults to `2`.

### maxNumberOfPathChecks

Maximum number of path checks before attempting to generate a selector. Defaults to `Infinity`. This can be used to prevent excessively long computations for complex DOM structures.

### schedulingStrategy

Defines the scheduling strategy for yielding control to the main thread during selector generation. This helps prevent the page from becoming unresponsive during intensive computations. Possible values are `'interactive'`, `'smooth'`, or `'idle'`. Defaults to `'idle'`.

### abortSignal

An `AbortSignal` that can be used to abort the selector finding process. If the signal is aborted, the `finder` function will reject with an "AbortError". This option allows for cancellation of the operation, for example, if the user navigates away or the operation takes too long.

## License

[MIT](LICENSE)
