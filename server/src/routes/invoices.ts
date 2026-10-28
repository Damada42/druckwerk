import { INVOICE_TYPES, type InvoiceType } from '@3dapp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { schema, type Db } from '../db/index.js';
import { parseId } from './crud.js';

const { invoices, projectDocuments, projects } = schema;

const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic']);

export async function removeUpload(uploadDir: string, filePath: string | null) {
  if (!filePath) return;
  await unlink(path.join(uploadDir, path.basename(filePath))).catch(() => undefined);
}

/**
 * Rechnungen: per multipart/form-data (Felder + optionale Datei „file“) anlegen.
 * Dateien landen im Upload-Ordner und sind unter /uploads/<name> abrufbar.
 */
export function registerInvoiceRoutes(app: FastifyInstance, db: Db, uploadDir: string) {
  app.post<{ Params: { id: string } }>('/projects/:id/invoices', async (req, reply) => {
    const projectId = parseId(req.params.id);
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
      return reply.code(404).send({ error: 'Projekt nicht gefunden' });
    }

    const fields: Record<string, string> = {};
    let filePath: string | null = null;
    let fileName: string | null = null;

    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const ext = path.extname(part.filename).toLowerCase();
          if (!ALLOWED_EXT.has(ext)) {
            part.file.resume();
            return reply.code(400).send({ error: 'Nur PDF oder Bilder erlaubt' });
          }
          const stored = `${randomUUID()}${ext}`;
          await pipeline(part.file, createWriteStream(path.join(uploadDir, stored)));
          filePath = `/uploads/${stored}`;
          fileName = part.filename;
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } else {
      Object.assign(fields, req.body ?? {});
    }

    const type: InvoiceType = INVOICE_TYPES.includes(fields.type as InvoiceType)
      ? (fields.type as InvoiceType)
      : 'incoming';
    const row = db
      .insert(invoices)
      .values({
        projectId,
        type,
        date: fields.date || new Date().toISOString().slice(0, 10),
        number: fields.number || null,
        amount: Number(String(fields.amount ?? '0').replace(',', '.')) || 0,
        description: fields.description || null,
        filePath,
        fileName,
      })
      .returning()
      .get();
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { id: string } }>('/invoices/:id', async (req, reply) => {
    const row = db
      .delete(invoices)
      .where(eq(invoices.id, parseId(req.params.id)))
      .returning()
      .get();
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    // Das PDF einer erstellten Rechnung gehört dem Dokument und bleibt
    const ofDocument =
      row.filePath &&
      db
        .select({ id: projectDocuments.id })
        .from(projectDocuments)
        .where(eq(projectDocuments.filePath, row.filePath))
        .get();
    if (!ofDocument) await removeUpload(uploadDir, row.filePath);
    return reply.code(204).send();
  });
}
