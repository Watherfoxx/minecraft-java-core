const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MinecraftBundle = require('../build/Minecraft/Minecraft-Bundle.js').default;

async function createWorkspace(t) {
    const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'minecraft-bundle-'));
    t.after(async () => {
        await fs.promises.rm(workspace, { recursive: true, force: true });
    });
    return workspace;
}

function createOptions(workspace, ignored = []) {
    return {
        path: workspace,
        instance: 'main',
        ignored
    };
}

test('checkFiles préserve un dossier ignoré sans parcourir son contenu', async t => {
    const workspace = await createWorkspace(t);
    const instancePath = path.join(workspace, 'instances', 'main');
    const ignoredPath = path.join(instancePath, 'large-cache');
    const ignoredFile = path.join(ignoredPath, 'nested', 'cache.bin');
    const expectedFile = path.join(instancePath, 'expected.txt');
    const unexpectedFile = path.join(instancePath, 'unexpected.txt');
    const similarButNotIgnoredFile = path.join(instancePath, 'large-cache-backup', 'cache.bin');

    await fs.promises.mkdir(path.dirname(ignoredFile), { recursive: true });
    await fs.promises.mkdir(path.dirname(similarButNotIgnoredFile), { recursive: true });
    await fs.promises.writeFile(ignoredFile, 'player cache');
    await fs.promises.writeFile(expectedFile, 'expected');
    await fs.promises.writeFile(unexpectedFile, 'remove me');
    await fs.promises.writeFile(similarButNotIgnoredFile, 'remove me too');

    const originalReaddirSync = fs.readdirSync;
    let ignoredDirectoryReads = 0;
    fs.readdirSync = function guardedReaddirSync(targetPath, ...args) {
        if (path.resolve(targetPath) === path.resolve(ignoredPath)) {
            ignoredDirectoryReads++;
            throw new Error('Le dossier ignoré ne doit pas être parcouru');
        }
        return originalReaddirSync.call(this, targetPath, ...args);
    };
    t.after(() => {
        fs.readdirSync = originalReaddirSync;
    });

    const bundle = new MinecraftBundle(createOptions(workspace, ['large-cache']));
    await bundle.checkFiles([{ path: expectedFile }]);

    assert.equal(ignoredDirectoryReads, 0);
    assert.equal(fs.existsSync(ignoredFile), true);
    assert.equal(fs.existsSync(expectedFile), true);
    assert.equal(fs.existsSync(unexpectedFile), false);
    assert.equal(fs.existsSync(similarButNotIgnoredFile), false);
});

test('checkBundle évite les accès individuels sous un dossier ignoré existant', async t => {
    const workspace = await createWorkspace(t);
    const ignoredPath = path.join(workspace, 'instances', 'main', 'large-cache');
    const ignoredFile = path.join(ignoredPath, 'nested', 'cache.bin');
    await fs.promises.mkdir(path.dirname(ignoredFile), { recursive: true });
    await fs.promises.writeFile(ignoredFile, 'local player cache');

    const originalStatSync = fs.statSync;
    let ignoredFileStats = 0;
    fs.statSync = function guardedStatSync(targetPath, ...args) {
        if (path.resolve(targetPath) === path.resolve(ignoredFile)) {
            ignoredFileStats++;
            throw new Error('Le fichier ignoré ne doit pas être inspecté');
        }
        return originalStatSync.call(this, targetPath, ...args);
    };
    t.after(() => {
        fs.statSync = originalStatSync;
    });

    const bundle = new MinecraftBundle(createOptions(workspace, ['large-cache']));
    const downloads = await bundle.checkBundle([{
        path: 'instances/main/large-cache/nested/cache.bin',
        sha1: 'different-server-hash',
        size: 999,
        url: 'https://example.invalid/cache.bin'
    }]);

    assert.equal(ignoredFileStats, 0);
    assert.deepEqual(downloads, []);
});

test('checkBundle télécharge les fichiers ignorés lorsque leur racine est absente', async t => {
    const workspace = await createWorkspace(t);
    const bundle = new MinecraftBundle(createOptions(workspace, ['large-cache']));
    const downloads = await bundle.checkBundle([{
        path: 'instances/main/large-cache/nested/cache.bin',
        sha1: 'server-hash',
        size: 42,
        url: 'https://example.invalid/cache.bin'
    }]);

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].path.endsWith('/instances/main/large-cache/nested/cache.bin'), true);
});
