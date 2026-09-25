import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "licenses.json");
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
const TARGETS = ["x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"];

const texts = {};
const packages = [];

function addText(text) {
  const t = text.replace(/\r\n/g, "\n").trim();
  const id = createHash("sha1").update(t).digest("hex").slice(0, 12);
  texts[id] = t;
  return id;
}

function licenseFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

const MIT = (who) => `MIT License

Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD3 = (who) => `Copyright (c) ${who}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

// lange standardtexte (apache, mpl) aus anderen paketen übernehmen
const canonical = {};
function findCanonical(start) {
  if (canonical[start] !== undefined) return canonical[start];
  canonical[start] = Object.values(texts).find((t) => t.startsWith(start)) ?? null;
  return canonical[start];
}

function fallback(license, who) {
  const l = license ?? "";
  if (/\bMIT\b/.test(l)) return MIT(who);
  if (/BSD-3-Clause/.test(l)) return BSD3(who);
  if (/Apache-2\.0/.test(l)) return findCanonical("Apache License");
  if (/MPL-2\.0/.test(l)) return findCanonical("Mozilla Public License Version 2.0");
  return null;
}

const pending = [];

function add(source, name, version, license, repository, files, who) {
  const pkg = { source, name, version, license: license ?? "?", repository: repository ?? null, texts: files.map(addText) };
  packages.push(pkg);
  if (pkg.texts.length === 0) pending.push({ pkg, who });
}

// npm: alles, was ins frontend gebündelt wird
const npm = JSON.parse(execSync("pnpm licenses list --prod --json", { cwd: root, encoding: "utf8" }));
for (const list of Object.values(npm)) {
  for (const p of list) {
    add("npm", p.name, p.versions[0], p.license, p.homepage, licenseFiles(p.paths[0]), p.author ?? p.name);
  }
}

// cargo: linux und windows
const seen = new Map();
for (const target of TARGETS) {
  const meta = JSON.parse(
    execSync(`cargo metadata --format-version 1 --filter-platform ${target}`, {
      cwd: join(root, "src-tauri"),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  for (const node of meta.resolve.nodes) seen.set(node.id, byId.get(node.id));
}
for (const p of seen.values()) {
  if (p.name === "hfenceline") continue;
  const who = p.authors?.length ? p.authors.join(", ") : `${p.name} authors`;
  add("cargo", p.name, p.version, p.license, p.repository, licenseFiles(dirname(p.manifest_path)), who);
}

for (const { pkg, who } of pending) {
  const t = fallback(pkg.license, who);
  if (t) pkg.texts.push(addText(t));
  else console.warn(`licenses: kein text für ${pkg.source}:${pkg.name} (${pkg.license})`);
}

packages.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
const own = readFileSync(join(root, "LICENSE"), "utf8").trim();
writeFileSync(out, JSON.stringify({ own, packages, texts }));
console.log(`licenses: ${packages.length} pakete, ${Object.keys(texts).length} texte -> public/licenses.json`);
