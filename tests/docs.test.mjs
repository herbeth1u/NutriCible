import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
const exists = (p) => access(join(ROOT, p)).then(() => true, () => false);
async function walk(dir, out = []) {
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) await walk(p, out); else out.push(p);
  }
  return out;
}

test('chemins relatifs uniquement (le site est servi sous /NutriCible/)', async () => {
  for (const f of ['index.html', ...(await walk('src'))]) {
    const t = await read(f);
    assert.ok(!/(src|href)="\/(?!\/)/.test(t), `${f} : chemin absolu dans un attribut`);
    assert.ok(!/fetch\(\s*['"`]\/(?!\/)/.test(t), `${f} : fetch absolu`);
    assert.ok(!/(from|import\()\s*['"`]\/(?!\/)/.test(t), `${f} : import absolu`);
    assert.ok(!/url\(\s*['"]?\/(?!\/)/.test(t), `${f} : url() absolu`);
  }
});

test('Vue ne s\'importe que via src/vue.js ; le stockage n\'est touché que par le store, avec le préfixe nutricible:v1:', async () => {
  for (const f of (await walk('src')).filter((x) => x.endsWith('.js'))) {
    const t = await read(f);
    if (f !== 'src/vue.js') assert.ok(!/vendor\/|jsdelivr|unpkg/.test(t), `${f} : import de Vue hors src/vue.js`);
    if (f !== 'src/store.js') assert.ok(!/\b(localStorage|sessionStorage|indexedDB)\s*[.[]/.test(t), `${f} : accès direct au stockage`);
  }
  assert.match(await read('src/store.js'), /PREFIX = 'nutricible:v1:'/);
  assert.match(await read('src/vue.js'), /vendor\/vue\.esm-browser\.prod\.js/);
});

test('documentation : README et CLAUDE.md rappellent la règle de confidentialité et les invariants', async () => {
  const readme = await read('README.md');
  const claude = await read('CLAUDE.md');
  for (const t of [readme, claude]) {
    assert.match(t, /donnée personnelle|données personnelles/i);
    assert.match(t, /Mon profil/);
    assert.match(t, /navigateur/);
  }
  for (const phrase of ['Une seule fonction de calcul', 'Aucun total stocké', 'Ingrédients internes invisibles', 'nutricible:v1:', 'Chemins relatifs', 'profils fictifs']) {
    assert.ok(claude.includes(phrase), `CLAUDE.md : « ${phrase} »`);
  }
  for (const phrase of ['GitHub Pages', 'python -m http.server', 'Merge with CSV', 'Sauvegarde', 'npm test', 'herbeth1u.github.io/NutriCible']) {
    assert.ok(readme.includes(phrase), `README : « ${phrase} »`);
  }
});

test('hygiène du dépôt : .nojekyll, .gitignore des sauvegardes, scripts npm, Vue épinglé avec empreinte', async () => {
  assert.ok(await exists('.nojekyll'));
  const ignore = await read('.gitignore');
  assert.match(ignore, /nutricible-sauvegarde\*\.json/);
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts.validate, 'node scripts/validate-data.mjs');
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'aucune dépendance d\'exécution');
  assert.deepEqual(pkg.devDependencies ?? {}, {}, 'aucune dépendance');
  const versions = await read('vendor/VERSIONS.md');
  const v = versions.match(/^- vue (\d+\.\d+\.\d+)/m);
  assert.ok(v && /sha256 : [0-9a-f]{64}/.test(versions));
  assert.match(await read('src/vue.js'), new RegExp(`vue@${v[1].replace(/\./g, '\\.')}/dist`), 'le repli CDN est épinglé à la version vendorisée');
});

test('workflows fournis : CI (validation et tests) et vendorisation', async () => {
  const ci = await read('.github/workflows/ci.yml');
  assert.match(ci, /npm run validate/);
  assert.match(ci, /npm test/);
  assert.match(ci, /pull_request/);
  assert.match(await read('.github/workflows/vendor-vue.yml'), /sha256sum/);
});
