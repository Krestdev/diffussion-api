// Fails the build when compiled code requires a file by absolute path. The Swagger CLI plugin
// writes such paths for class-typed DTO properties when the project path has non-ASCII
// characters, and the app then crashes at startup (see request-parts.dto.ts).
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const offenders = [];
for (const entry of fs.readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const file = path.join(entry.parentPath, entry.name);
  const text = fs.readFileSync(file, 'utf8');
  const matches = text.match(/require\("(?:[A-Za-z]:)?\/[^"]*"\)/g);
  if (matches) offenders.push(`${path.relative(dist, file)}: ${[...new Set(matches)].join(', ')}`);
}
if (offenders.length) {
  console.error('Absolute require() paths found in dist/ (type nested DTO properties with an interface):');
  offenders.forEach((line) => console.error(`  ${line}`));
  process.exit(1);
}
console.log('dist/: no absolute require() paths');
