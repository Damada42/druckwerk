import { sql } from 'drizzle-orm';
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type {
  DocumentItem,
  DocumentKind,
  InvoiceType,
  MemberRole,
  Priority,
  ProjectStatus,
} from '@3dapp/shared';

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  company: text('company'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const persons = sqliteTable('persons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  contact: text('contact'),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const filamentTypes = sqliteTable('filament_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
});

export const finishes = sqliteTable('finishes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

/** Lagerplätze als Baum: Regal/Schrank › Seite › Reihe … */
export const storageLocations = sqliteTable('storage_locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => storageLocations.id, {
    onDelete: 'cascade',
  }),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
});

export const filamentSpools = sqliteTable('filament_spools', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  typeId: integer('type_id')
    .notNull()
    .references(() => filamentTypes.id),
  manufacturer: text('manufacturer').notNull(),
  colorName: text('color_name').notNull(),
  colorHex: text('color_hex').notNull().default('#cccccc'),
  finishId: integer('finish_id').references(() => finishes.id, { onDelete: 'set null' }),
  diameter: real('diameter').notNull().default(1.75),
  weightTotalG: real('weight_total_g').notNull().default(1000),
  weightRemainingG: real('weight_remaining_g').notNull().default(1000),
  price: real('price'),
  purchaseDate: text('purchase_date'),
  location: text('location'),
  storageLocationId: integer('storage_location_id').references(() => storageLocations.id, {
    onDelete: 'set null',
  }),
  haTrayEntity: text('ha_tray_entity'),
  barcode: text('barcode'),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** Gemerkte Sorte pro Barcode; die Spulen selbst bleiben in filament_spools. */
export const filamentProducts = sqliteTable('filament_products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  barcode: text('barcode').notNull().unique(),
  typeId: integer('type_id')
    .notNull()
    .references(() => filamentTypes.id),
  manufacturer: text('manufacturer').notNull(),
  colorName: text('color_name').notNull(),
  colorHex: text('color_hex').notNull().default('#cccccc'),
  finishId: integer('finish_id').references(() => finishes.id, { onDelete: 'set null' }),
  diameter: real('diameter').notNull().default(1.75),
  weightTotalG: real('weight_total_g').notNull().default(1000),
  price: real('price'),
  createdAt: createdAt(),
});

export const printers = sqliteTable('printers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  model: text('model').notNull(),
  nozzle: real('nozzle').notNull().default(0.4),
  hasAms: integer('has_ams', { mode: 'boolean' }).notNull().default(false),
  /** Device-ID in Home Assistant für Live-Status und Steuerung */
  haDeviceId: text('ha_device_id'),
  notes: text('notes'),
  powerW: real('power_w'),
  electricityPrice: real('electricity_price'),
  purchasePrice: real('purchase_price'),
  lifetimeHours: real('lifetime_hours'),
  maintenancePerYear: real('maintenance_per_year'),
  hoursPerYear: real('hours_per_year'),
  createdAt: createdAt(),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').$type<ProjectStatus>().notNull().default('open'),
  position: real('position').notNull().default(0),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  printerId: integer('printer_id').references(() => printers.id, { onDelete: 'set null' }),
  dueDate: text('due_date'),
  priority: text('priority').$type<Priority>().notNull().default('normal'),
  price: real('price'),
  printHours: real('print_hours'),
  /** Vorschlag für Angebot/Rechnung: Aufschlag auf jeden Einzelpreis in Prozent */
  markupPercent: real('markup_percent').notNull().default(0),
  /** Verkaufspreis folgt automatisch den Gesamtkosten plus Aufschlag */
  priceAuto: integer('price_auto', { mode: 'boolean' }).notNull().default(true),
  /** Vorschlag für Angebot/Rechnung: eigene UID-Nummer aufs Dokument drucken */
  showVatId: integer('show_vat_id', { mode: 'boolean' }).notNull().default(true),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: createdAt().$onUpdate(() => new Date().toISOString().slice(0, 19) + 'Z'),
});

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull().default('team'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.personId] })],
);

export const projectFilaments = sqliteTable('project_filaments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  spoolId: integer('spool_id')
    .notNull()
    .references(() => filamentSpools.id, { onDelete: 'cascade' }),
  plannedGrams: real('planned_grams').notNull().default(0),
  usedGrams: real('used_grams'),
});

export const projectCosts = sqliteTable('project_costs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** Schlüssel einer Kategorie aus cost_categories */
  category: text('category').notNull().default('other'),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  /** Einheit der Menge, z.B. „Stück“, „Packung“, „Meter“ */
  unit: text('unit').notNull().default('Stück'),
  unitPrice: real('unit_price').notNull().default(0),
});

/**
 * Kategorien für Zusatzkosten, unter „Einstellungen“ erweiterbar. Preis und Einheit sind
 * Vorschläge für neue Positionen; im Projekt bleiben sie änderbar.
 */
export const costCategories = sqliteTable('cost_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Fester Schlüssel, unter dem Projektpositionen die Kategorie speichern */
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  unit: text('unit').notNull().default('Stück'),
  defaultPrice: real('default_price'),
  position: real('position').notNull().default(0),
});

/** Verbindungen zu Home Assistant – eine pro Standort. Adresse und Token verlassen den Server nie. */
export const haConnections = sqliteTable('ha_connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  token: text('token').notNull(),
  /**
   * Das eigene Home Assistant, wenn Druckwerk als HA-App läuft: Adresse und Token kommen vom
   * Supervisor (SUPERVISOR_TOKEN) und stehen nicht in der Datenbank
   */
  local: integer('local', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

/**
 * Kameras eines Druckers: eine Kamera-Entity aus Home Assistant oder eine direkte Stream-Adresse
 * (z.B. Crowsnest bei Klipper). Der Browser sieht die Bilder nur über den Server.
 */
export const printerCameras = sqliteTable('printer_cameras', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  printerId: integer('printer_id')
    .notNull()
    .references(() => printers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Quelle Home Assistant: Verbindung + camera.*-Entity */
  haConnectionId: integer('ha_connection_id').references(() => haConnections.id, {
    onDelete: 'cascade',
  }),
  entityId: text('entity_id'),
  /** Quelle direkt: MJPEG-Stream und optional Standbild */
  streamUrl: text('stream_url'),
  snapshotUrl: text('snapshot_url'),
  /** Drehung des Bildes in Grad (0, 90, 180, 270) */
  rotation: integer('rotation').notNull().default(0),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
});

/** Einfache Schlüssel-Wert-Einstellungen */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Vom Server nach einem Druck automatisch abgebuchtes Filament (zum Nachvollziehen/Rückgängigmachen) */
export const filamentBookings = sqliteTable(
  'filament_bookings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    spoolId: integer('spool_id')
      .notNull()
      .references(() => filamentSpools.id, { onDelete: 'cascade' }),
    printerId: integer('printer_id').references(() => printers.id, { onDelete: 'set null' }),
    grams: real('grams').notNull(),
    jobName: text('job_name'),
    /** Kennung des Druckauftrags; verhindert doppeltes Abbuchen */
    jobKey: text('job_key').notNull(),
    estimated: integer('estimated', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('filament_bookings_job_spool').on(t.jobKey, t.spoolId)],
);

export const invoices = sqliteTable('invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').$type<InvoiceType>().notNull().default('incoming'),
  date: text('date').notNull(),
  number: text('number'),
  amount: real('amount').notNull().default(0),
  description: text('description'),
  filePath: text('file_path'),
  fileName: text('file_name'),
  createdAt: createdAt(),
});

/** Angebote und Rechnungen an Kunden; Inhalt und PDF bleiben so, wie sie erstellt wurden */
export const projectDocuments = sqliteTable('project_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<DocumentKind>().notNull(),
  number: text('number').notNull().unique(),
  date: text('date').notNull(),
  serviceDate: text('service_date'),
  dueDate: text('due_date'),
  recipient: text('recipient').notNull(),
  intro: text('intro'),
  notes: text('notes'),
  items: text('items', { mode: 'json' }).$type<DocumentItem[]>().notNull(),
  smallBusiness: integer('small_business', { mode: 'boolean' }).notNull(),
  /** UID-Nummer stand auf diesem Dokument */
  showVatId: integer('show_vat_id', { mode: 'boolean' }).notNull().default(true),
  vatRate: real('vat_rate').notNull(),
  net: real('net').notNull(),
  vat: real('vat').notNull(),
  gross: real('gross').notNull(),
  filePath: text('file_path').notNull(),
  /** Eintrag unter „Rechnungen“ (Ausgang), der mit dem Dokument angelegt wurde */
  invoiceId: integer('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});
