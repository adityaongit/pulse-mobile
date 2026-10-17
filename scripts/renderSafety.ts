// Static checks for the render errors that close a React Native app, run over every .tsx in src/ and app/ by
// renderSafety.test.ts. Both crashes reported after v0.3.0 (the 6M charts, Healthspan's trends) were the first kind.
//
// 1. A Skia element rendered by React Native: Skia's components (Group, Path, RoundedRect…) exist only inside a
//    <Canvas>, whose own renderer draws them. Placed among React Native views, React Native looks the element up as a
//    native view ("View config getter callback for component `skGroup`") and throws.
// 2. Text outside <Text>: in `{a && <X />}`, an `a` of 0 or "" is what renders, and React Native throws "Text strings
//    must be rendered within a <Text> component". A boolean (`!!a`, a comparison) or a ternary renders nothing.
import path from "node:path";
import ts from "typescript";

const SKIA_MODULE = "@shopify/react-native-skia";
/** The canvases: a Skia element inside one is drawn by Skia. */
const CANVASES = new Set(["Canvas", "PlotCanvas"]);
const SOURCE_DIRS = ["src", "app"];

export type Finding = { file: string; line: number; message: string };

/** The project's .tsx program, type-checked once for both checks. */
export function loadProgram(root: string) {
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config, ts.sys, root);
  const program = ts.createProgram(config.fileNames, config.options);
  // Binding (through the checker) sets every node's parent, which both checks walk.
  program.getTypeChecker();
  const inSource = (f: string) => SOURCE_DIRS.some((d) => f.startsWith(path.join(root, d) + path.sep));
  const files = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && sf.fileName.endsWith(".tsx") && inSource(path.resolve(sf.fileName)));
  return { program, files, root };
}

type Loaded = ReturnType<typeof loadProgram>;
type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;

const isJsx = (n: ts.Node): n is Jsx => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
const tagOf = (n: Jsx) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText();
const isComponentName = (name: string) => name[0] !== undefined && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
/** A component's own function: a declaration or a const arrow. An inline callback (`xs.map(() => …)`) is not one. */
const isComponentFunction = (n: ts.Node): n is ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression =>
  ts.isFunctionDeclaration(n) || ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent));
const functionName = (n: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression) =>
  ts.isFunctionDeclaration(n) ? (n.name?.text ?? "") : (n.parent as ts.VariableDeclaration).name.getText();

const findingAt = ({ root }: Loaded, sf: ts.SourceFile, n: ts.Node, message: string): Finding => ({
  file: path.relative(root, sf.fileName),
  line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
  message,
});

/** The JSX tags a function can return, looking through fragments, conditionals and `xs.map(() => …)`. */
function returnedTags(fn: ts.FunctionLikeDeclaration): string[] {
  const out: string[] = [];
  const collect = (e: ts.Node | undefined): void => {
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (!e) return;
    if (ts.isConditionalExpression(e)) {
      collect(e.whenTrue);
      collect(e.whenFalse);
    } else if (ts.isBinaryExpression(e)) collect(e.right);
    else if (ts.isCallExpression(e)) e.arguments.forEach((a) => (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && out.push(...returnedTags(a)));
    else if (ts.isJsxFragment(e)) e.children.forEach((c) => (ts.isJsxExpression(c) ? collect(c.expression) : collect(c)));
    else if (isJsx(e)) out.push(tagOf(e));
  };
  const visit = (n: ts.Node): void => {
    if (ts.isReturnStatement(n)) collect(n.expression);
    else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  if (fn.body && !ts.isBlock(fn.body)) collect(fn.body);
  else if (fn.body) ts.forEachChild(fn.body, visit);
  return out;
}

/** Check 1: every Skia element sits in a canvas, in Skia, or at the top of a component that returns only Skia. */
export function skiaOutsideCanvas(loaded: Loaded): Finding[] {
  const { files, root } = loaded;
  const resolve = (from: string, spec: string) => {
    const base = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : spec;
    return files.find((f) => [".tsx", "/index.tsx"].some((ext) => path.resolve(f.fileName) === base + ext))?.fileName ?? base;
  };
  // Each file's names, resolved to "module#export" (its own declarations to "file#name").
  const imports = new Map<string, Map<string, string>>();
  for (const sf of files) {
    const names = new Map<string, string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const bindings = st.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const mod = resolve(sf.fileName, st.moduleSpecifier.text);
      for (const e of bindings.elements) names.set(e.name.text, `${mod}#${(e.propertyName ?? e.name).text}`);
    }
    imports.set(sf.fileName, names);
  }
  const skiaComponents = new Set<string>();
  const isSkia = (file: string, name: string) => {
    const key = imports.get(file)?.get(name) ?? `${file}#${name}`;
    return key.startsWith(`${SKIA_MODULE}#`) ? !CANVASES.has(name) : skiaComponents.has(key);
  };
  // The project's Skia components: those whose every returned root is Skia (GridLines, HollowDot, the Path wrapper…).
  for (let grew = true; grew; ) {
    grew = false;
    for (const sf of files) {
      const visit = (n: ts.Node): void => {
        if (isComponentFunction(n)) {
          const name = functionName(n);
          const key = `${sf.fileName}#${name}`;
          const tags = returnedTags(n);
          if (isComponentName(name) && !skiaComponents.has(key) && tags.length > 0 && tags.every((t) => isSkia(sf.fileName, t))) {
            skiaComponents.add(key);
            grew = true;
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  const findings: Finding[] = [];
  for (const sf of files) {
    const visit = (n: ts.Node): void => {
      if (isJsx(n) && isSkia(sf.fileName, tagOf(n))) {
        let p: ts.Node | undefined = n.parent;
        while (p && !isJsx(p) && !isComponentFunction(p)) p = p.parent;
        if (p && isJsx(p) && !isSkia(sf.fileName, tagOf(p)) && !CANVASES.has(tagOf(p))) findings.push(findingAt(loaded, sf, n, `<${tagOf(n)}> is a Skia element inside <${tagOf(p)}>, outside any canvas`));
        if (p && isComponentFunction(p) && !skiaComponents.has(`${sf.fileName}#${functionName(p)}`))
          findings.push(findingAt(loaded, sf, n, `<${tagOf(n)}> is a Skia element returned by ${functionName(p)}, which also returns React Native elements`));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return findings;
}

/** Whether a value of this type can render as text: a number (0 included), a string ("" included), or `any`. */
function canBeText(t: ts.Type): boolean {
  if (t.isUnion()) return t.types.some(canBeText);
  if (t.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike)) return !(t.isNumberLiteral() && t.value !== 0);
  if (t.flags & ts.TypeFlags.StringLike) return !(t.isStringLiteral() && t.value !== "");
  return !!(t.flags & ts.TypeFlags.Any);
}

/** Check 2: no rendered `a && …` whose `a` can be 0 or "". */
export function textOutsideText(loaded: Loaded): Finding[] {
  const checker = loaded.program.getTypeChecker();
  const findings: Finding[] = [];
  const isAnd = (e: ts.Expression): e is ts.BinaryExpression => ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
  for (const sf of loaded.files) {
    const visit = (n: ts.Node): void => {
      if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
        // Every operand of the rendered chain but the last decides what renders when it is falsy.
        const operands: ts.Expression[] = [];
        const flatten = (e: ts.Expression): void => {
          while (ts.isParenthesizedExpression(e) && isAnd(e.expression)) e = e.expression;
          if (isAnd(e)) {
            flatten(e.left);
            operands.push(e.right);
          } else operands.push(e);
        };
        let e = n.expression;
        while (ts.isParenthesizedExpression(e)) e = e.expression;
        if (isAnd(e)) {
          flatten(e);
          for (const o of operands.slice(0, -1)) {
            const t = checker.getTypeAtLocation(o);
            if (canBeText(t)) findings.push(findingAt(loaded, sf, o, `\`${o.getText()} && …\` renders ${checker.typeToString(t)} as raw text when it is 0 or ""; make it a boolean (!!)`));
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return findings;
}
