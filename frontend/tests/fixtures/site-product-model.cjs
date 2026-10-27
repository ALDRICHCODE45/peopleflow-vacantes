/* eslint-disable @typescript-eslint/no-require-imports -- Synchronous CommonJS loading is required for the temporary TypeScript hook. */
// The standalone Node fixture reuses the product's TypeScript validators without
// a build step, generated files, or a second implementation of block validation.
// Install the transpile hook only during these synchronous, local imports.
const { readFileSync } = require("node:fs");
const ts = require("typescript");
const previous = require.extensions[".ts"];
try {
  require.extensions[".ts"] = (module, filename) => {
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    });
    module._compile(source.outputText, filename);
  };
  module.exports = {
    ...require("../../src/features/company-site/model.ts"),
    ...require("../../src/features/company-site/defaults.ts"),
    ...require("../../src/features/company-site/slug.ts"),
  };
} finally {
  if (previous) require.extensions[".ts"] = previous;
  else delete require.extensions[".ts"];
}
