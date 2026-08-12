/**
 * Throwaway: proves the org-unit path triggers in migration
 * 20260806160000 maintain depth/path on insert, re-parent and cycle attempts.
 * Creates a disposable tenant and deletes it (cascade) at the end.
 */
import prisma from '@/lib/prisma';

const SUFFIX = `orgtree-${Date.now()}`;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${e}\n        actual   ${a}`}`);
}

async function unit(tenantId: string, name: string, parentId: string | null) {
  return prisma.tenantOrgUnit.create({
    data: {
      tenant_id: tenantId,
      name,
      parent_id: parentId,
      kind: parentId ? 'DEPARTMENT' : 'SCHOOL',
    },
    select: { id: true, name: true, depth: true, path: true },
  });
}

async function read(id: string) {
  return prisma.tenantOrgUnit.findUniqueOrThrow({
    where: { id },
    select: { id: true, name: true, depth: true, path: true },
  });
}

async function run() {
  const tenant = await prisma.tenant.create({
    data: { name: `Throwaway ${SUFFIX}`, atiId: `THROWAWAY-${SUFFIX}`, status: 'ACTIVE' },
    select: { id: true },
  });

  try {
    // --- insert: depth + path materialize down a 4-level chain -------------
    const a = await unit(tenant.id, 'University', null);
    const b = await unit(tenant.id, 'Faculty of Engineering', a.id);
    const c = await unit(tenant.id, 'School of Civil', b.id);
    const d = await unit(tenant.id, 'Structures Dept', c.id);

    check('root depth', a.depth, 0);
    check('root path is self', a.path, [a.id]);
    check('depth 3 leaf', d.depth, 3);
    check('leaf path root-first incl. self', d.path, [a.id, b.id, c.id, d.id]);

    // --- subtree query: the GIN overlap the whole feature rests on ---------
    const subtree = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tenant_org_units
       WHERE tenant_id = ${tenant.id} AND path && ARRAY[${b.id}]::text[]
       ORDER BY depth
    `;
    check('subtree of B includes B,C,D', subtree.map((r) => r.id), [b.id, c.id, d.id]);

    // --- re-parent: descendants rewritten in one statement -----------------
    const e = await unit(tenant.id, 'Second University', null);
    await prisma.tenantOrgUnit.update({ where: { id: b.id }, data: { parent_id: e.id } });

    const [b2, c2, d2] = await Promise.all([read(b.id), read(c.id), read(d.id)]);
    check('moved node reparented', b2.path, [e.id, b.id]);
    check('child rewritten', c2.path, [e.id, b.id, c.id]);
    check('grandchild rewritten', d2.path, [e.id, b.id, c.id, d.id]);
    check('grandchild depth recomputed', d2.depth, 3);

    // --- cycle guard --------------------------------------------------------
    let cycleBlocked = false;
    try {
      await prisma.tenantOrgUnit.update({ where: { id: b.id }, data: { parent_id: d.id } });
    } catch {
      cycleBlocked = true;
    }
    check('re-parent under own descendant rejected', cycleBlocked, true);

    // --- depth cap ----------------------------------------------------------
    let deep = await unit(tenant.id, 'L4', d.id);
    deep = await unit(tenant.id, 'L5', deep.id);
    deep = await unit(tenant.id, 'L6', deep.id);
    check('depth 6 allowed', deep.depth, 6);
    let capBlocked = false;
    try {
      await unit(tenant.id, 'L7', deep.id);
    } catch {
      capBlocked = true;
    }
    check('8th level rejected', capBlocked, true);

    // --- level names seeded for pre-existing tenants -------------------------
    const levels = await prisma.tenantOrgLevel.findMany({
      where: { tenant_id: tenant.id },
      orderBy: { depth: 'asc' },
      select: { depth: true, singular_name: true },
    });
    console.log(`INFO  levels seeded for this NEW tenant: ${JSON.stringify(levels)} (expected [] — the migration seeds existing tenants only)`);
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    const leftover = await prisma.tenantOrgUnit.count({ where: { tenant_id: tenant.id } });
    check('cleanup left nothing', leftover, 0);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

run()
  .catch((e) => {
    console.error('FAILED', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
