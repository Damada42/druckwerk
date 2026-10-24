import { sql } from 'drizzle-orm';
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CostCategory, InvoiceType, MemberRole, Priority, ProjectStatus } from '@3dapp/shared';

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
  haTrayEntity: text('ha_tray_entity'),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const printers = sqliteTable('printers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  model: text('model').notNull(),
  nozzle: real('nozzle').notNull().default(0.4),
  hasAms: integer('has_ams', { mode: 'boolean' }).notNull().default(false),
  haEntityPrefix: text('ha_entity_prefix'),
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
  category: text('category').$type<CostCategory>().notNull().default('other'),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unitPrice: real('unit_price').notNull().default(0),
});

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
