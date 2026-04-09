import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()

test('store cards: windows-only manifest returns only windows platform', async () => {
  const ctx = await createFixture({
    loadedLibs: [],
    libraries: [
      createLibrary('lib-win', [
        createManifest({ platform: 'windows', displayName: 'Windows Only', version: '1.0.0' }),
      ]),
    ],
  })

  const manager = await loadLibraryManager(ctx)
  const cards = manager.getStoreCards()
  const card = cards.find(item => item.id === 'lib-win')

  assert.ok(card, 'lib-win card should exist')
  assert.deepEqual(card.supportedPlatforms, ['windows'])
})

test('store cards: multi-manifest library merges platform union', async () => {
  const ctx = await createFixture({
    loadedLibs: ['lib-all'],
    libraries: [
      createLibrary('lib-all', [
        createManifest({ platform: 'windows', displayName: 'All Platform', version: '2.1.0' }),
        createManifest({ platform: 'macos' }),
        createManifest({ platform: 'linux' }),
      ]),
    ],
  })

  const manager = await loadLibraryManager(ctx)
  const cards = manager.getStoreCards()
  const card = cards.find(item => item.id === 'lib-all')

  assert.ok(card, 'lib-all card should exist')
  assert.deepEqual(new Set(card.supportedPlatforms), new Set(['windows', 'macos', 'linux']))
})

test('store cards: local library is downloaded and loaded status follows saved selection', async () => {
  const ctx = await createFixture({
    loadedLibs: ['lib-loaded'],
    libraries: [
      createLibrary('lib-loaded', [
        createManifest({ platform: 'windows', displayName: 'Loaded Lib', version: '3.0.0' }),
      ]),
      createLibrary('lib-unloaded', [
        createManifest({ platform: 'linux', displayName: 'Unloaded Lib', version: '3.0.0' }),
      ]),
    ],
  })

  const manager = await loadLibraryManager(ctx)
  const cards = manager.getStoreCards()
  const loadedCard = cards.find(item => item.id === 'lib-loaded')
  const unloadedCard = cards.find(item => item.id === 'lib-unloaded')

  assert.ok(loadedCard)
  assert.ok(unloadedCard)
  assert.equal(loadedCard.isDownloaded, true)
  assert.equal(loadedCard.isLoaded, true)
  assert.equal(unloadedCard.isDownloaded, true)
  assert.equal(unloadedCard.isLoaded, false)
  assert.equal(typeof loadedCard.displayName, 'string')
  assert.equal(typeof loadedCard.version, 'string')
  assert.equal(typeof loadedCard.isCore, 'boolean')
})

test('store cards: invalid-only manifest library is marked as not downloaded while loaded state still follows selection', async () => {
  const ctx = await createFixture({
    loadedLibs: ['lib-missing'],
    libraries: [
      createLibrary('lib-valid', [
        createManifest({ platform: 'windows', displayName: 'Valid Lib', version: '1.0.0' }),
      ]),
      createLibrary('lib-missing', [
        createInvalidManifest({
          platform: 'linux',
          displayName: 'Missing Manifest',
          version: '1.0.0',
          errors: ['JSON 解析失败: Unexpected token'],
        }),
      ]),
    ],
  })

  const manager = await loadLibraryManager(ctx)
  const cards = manager.getStoreCards()
  const validCard = cards.find(item => item.id === 'lib-valid')
  const missingCard = cards.find(item => item.id === 'lib-missing')

  assert.ok(validCard)
  assert.ok(missingCard)
  assert.equal(validCard.isDownloaded, true)
  assert.equal(missingCard.isDownloaded, false)
  assert.equal(missingCard.isLoaded, true)
})

async function createFixture({ loadedLibs, libraries }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'store-cards-'))
  const userDataDir = path.join(root, 'userData')
  await fs.mkdir(userDataDir, { recursive: true })
  await fs.writeFile(path.join(userDataDir, 'library-state.json'), JSON.stringify({ loadedLibs }), 'utf8')

  const scanResult = {
    rootPath: path.join(root, 'lib'),
    libraries: libraries.map(lib => ({
      name: lib.name,
      folderPath: path.join(root, 'lib', lib.name),
      manifests: lib.manifests.map((manifest, index) => {
        if (manifest?.__manifestItem) {
          return {
            filePath: path.join(root, 'lib', lib.name, `manifest-${index}.ycmd.json`),
            manifest: manifest.manifest,
            valid: manifest.valid,
            errors: manifest.errors || [],
          }
        }

        return {
          filePath: path.join(root, 'lib', lib.name, `manifest-${index}.ycmd.json`),
          manifest,
          valid: true,
          errors: [],
        }
      }),
    })),
    errors: [],
  }

  return { root, userDataDir, scanResult }
}

function createLibrary(name, manifests) {
  return { name, manifests }
}

function createManifest({ platform, displayName, version }) {
  return {
    contractVersion: '1.0',
    commandId: `cmd-${platform}`,
    library: 'sample-lib',
    libraryDisplayName: displayName,
    libraryVersion: version,
    implementations: {
      [platform]: { entry: `${platform}.cpp` },
    },
  }
}

function createInvalidManifest({ platform, displayName, version, errors }) {
  return {
    __manifestItem: true,
    manifest: createManifest({ platform, displayName, version }),
    valid: false,
    errors,
  }
}

async function loadLibraryManager(ctx) {
  const sourcePath = path.join(repoRoot, 'src', 'main', 'libraryManager.ts')
  const source = await fs.readFile(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText

  const module = { exports: {} }
  const localRequire = specifier => {
    if (specifier === 'electron') {
      return {
        app: {
          isPackaged: false,
          getAppPath: () => ctx.root,
          getPath: () => ctx.userDataDir,
        },
      }
    }
    if (specifier === './ycmd-registry') {
      return {
        scanYcmdRegistry: () => ctx.scanResult,
        getYcmdCommands: () => [],
      }
    }
    if (specifier === '../shared/library-store') {
      return {
        STORE_PLATFORM_ORDER: ['windows', 'macos', 'linux'],
      }
    }
    return require(specifier)
  }

  const evaluator = new Function('require', 'module', 'exports', '__dirname', '__filename', transpiled)
  evaluator(localRequire, module, module.exports, path.dirname(sourcePath), sourcePath)
  return module.exports.libraryManager
}
