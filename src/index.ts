// License: MIT
// Author: Anton Medvedev <anton@medv.io>, Ze-Zheng Wu <zezhengwu@proton.me>
// Source: https://github.com/antonmedv/finder

import {
  type SchedulingStrategy,
  yieldOrContinue,
} from "main-thread-scheduling";

/**
 * Represents a segment of a CSS selector path.
 * Each knot includes the selector part itself, its associated penalty,
 * and an optional level indicating its depth in the path.
 */
type Knot = {
  /** The CSS selector part (e.g., '#id', '.class', 'tag[attr="value"]'). */
  name: string;
  /** The penalty score associated with this selector part. Lower is better. */
  penalty: number;
  /** The depth level of this knot in the selector path, starting from 0 for the target element. */
  level?: number;
};

/**
 * A set of attribute names that are generally considered good candidates
 * for use in selectors (e.g., 'role', 'name').
 */
const acceptedAttrNames = new Set([
  "role",
  "name",
  "aria-label",
  "rel",
  "href",
]);

/** Regex for basic word-like strings (at least 3 chars, letters and hyphens). */
const WORDLIKE_REGEX_BASE = /^[a-z\-]{3,}$/i;
/** Regex for strings containing 4 or more consecutive consonants. */
const WORDLIKE_REGEX_CONSONANTS = /[^aeiou]{4,}/i;
/** Maximum length for an attribute value to be considered in a selector. */
const MAX_ATTRIBUTE_VALUE_LENGTH = 100;
/** Default timeout in milliseconds for the selector search. */
const DEFAULT_TIMEOUT_MS = 1000;
/** Default minimum number of levels in the initial selector path. */
const DEFAULT_SEED_MIN_LENGTH = 3;
/** Default minimum length for a selector path to be considered for optimization. */
const DEFAULT_OPTIMIZED_MIN_LENGTH = 2;
/** Penalty score for using an ID in a selector. */
const PENALTY_ID = 0;
/** Penalty score for using a class name in a selector. */
const PENALTY_CLASS = 1;
/** Penalty score for using an attribute in a selector. */
const PENALTY_ATTRIBUTE = 2;
/** Penalty score for using a tag name in a selector. */
const PENALTY_TAG_NAME = 5;
/** Penalty score for using :nth-of-type in a selector. */
const PENALTY_NTH_OF_TYPE = 10;
/** Penalty score for using :nth-child in a selector. */
const PENALTY_NTH_CHILD = 50;
/** Minimum length for a segment of a word (split by hyphen or camelCase) to be considered valid. */
const MIN_WORD_SEGMENT_LENGTH = 2;

/** Check if attribute name and value are word-like. */
export function attr(name: string, value: string): boolean {
  let nameIsOk = acceptedAttrNames.has(name);
  nameIsOk ||= name.startsWith("data-") && wordLike(name);

  let valueIsOk = wordLike(value) && value.length < MAX_ATTRIBUTE_VALUE_LENGTH; // Avoid overly long attribute values
  // Allow attribute values that resemble ID references (e.g., aria-describedby="#some-id")
  valueIsOk ||= value.startsWith("#") && wordLike(value.slice(1));

  return nameIsOk && valueIsOk;
}

/** Check if id name is word-like. */
export function idName(name: string): boolean {
  return wordLike(name);
}

/** Check if class name is word-like. */
export function className(name: string): boolean {
  return wordLike(name);
}

/** Check if tag name is word-like. */
export function tagName(_name: string): boolean {
  return true;
}

/** Configuration options for the finder. */
export interface FinderOptions {
  /** The root element to start the search from. */
  root?: Element;
  /** Function that determines if an id name may be used in a selector. */
  idName?: (name: string) => boolean;
  /** Function that determines if a class name may be used in a selector. */
  className?: (name: string) => boolean;
  /** Function that determines if a tag name may be used in a selector. */
  tagName?: (name: string) => boolean;
  /** Function that determines if an attribute may be used in a selector. */
  attr?: (name: string, value: string) => boolean;
  /** Timeout to search for a selector. */
  timeoutMs?: number;
  /** Minimum length of levels in fining selector. */
  seedMinLength?: number;
  /** Minimum length for optimising selector. */
  optimizedMinLength?: number;
  /** Maximum number of path checks. */
  maxNumberOfPathChecks?: number;
  /** The scheduling strategy for yielding control to the main thread. */
  schedulingStrategy?: SchedulingStrategy | null;
  /** An AbortSignal to allow aborting the operation. */
  abortSignal?: AbortSignal;
}

/**
 * Represents the resolved finder options, with all optional properties (except abortSignal)
 * made required and assigned default values if not provided.
 */
type ResolvedFinderOptions = Required<Omit<FinderOptions, "abortSignal">> &
  FinderOptions;

/** Default configuration options for the finder. */
const defaultOptions: ResolvedFinderOptions = {
  root: document.body,
  idName: idName,
  className: className,
  tagName: tagName,
  attr: attr,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  seedMinLength: DEFAULT_SEED_MIN_LENGTH,
  optimizedMinLength: DEFAULT_OPTIMIZED_MIN_LENGTH,
  maxNumberOfPathChecks: Number.POSITIVE_INFINITY,
  schedulingStrategy: "idle",
};

/** Finds unique CSS selectors for the given element. */
export async function finder(
  input: Element,
  options?: FinderOptions,
): Promise<string> {
  if (input.nodeType !== Node.ELEMENT_NODE) {
    throw new TypeError(
      "Can't generate CSS selector for non-element node type.",
    );
  }
  if (input.tagName.toLowerCase() === "html") {
    return "html";
  }

  const startTime = new Date();
  const config: ResolvedFinderOptions = { ...defaultOptions, ...options };
  const rootDocument = findRootDocument(config.root, defaultOptions);

  let foundPath: Knot[] | undefined;
  let count = 0;
  const searchIterator = search(input, config, rootDocument);
  // Iterate through candidate selectors generated by the search function
  while (true) {
    const iteratorResult = searchIterator.next();
    if (iteratorResult.done) {
      break;
    }
    const candidate = iteratorResult.value;

    if (config.schedulingStrategy) {
      await yieldOrContinue(config.schedulingStrategy, config.abortSignal);
    }

    const elapsedTimeMs = new Date().getTime() - startTime.getTime();
    if (
      elapsedTimeMs > config.timeoutMs ||
      count >= config.maxNumberOfPathChecks
    ) {
      const fallbackPath = fallback(input, rootDocument);
      if (!fallbackPath) {
        throw new Error(
          `Timeout: Can't find a unique selector after ${config.timeoutMs}ms`,
        );
      }
      return selector(fallbackPath);
    }
    count++;
    if (getUniqueElement(candidate, rootDocument) !== null) {
      foundPath = candidate;
      break;
    }
  }

  if (!foundPath) {
    throw new Error("Selector was not found.");
  }

  const optimizedPaths: Knot[][] = [];
  const optimizeIterator = optimize(
    foundPath,
    input,
    config,
    rootDocument,
    startTime,
  );
  // Iterate through optimized versions of the found selector
  while (true) {
    const iteratorResult = optimizeIterator.next();
    if (iteratorResult.done) {
      break;
    }
    const currentOptimizedPath = iteratorResult.value;
    optimizedPaths.push(currentOptimizedPath);
    if (config.schedulingStrategy) {
      await yieldOrContinue(config.schedulingStrategy, config.abortSignal);
    }
  }

  if (optimizedPaths.length > 0) {
    optimizedPaths.sort(byPenalty);
    return selector(optimizedPaths[0]);
  }
  return selector(foundPath);
}

/**
 * Generates candidate selector paths for the input element.
 * It traverses up the DOM tree from the input element, generating selector parts
 * for each ancestor and combining them in various ways. Candidates are yielded
 * based on their penalty scores and the `seedMinLength` configuration.
 *
 * @param input The HTML element to find a selector for.
 * @param config The finder configuration options.
 * @param rootDocument The root document or element to scope the search.
 * @returns A generator yielding arrays of `Knot`s representing candidate selector paths.
 */
function* search(
  input: Element,
  config: ResolvedFinderOptions,
  rootDocument: Element | Document,
): Generator<Knot[]> {
  const stack: Knot[][] = [];
  let paths: Knot[][] = [];
  let current: Element | null = input;
  let i = 0;
  while (current && current !== rootDocument) {
    const level = tie(current, config);
    for (const node of level) {
      node.level = i;
    }
    stack.push(level);
    current = current.parentElement;
    i++;

    // Generate all selector combinations from the current stack of ancestor knots
    paths.push(...combinations(stack));

    // If enough ancestor levels have been processed (>= seedMinLength),
    // yield the current set of candidates, sorted by penalty.
    if (i >= config.seedMinLength) {
      paths.sort(byPenalty);
      for (const candidate of paths) {
        yield candidate;
      }
      paths = [];
    }
  }

  paths.sort(byPenalty);
  for (const candidate of paths) {
    yield candidate;
  }
}

/**
 * Checks if a given string is "word-like" based on a set of heuristics.
 * This is used to filter out potentially auto-generated or non-semantic
 * identifiers, class names, or attribute values.
 *
 * A string is considered word-like if:
 * - It's at least 3 characters long and contains only letters and hyphens.
 * - When split by hyphens or uppercase letters (for camelCase), each resulting "word":
 *   - Is longer than 2 characters.
 *   - Does not contain 4 or more consecutive consonants.
 *
 * @param name The string to check.
 * @returns `true` if the string is considered word-like, `false` otherwise.
 */
function wordLike(name: string): boolean {
  // Basic check: at least 3 chars, letters and hyphens only.
  if (WORDLIKE_REGEX_BASE.test(name)) {
    // Use pre-compiled regex
    // Split by hyphen or uppercase letter (to handle camelCase and kebab-case).
    const words = name.split(/-|[A-Z]/);
    for (const word of words) {
      // Each "word" segment must be longer than 2 characters.
      if (word.length <= MIN_WORD_SEGMENT_LENGTH) {
        return false;
      }
      // Filter out words with 4 or more consecutive consonants (often indicates non-human-readable strings).
      if (WORDLIKE_REGEX_CONSONANTS.test(word)) {
        // Use pre-compiled regex
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Generates all possible selector parts (knots) for a given HTML element.
 * This includes ID, class names, suitable attributes, tag name,
 * and positional selectors like :nth-of-type and :nth-child.
 * Each part is assigned a penalty score.
 *
 * @param element The HTML element to generate selector parts for.
 * @param config The finder configuration options.
 * @returns An array of `Knot` objects representing possible selector parts.
 */
function tie(element: Element, config: ResolvedFinderOptions): Knot[] {
  const level: Knot[] = [];

  const elementId = element.getAttribute("id");
  if (elementId && config.idName(elementId)) {
    level.push({
      name: `#${CSS.escape(elementId)}`,
      penalty: PENALTY_ID,
    });
  }

  for (let i = 0; i < element.classList.length; i++) {
    const name = element.classList[i];
    if (config.className(name)) {
      level.push({
        name: `.${CSS.escape(name)}`,
        penalty: PENALTY_CLASS,
      });
    }
  }

  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (config.attr(attr.name, attr.value)) {
      level.push({
        name: `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`,
        penalty: PENALTY_ATTRIBUTE,
      });
    }
  }

  const tagName = element.tagName.toLowerCase();
  if (config.tagName(tagName)) {
    level.push({
      name: tagName,
      penalty: PENALTY_TAG_NAME,
    });

    const index = indexOf(element, tagName); // Index for nth-of-type
    if (index !== undefined) {
      level.push({
        name: nthOfType(tagName, index),
        penalty: PENALTY_NTH_OF_TYPE,
      });
    }
  }

  const childIndex = indexOf(element); // Index for nth-child
  if (childIndex !== undefined) {
    level.push({
      name: nthChild(tagName, childIndex),
      penalty: PENALTY_NTH_CHILD,
    });
  }

  return level;
}

/**
 * Constructs a CSS selector string from a path of `Knot`s.
 * The path is an array of `Knot`s, typically ordered from the target element
 * upwards to its ancestors.
 *
 * @param path An array of `Knot` objects representing the selector path.
 * @returns The constructed CSS selector string.
 */
function selector(path: Knot[]): string {
  let node = path[0];
  let query = node.name;
  for (let i = 1; i < path.length; i++) {
    const level = path[i].level || 0;
    // If the current knot's level is directly sequential to the previous one,
    // it implies a direct parent-child relationship, so use '>'.
    // Otherwise, use a descendant combinator (space).
    if (node.level === level - 1) {
      query = `${path[i].name} > ${query}`;
    } else {
      query = `${path[i].name} ${query}`;
    }
    node = path[i];
  }
  return query;
}

/**
 * Calculates the total penalty score for a given selector path.
 * The penalty is the sum of penalties of all `Knot`s in the path.
 *
 * @param path An array of `Knot` objects.
 * @returns The total penalty score.
 */
function penalty(path: Knot[]): number {
  return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0);
}

/**
 * Comparator function for sorting selector paths by their penalty scores.
 * Used to sort paths in ascending order of penalty.
 *
 * @param a The first selector path (array of `Knot`s).
 * @param b The second selector path (array of `Knot`s).
 * @returns A negative value if `a` has a lower penalty, positive if `b` has lower, 0 if equal.
 */
function byPenalty(a: Knot[], b: Knot[]) {
  return penalty(a) - penalty(b);
}

/**
 * Calculates the 1-based index of an element among its siblings.
 * If `tagName` is provided, it calculates the index among siblings of the same tag type (for :nth-of-type).
 * Otherwise, it calculates the index among all element siblings (for :nth-child).
 *
 * @param input The HTML element whose index is to be found.
 * @param tagName Optional. If provided, counts only siblings with this tag name.
 * @returns The 1-based index, or `undefined` if the element has no parent or no preceding siblings.
 */
function indexOf(input: Element, tagName?: string): number | undefined {
  const parent = input.parentNode;
  if (!parent) {
    return undefined;
  }
  let child = parent.firstChild;
  if (!child) {
    return undefined;
  }
  let i = 0;
  while (child) {
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      // If tagName is specified, only count elements of that type (for nth-of-type)
      // Otherwise, count all element siblings (for nth-child)
      (tagName === undefined ||
        (child as Element).tagName.toLowerCase() === tagName)
    ) {
      i++;
    }
    if (child === input) {
      break;
    }
    child = child.nextSibling;
  }
  return i;
}

/**
 * Generates a fallback selector path for an element.
 * This path typically consists of `tag:nth-of-type` selectors for the element
 * and its ancestors up to the `rootDocument`. This is used when the primary
 * search algorithm times out or fails to find a selector.
 *
 * @param input The HTML element to generate a fallback selector for.
 * @param rootDocument The root document or element to scope the search.
 * @returns An array of `Knot`s representing the fallback path if a unique one is found, otherwise `undefined`.
 */
function fallback(input: Element, rootDocument: Element | Document) {
  let i = 0;
  let current: Element | null = input;
  const path: Knot[] = [];
  while (current && current !== rootDocument) {
    const tagName = current.tagName.toLowerCase();
    const index = indexOf(current, tagName);
    if (index === undefined) {
      return;
    }
    path.push({
      name: nthOfType(tagName, index),
      penalty: Number.NaN,
      level: i,
    });
    current = current.parentElement;
    i++;
  }
  if (getUniqueElement(path, rootDocument) !== null) {
    return path;
  }
}

/**
 * Constructs an `:nth-child` selector string.
 *
 * @param tagName The tag name of the element.
 * @param index The 1-based index for the `:nth-child` pseudo-class.
 * @returns The `:nth-child` selector string (e.g., "div:nth-child(2)"). Returns "html" if tagName is "html".
 */
function nthChild(tagName: string, index: number) {
  if (tagName === "html") {
    return "html";
  }
  return `${tagName}:nth-child(${index})`;
}

/**
 * Constructs an `:nth-of-type` selector string.
 *
 * @param tagName The tag name of the element.
 * @param index The 1-based index for the `:nth-of-type` pseudo-class.
 * @returns The `:nth-of-type` selector string (e.g., "div:nth-of-type(1)"). Returns "html" if tagName is "html".
 */
function nthOfType(tagName: string, index: number) {
  if (tagName === "html") {
    return "html";
  }
  return `${tagName}:nth-of-type(${index})`;
}

/**
 * A recursive generator that produces all possible selector paths by choosing
 * one `Knot` from each level in the `stack`. The stack contains arrays of
 * `Knot`s, where each array represents the selector part options for one
 * level of the DOM hierarchy.
 *
 * @param stack An array of arrays of `Knot`s. Each inner array corresponds to an ancestor level.
 * @param path The current path being built (used in recursion).
 * @returns A generator yielding arrays of `Knot`s, each representing a complete selector path.
 */
function* combinations(stack: Knot[][], path: Knot[] = []): Generator<Knot[]> {
  if (stack.length > 0) {
    for (const node of stack[0]) {
      // Recursively build paths by taking one knot from the current level
      // and combining it with paths from subsequent levels.
      yield* combinations(stack.slice(1, stack.length), path.concat(node));
    }
  } else {
    // Base case: stack is empty, so the current path is a complete combination.
    yield path;
  }
}

/**
 * Determines the correct root document or element for selector queries.
 * If `rootNode` is a document, it's used directly.
 * If `rootNode` is the default root (e.g., `document.body`), its `ownerDocument` is used.
 * Otherwise, `rootNode` itself is used as the query scope.
 *
 * @param rootNode The proposed root node (Element or Document).
 * @param defaults The default configuration options.
 * @returns The determined `Document` or `Element` to be used as the query root.
 */
function findRootDocument(
  rootNode: Element | Document,
  defaults: ResolvedFinderOptions,
) {
  if (rootNode.nodeType === Node.DOCUMENT_NODE) {
    return rootNode;
  }
  if (rootNode === defaults.root) {
    return rootNode.ownerDocument as Document;
  }
  return rootNode;
}

/**
 * Finds a single element uniquely identified by the selector path within the `rootDocument`.
 *
 * @param path An array of `Knot`s representing the selector path.
 * @param rootDocument The document or element to query within.
 * @returns The unique `Element` if found. Returns `null` if the selector matches more than one element.
 * @throws Error if the selector matches zero elements.
 */
function getUniqueElement(
  path: Knot[],
  rootDocument: Element | Document,
): Element | null {
  const css = selector(path);
  const elements = rootDocument.querySelectorAll(css);
  if (elements.length === 0) {
    // This should ideally not happen if path generation is correct,
    // as the selector should at least match the input element.
    throw new Error(`Can't select any node with this selector: ${css}`);
  }
  if (elements.length === 1) {
    return elements[0] as Element;
  }
  return null; // Not unique (more than 1 match)
}

/**
 * Optimizes a given selector path by attempting to remove intermediate `Knot`s.
 * It yields any shorter versions of the path that are still unique and still
 * select the original `input` element. This process is recursive to find the
 * most optimized path.
 *
 * @param path The selector path (array of `Knot`s) to optimize.
 * @param input The original HTML element the path was generated for.
 * @param config The finder configuration options.
 * @param rootDocument The root document or element for querying.
 * @param startTime The time the overall finder process started, for timeout checks.
 * @returns A generator yielding optimized selector paths (arrays of `Knot`s).
 */
function* optimize(
  path: Knot[],
  input: Element,
  config: ResolvedFinderOptions,
  rootDocument: Element | Document,
  startTime: Date,
): Generator<Knot[]> {
  if (path.length > 2 && path.length > config.optimizedMinLength) {
    // Iterate through intermediate knots in the path (excluding first and last)
    // to see if they can be removed.
    for (let i = 1; i < path.length - 1; i++) {
      const elapsedTimeMs = new Date().getTime() - startTime.getTime();
      if (elapsedTimeMs > config.timeoutMs) {
        return; // Stop optimization if timeout is reached
      }
      const newPath = [...path];
      newPath.splice(i, 1); // Create a new path with one intermediate knot removed

      // Check if the optimized path uniquely identifies the original input element.
      const uniqueElement = getUniqueElement(newPath, rootDocument);
      if (uniqueElement === input) {
        yield newPath;
        // Recursively try to optimize the new, shorter path further
        yield* optimize(newPath, input, config, rootDocument, startTime);
      }
    }
  }
}
