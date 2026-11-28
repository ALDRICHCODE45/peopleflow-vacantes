/* eslint-disable @typescript-eslint/no-require-imports -- Synchronous CommonJS loading is required for the temporary TypeScript hook. */
// The standalone Node fixture reuses the product's TypeScript validators without
// a build step, generated files, or a second implementation of block validation.
// Install the transpile hook only during these synchronous, local imports.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const previous = require.extensions[".ts"];
// The product imports through the `@/` alias (tsconfig paths → src/); map it the
// same way, only while these local imports load.
const sourceRoot = path.resolve(__dirname, "../../src");
const originalResolve = Module._resolveFilename;
try {
  Module._resolveFilename = function resolveProductAlias(request, ...rest) {
    const target = request.startsWith("@/") ? path.join(sourceRoot, request.slice(2)) : request;
    return originalResolve.call(this, target, ...rest);
  };
  require.extensions[".ts"] = (module, filename) => {
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    });
    module._compile(source.outputText, filename);
  };
  module.exports = {
    ...require("../../src/features/company-site/model.ts"),
    ...require("../../src/features/company-site/api/validation.ts"),
    ...require("../../src/features/company-site/defaults.ts"),
    ...require("../../src/features/company-site/slug.ts"),
  };
} finally {
  Module._resolveFilename = originalResolve;
  if (previous) require.extensions[".ts"] = previous;
  else delete require.extensions[".ts"];
}
