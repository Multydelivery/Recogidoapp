import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

// Test-only loader: server-only is enforced by Next during the production build.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20default%20{}", shortCircuit: true };
    if (specifier.endsWith(".module.css")) return { url: "data:text/javascript,export%20default%20{}", shortCircuit: true };
    if (specifier === "next/image") {
      const react = import.meta.resolve("react");
      const stub = `import{createElement}from${JSON.stringify(react)};export default function Image({src,alt,width,height,className}){return createElement("img",{src,alt,width,height,className})}`;
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const filename = resolve(root, "src", specifier.slice(2));
      return nextResolve(pathToFileURL(existsSync(`${filename}.ts`) ? `${filename}.ts` : `${filename}.tsx`).href, context);
    }
    if (specifier.startsWith(".") && /\.tsx?$/.test(context.parentURL ?? "")) {
      for (const extension of [".ts", ".tsx"]) {
        const url = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!/\.tsx?$/.test(url)) return nextLoad(url, context);
    const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    return { format: "module", source, shortCircuit: true };
  },
});
