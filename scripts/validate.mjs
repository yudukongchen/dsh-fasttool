import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseManifest, projectManifest } from '@dsh-std/manifest'
import { parse as parseYaml } from 'yaml'
import { PACKAGE_ROOT } from '../lib/binary.js'
import { TOOL_NAMES } from '../lib/tools.js'
import { PROMPT_SECTION, PUBLIC_TOOL_NAMES } from '../lib/index.js'

const read = file => fs.readFileSync(path.join(PACKAGE_ROOT, file), 'utf8')
const pkg = JSON.parse(read('package.json'))
const raw = JSON.parse(read('dsh-plugin.json'))
const manifest = parseManifest(read('dsh-plugin.json'), { source: 'dsh-plugin.json' })
const projection = projectManifest(manifest)
assert.equal(manifest.version, pkg.version)
assert.equal(projection.metadata.version, pkg.version)
assert.equal(raw.name, pkg.name)
assert.equal(pkg.name, 'dsh-fasttool')
assert.deepEqual([...raw.contributes['x-tool-namespaces'][0].tools].sort(), [...TOOL_NAMES].sort())
assert.deepEqual(raw.contributes['x-tool-namespaces'].flatMap(namespace => namespace.tools).sort(), [...PUBLIC_TOOL_NAMES].sort())
assert.equal(raw.contributes['x-prompt-sections'][0].name, PROMPT_SECTION)
assert.ok(fs.existsSync(path.join(PACKAGE_ROOT, raw.facets.host.entry)))
const patch = parseYaml(read('cordis.patch.yml'))
assert.equal(patch[0].insert.length, 1)
assert.equal(patch[0].insert[0].name, pkg.name)
for (const display of raw.contributes['x-display']) {
  for (const file of [display.icon, ...display.locales]) assert.ok(fs.existsSync(path.join(PACKAGE_ROOT, file)), file)
}
for (const file of ['README.md', 'LICENSE', 'NOTICE', 'PROVENANCE.md', 'CHANGELOG.md', 'runtime/LICENSE-APACHE', 'runtime/NOTICE', 'runtime/UPSTREAM.json']) assert.ok(read(file).length > 0, file)
console.log('DSH manifest 0.15, bundle, tool names, entries, locales, and provenance verified.')
