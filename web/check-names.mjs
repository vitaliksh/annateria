// Fails when a source of the page uses a name that is declared nowhere, the class of "view is not defined" (6 November 2026):
// every run of the assistant stopped there, and no test or eval ran that line. TypeScript reads the JavaScript as it is; only its
// "cannot find name" errors count here, its type errors do not (the code has no types).
//
//   node check-names.mjs [file ...]     the page's sources by default
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const WEB = dirname(fileURLToPath(import.meta.url));
// Cannot find name; ... Did you mean; cannot find name (with a hint about this); shorthand property with no value in scope.
const UNDECLARED = new Set([2304, 2552, 2662, 2663, 18004]);

function sources(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return ["test", "eval", "node_modules", "vendor", "fonts", "skills"].includes(entry.name) ? [] : sources(path);
    return entry.name.endsWith(".js") && !entry.name.endsWith(".min.js") ? [path] : [];
  });
}

export function undeclaredNames(files) {
  const program = ts.createProgram(files, {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  });
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => UNDECLARED.has(diagnostic.code) && diagnostic.file)
    .map((diagnostic) => {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${relative(WEB, diagnostic.file.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : sources(WEB);
  const found = undeclaredNames(files);
  for (const line of found) console.error(line);
  if (found.length) process.exit(1);
  console.log(`No undeclared names in ${files.length} files.`);
}
