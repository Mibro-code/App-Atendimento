// Mechanical fixture-only adaptation; prints a patch, never edits runtime or database.
const fs = require('node:fs');
const path = require('node:path');
const patches = [];
for (const name of fs.readdirSync('test').filter(name => name.endsWith('.test.js'))) {
  const file = path.join('test', name);
  const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  let updated = original.replace(/prisma\.(?:bot|contact|conversation|category|channelAccount|campaign|quickReply)\.create\(\{\s*data:\s*\{/g, (match, offset) => {
    let depth = 1, cursor = offset + match.length, quote = null;
    const start = cursor;
    while (cursor < original.length && depth) {
      const char = original[cursor++];
      if (quote) {
        if (char === '\\') cursor++;
        else if (char === quote) quote = null;
      } else if ('\"\'`'.includes(char)) quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    const data = original.slice(start, cursor - 1);
    return /\bcompany(?:Id)?\s*[:,]/.test(data) ? match : `${match} companyId: "cmp_mibro",`;
  });
  if (updated !== original) {
    const before = original.split('\n'), after = updated.split('\n');
    const hunks = before.flatMap((line, index) => line === after[index] ? [] : [`@@\n-${line}\n+${after[index]}\n`]);
    patches.push(`*** Update File: C:/App Whats/backups/integration-worktree-20261008/${file.replaceAll('\\', '/')}\n${hunks.join('')}`);
  }
}
process.stdout.write(`*** Begin Patch\n${patches.join('')}*** End Patch\n`);
