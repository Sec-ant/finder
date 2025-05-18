import { server } from "@vitest/browser/context";
import { assert, expect, test } from "vitest";
import { type FinderOptions, finder } from "../src/index.js";

const { readFile } = server.commands;

interface CheckOptions {
  html: string;
  query?: string;
}

async function check(
  { html, query }: CheckOptions,
  finderOptions?: FinderOptions,
) {
  document.documentElement.innerHTML = html;

  const options: FinderOptions = {
    timeoutMs: Number.POSITIVE_INFINITY,
    maxNumberOfPathChecks: 2_000,
    ...finderOptions,
  };

  const selectors: string[] = [];
  for (const node of document.querySelectorAll(query ?? "*")) {
    if (!(node instanceof Element)) continue;
    let css: string;
    try {
      css = await finder(node, options);
    } catch (err) {
      assert.fail(
        `${(err as Error).toString()}\n    Node: ${node.outerHTML.substring(0, 100)}`,
      );
    }
    assert.equal(
      document.querySelectorAll(css).length,
      1,
      `Selector "${css}" selects more then one node.`,
    );
    assert.equal(
      document.querySelector(css),
      node,
      `Selector "${css}" selects another node.`,
    );
    selectors.push(css);
  }
  expect(selectors).toMatchSnapshot();
}

test("github", async () => {
  await check({ html: await readFile("./fixtures/github.com.html") });
});

test("stripe", async () => {
  await check({ html: await readFile("./fixtures/stripe.com.html") });
});

test("deployer", async () => {
  await check({ html: await readFile("./fixtures/deployer.org.html") });
});

test("tailwindcss", async () => {
  await check({ html: await readFile("./fixtures/tailwindcss.html") });
});

test("google", async () => {
  await check({
    html: await readFile("./fixtures/google.com.html"),
    query: "[href]",
  });
});

test("duplicate", async () => {
  await check({
    html: `
      <div id="foo"></div>
      <div id="foo"></div>
    `,
  });
});

test("duplicate:sub-nodes", async () => {
  await check({
    html: ` 
      <div id="foo"><i></i></div>
      <div id="foo"><i></i></div>
    `,
  });
});

test("bad-class-names", async () => {
  await check({
    html: `
      <div class="css-175oi2r"></div>
      <div class="css-y6a5a9i"></div>
    `,
  });
});
