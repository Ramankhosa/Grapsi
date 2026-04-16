// Import Indian patent dataset (title and abstract) into LocalPatent table
// Usage: node scripts/import-local-patents-from-csv.js patients11.csv

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function parseCsvLine(line) {
  // Expecting CSV columns:
  // id,publication_number,kind,title,abstract_original,abstract_normalized,created_at,updated_at
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Toggle quotes or escape
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);

  return values.map(v => (v === '' ? null : v));
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/import-local-patents-from-csv.js <path-to-csv>');
    process.exit(1);
  }

  const fullPath = path.resolve(csvPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(fullPath),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) {
      // header
      continue;
    }
    if (!line.trim()) continue;

    try {
      const cols = await parseCsvLine(line);
      if (!cols || cols.length < 5) {
        skipped++;
        continue;
      }

      // index(0), publication_number(1), kind(2), title(3), abstract_original(4), abstract_normalized(5)
      const publicationNumber = (cols[1] || '').trim();
      const kind = cols[2] ? cols[2].trim() : null;
      const title = (cols[3] || '').trim();
      const abstractOriginal = cols[4] ? cols[4].trim() : null;
      const abstract = cols[5] ? cols[5].trim() : abstractOriginal;

      if (!publicationNumber || !title) {
        skipped++;
        continue;
      }

      const existing = await prisma.localPatent.findUnique({ where: { publicationNumber } });
      if (existing) {
        await prisma.localPatent.update({
          where: { publicationNumber },
          data: {
            kind,
            title,
            abstract,
            abstractOriginal,
          },
        });
        updated++;
      } else {
        await prisma.localPatent.create({
          data: {
            publicationNumber,
            kind,
            title,
            abstract,
            abstractOriginal,
          },
        });
        inserted++;
      }
    } catch (e) {
      console.error(`Line ${lineNo} failed:`, e);
      skipped++;
    }
  }

  console.log(JSON.stringify({ inserted, updated, skipped }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


