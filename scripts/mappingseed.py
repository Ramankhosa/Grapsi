import csv
import os
import sys
from pathlib import Path
import psycopg2

CSV_PATH = Path(__file__).resolve().parent.parent / 'Countries' / 'patent_sections.csv'
DB_URL = os.getenv('DATABASE_URL') or os.getenv('DATABASE_URL_WRITE') or 'postgresql://postgres:123@localhost:5432/spotipr'

def load_rows(path: Path):
    rows = list(csv.reader(path.read_text(encoding='utf-8', errors='ignore').splitlines()))
    header = rows[0]
    country_codes = header[1:]
    inserts = []
    for row in rows[1:]:
        superset = row[0]
        for code, heading in zip(country_codes, row[1:]):
            heading = (heading or '').strip()
            if heading == '':
                continue
            inserts.append((code, superset, heading))
    return inserts

def seed(conn, rows):
    with conn.cursor() as cur:
        cur.execute('DELETE FROM "country_section_mappings";')
        for code, superset, heading in rows:
            cur.execute(
                'INSERT INTO "country_section_mappings" (id, country_code, superset_code, heading, created_at, updated_at) VALUES (gen_random_uuid()::text, %s, %s, %s, now(), now());',
                (code, superset, heading)
            )
    conn.commit()

def main():
    rows = load_rows(CSV_PATH)
    if not rows:
        print('No rows found in CSV', file=sys.stderr)
        sys.exit(1)
    conn = psycopg2.connect(DB_URL)
    try:
        seed(conn, rows)
    finally:
        conn.close()
    print(f'Seeded {len(rows)} rows into country_section_mappings')

if __name__ == '__main__':
    main()
