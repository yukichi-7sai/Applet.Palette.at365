const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function install(profile, items, settings = {}) {
  const destination = path.join(profile, 'extensions/at365.palette');
  for (const file of ['extension.json', 'index.cjs', 'palette.cjs', 'resources/translations/applet.json']) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  if (items) {
    const storage = path.join(profile, 'data/storage/at365.palette/shared/files/snippets.json');
    fs.mkdirSync(path.dirname(storage), { recursive: true });
    fs.writeFileSync(storage, JSON.stringify({ schemaVersion: 1, items }, null, 2) + '\n');
  }
  return { enabled: true, settings };
}
module.exports = { install };
