import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import deckyPlugin from "@decky/rollup";
import { rollup } from "rollup";

const outputRoot = resolve("../artifacts/decky-whatsapp-mock");
async function outputDigest(root) {
  const hash = createHash("sha256");
  async function visit(path, relative = "") {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = resolve(path, entry.name);
      const name = resolve(relative, entry.name);
      if (entry.isDirectory()) await visit(child, name);
      else { hash.update(name); hash.update(await readFile(child)); }
    }
  }
  try { await visit(root); } catch (error) { if (error.code !== "ENOENT") throw error; hash.update("missing"); }
  return hash.digest("hex");
}
const productionDigestBefore = await outputDigest(resolve("dist"));
await rm(resolve(outputRoot, "dist"), { recursive: true, force: true });
await mkdir(resolve(outputRoot, "dist"), { recursive: true });
await copyFile("plugin.mock.json", resolve(outputRoot, "plugin.json"));
await copyFile("package.mock.json", resolve(outputRoot, "package.json"));
await copyFile("mock-main.py", resolve(outputRoot, "main.py"));
await mkdir(".mock-build", { recursive: true });
await copyFile("plugin.mock.json", ".mock-build/plugin.json");

const config = deckyPlugin({ output: { dir: resolve(outputRoot, "dist") } }, ".mock-build");
// @decky/rollup's preset takes its defaults after user options, so set the
// isolated destination on the final config object rather than relying on merge order.
config.output.dir = resolve(outputRoot, "dist");
config.plugins = config.plugins.filter((plugin) => plugin.name !== "delete" && plugin.name !== "del");
config.plugins.unshift({
  name: "select-offline-mock-provider",
  resolveId(source, importer) {
    if (source === "./provider-selected" && importer && /[\\/]src[\\/]index\.tsx$/.test(importer)) {
      return resolve("src/mock-provider-entry.ts");
    }
    return null;
  }
});
const bundle = await rollup(config);
await bundle.write(config.output);
await bundle.close();
if (!(await stat(resolve(outputRoot, "dist", "index.js")).catch(() => undefined))) {
  throw new Error("Mock bundle output was not generated");
}
const artifactPackage = JSON.parse(await readFile(resolve(outputRoot, "package.json"), "utf8"));
if (artifactPackage.type !== "module" || artifactPackage.name !== "decky-whatsapp-mock") {
  throw new Error("Mock artifact package identity or ESM mode is invalid");
}
if (await outputDigest(resolve("dist")) !== productionDigestBefore) {
  throw new Error("Mock build unexpectedly changed the production output directory");
}
console.log(`Built isolated mock artifact: ${outputRoot}`);
