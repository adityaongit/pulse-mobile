// Lists the components and hooks the React Compiler skips. A skipped function is not memoised, so it and everything
// under it render on every change. Runs the compiler with the options babel-preset-expo passes (target "19",
// panicThreshold "NONE", the 'widget' opt-out) and prints each CompileError / CompileSkip / PipelineError with its
// reason. Usage: node scripts/compiler-skips.cjs [files...]   (default: every .ts/.tsx under src/ and app/)
const fs = require("fs");
const path = require("path");

const root = path.dirname(require.resolve("../package.json"));
// pnpm does not hoist @babel/core; resolve it, the TypeScript preset and the compiler from the store.
const store = path.join(root, "node_modules/.pnpm");
const pkg = (prefix, name) => {
  const dir = fs.readdirSync(store).find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`${prefix} is not installed`);
  return path.join(store, dir, "node_modules", name);
};
const babel = require(pkg("@babel+core@", "@babel/core"));
const presetTs = pkg("@babel+preset-typescript@", "@babel/preset-typescript");
const compiler = pkg("babel-plugin-react-compiler@1.0.0", "babel-plugin-react-compiler");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\./.test(e.name)) out.push(p);
  }
  return out;
}

const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => path.resolve(f)) : [...walk(path.join(root, "src")), ...walk(path.join(root, "app"))];
let skipped = 0;
let compiled = 0;
for (const file of files) {
  const events = [];
  babel.transformSync(fs.readFileSync(file, "utf8"), {
    filename: file,
    babelrc: false,
    configFile: false,
    presets: [[presetTs, { isTSX: true, allExtensions: true }]],
    plugins: [
      [
        compiler,
        {
          target: "19",
          panicThreshold: "NONE",
          customOptOutDirectives: ["widget", "use no memo", "use no forget"],
          logger: { logEvent: (_f, ev) => events.push(ev) },
        },
      ],
    ],
  });
  for (const ev of events) {
    if (ev.kind === "CompileSuccess") compiled++;
    if (!["CompileError", "CompileSkip", "PipelineError"].includes(ev.kind)) continue;
    skipped++;
    const d = ev.detail ?? {};
    const reason = d.reason ?? d.options?.reason ?? ev.reason ?? ev.data ?? String(d);
    const desc = d.description ?? d.options?.description ?? "";
    const loc = ev.fnLoc ?? d.loc ?? d.options?.loc ?? d.primaryLocation?.();
    const line = loc?.start?.line ?? "?";
    console.log(`${path.relative(root, file)}:${line}  ${ev.kind}  ${reason}${desc ? ` — ${desc}` : ""}`);
  }
}
console.log(`\n${compiled} compiled, ${skipped} skipped`);
process.exitCode = skipped ? 1 : 0;
