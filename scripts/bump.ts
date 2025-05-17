import { URL, fileURLToPath } from "node:url";
import { run } from "npm-check-updates";

async function bump() {
  await run({
    packageFile: fileURLToPath(new URL("../package.json", import.meta.url)),
    upgrade: true,
    target: (_packageName, _versionRange) => {
      return "semver";
    },
  });
}

bump();
