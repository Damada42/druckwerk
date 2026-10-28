import { PROJECT_STATUSES, type ProjectStatus, type ProjectWithDetails } from '@3dapp/shared';
import { asc, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { missingFields, parseId, pickColumns } from './crud.js';
import { removeUpload } from './invoices.js';

const { projects, projectMembers, projectFilaments, projectCosts, invoices } = schema;

interface DetailsBody {
  members?: { personId: number; role?: string }[];
  filaments?: { spoolId: number; plannedGrams?: number; usedGrams?: number | null }[];
  costs?: {
    category?: string;
    description?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
  }[];
}

function isStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus);
}

export function loadProject(db: Db, id: number): ProjectWithDetails | undefined {
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return undefined;
  return {
    ...project,
    members: db
      .select({ personId: projectMembers.personId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, id))
      .all(),
    filaments: db
      .select({
        id: projectFilaments.id,
        spoolId: projectFilaments.spoolId,
        plannedGrams: projectFilaments.plannedGrams,
        usedGrams: projectFilaments.usedGrams,
      })
      .from(projectFilaments)
      .where(eq(projectFilaments.projectId, id))
      .all(),
    costs: db
      .select({
        id: projectCosts.id,
        category: projectCosts.category,
        description: projectCosts.description,
        quantity: projectCosts.quantity,
        unit: projectCosts.unit,
        unitPrice: projectCosts.unitPrice,
      })
      .from(projectCosts)
      .where(eq(projectCosts.projectId, id))
      .all(),
    invoices: db
      .select()
      .from(invoices)
      .where(eq(invoices.projectId, id))
      .orderBy(asc(invoices.date))
      .all(),
  };
}

function nextPosition(db: Db, status: ProjectStatus) {
  const [{ value }] = db
    .select({ value: max(projects.position) })
    .from(projects)
    .where(eq(projects.status, status))
    .all();
  return (value ?? 0) + 1;
}

/** Ersetzt Team, Material und Zusatzkosten, sofern sie im Body mitgeschickt werden. */
function replaceDetails(db: Db, projectId: number, body: DetailsBody) {
  if (Array.isArray(body.members)) {
    db.delete(projectMembers).where(eq(projectMembers.projectId, projectId)).run();
    const seen = new Set<number>();
    const rows = body.members
      .filter((m) => m.personId && !seen.has(m.personId) && seen.add(m.personId))
      .map(
        (m) =>
          ({
            projectId,
            personId: m.personId,
            role: m.role === 'support' ? 'support' : 'team',
          }) as const,
      );
    if (rows.length) db.insert(projectMembers).values(rows).run();
  }
  if (Array.isArray(body.filaments)) {
    db.delete(projectFilaments).where(eq(projectFilaments.projectId, projectId)).run();
    const rows = body.filaments
      .filter((f) => f.spoolId)
      .map((f) => ({
        projectId,
        spoolId: f.spoolId,
        plannedGrams: Number(f.plannedGrams) || 0,
        usedGrams: f.usedGrams === null || f.usedGrams === undefined ? null : Number(f.usedGrams),
      }));
    if (rows.length) db.insert(projectFilaments).values(rows).run();
  }
  if (Array.isArray(body.costs)) {
    db.delete(projectCosts).where(eq(projectCosts.projectId, projectId)).run();
    // Ohne Beschreibung reicht die Kategorie (z.B. „Versand“); ganz leere Zeilen fallen weg
    const rows = body.costs
      .filter((c) => c.description?.trim() || c.category)
      .map((c) => ({
        projectId,
        category: c.category || 'other',
        description: c.description?.trim() ?? '',
        quantity: Number.isFinite(Number(c.quantity)) ? Number(c.quantity) : 1,
        unit: c.unit?.trim() || 'Stück',
        unitPrice: Number(c.unitPrice) || 0,
      }));
    if (rows.length) db.insert(projectCosts).values(rows).run();
  }
}

export function registerProjectRoutes(app: FastifyInstance, db: Db, uploadDir: string) {
  app.get('/projects', () => {
    const ids = db
      .select({ id: projects.id })
      .from(projects)
      .orderBy(asc(projects.status), asc(projects.position))
      .all();
    return ids.map(({ id }) => loadProject(db, id));
  });

  app.get<{ Params: { id: string } }>('/projects/:id', (req, reply) => {
    return (
      loadProject(db, parseId(req.params.id)) ?? reply.code(404).send({ error: 'Nicht gefunden' })
    );
  });

  app.post('/projects', (req, reply) => {
    const data = pickColumns(projects, req.body);
    const missing = missingFields(data, ['title']);
    if (missing.length) return reply.code(400).send({ error: 'Titel fehlt' });
    const status = isStatus(data.status) ? data.status : 'open';
    const id = db.transaction((tx) => {
      const row = tx
        .insert(projects)
        .values({ ...(data as { title: string }), status, position: nextPosition(db, status) })
        .returning({ id: projects.id })
        .get();
      replaceDetails(db, row.id, req.body as DetailsBody);
      return row.id;
    });
    return reply.code(201).send(loadProject(db, id));
  });

  app.put<{ Params: { id: string } }>('/projects/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const data = pickColumns(projects, req.body);
    if (data.status !== undefined && !isStatus(data.status)) {
      return reply.code(400).send({ error: 'Ungültiger Status' });
    }
    const exists = db.transaction(() => {
      const row = db
        .update(projects)
        .set({
          ...(data as Partial<typeof projects.$inferInsert>),
          updatedAt: new Date().toISOString().slice(0, 19) + 'Z',
        })
        .where(eq(projects.id, id))
        .returning({ id: projects.id })
        .get();
      if (row) replaceDetails(db, id, req.body as DetailsBody);
      return !!row;
    });
    return exists ? loadProject(db, id) : reply.code(404).send({ error: 'Nicht gefunden' });
  });

  /** Kanban: Status und Position (Kommazahl zwischen den Nachbarn) setzen. */
  app.patch<{ Params: { id: string }; Body: { status?: unknown; position?: unknown } }>(
    '/projects/:id/move',
    (req, reply) => {
      const id = parseId(req.params.id);
      const { status, position } = req.body ?? {};
      if (!isStatus(status)) return reply.code(400).send({ error: 'Ungültiger Status' });
      const pos =
        typeof position === 'number' && Number.isFinite(position)
          ? position
          : nextPosition(db, status);
      const row = db
        .update(projects)
        .set({ status, position: pos, updatedAt: new Date().toISOString().slice(0, 19) + 'Z' })
        .where(eq(projects.id, id))
        .returning({ id: projects.id })
        .get();
      return row ? loadProject(db, id) : reply.code(404).send({ error: 'Nicht gefunden' });
    },
  );

  app.delete<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const files = db
      .select({ filePath: invoices.filePath })
      .from(invoices)
      .where(eq(invoices.projectId, id))
      .all();
    const result = db.delete(projects).where(eq(projects.id, id)).run();
    if (!result.changes) return reply.code(404).send({ error: 'Nicht gefunden' });
    // Rechnungsdateien des Projekts mit entfernen
    await Promise.all(files.map((f) => removeUpload(uploadDir, f.filePath)));
    return reply.code(204).send();
  });
}
