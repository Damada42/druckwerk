// Gemeinsame Typen und Konstanten für Server und Client.

export const PROJECT_STATUSES = ['open', 'in_progress', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
};

export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Niedrig',
  normal: 'Normal',
  high: 'Hoch',
};

export const COST_CATEGORIES = [
  'electronics',
  'wood',
  'metal',
  'led',
  'hardware',
  'other',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  electronics: 'Elektronik',
  wood: 'Holz',
  metal: 'Metall',
  led: 'LEDs',
  hardware: 'Schrauben & Kleinteile',
  other: 'Sonstiges',
};

export const INVOICE_TYPES = ['incoming', 'outgoing'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  incoming: 'Eingang (Einkauf)',
  outgoing: 'Ausgang (an Kunde)',
};

export const MEMBER_ROLES = ['team', 'support'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  team: 'Team',
  support: 'Unterstützung',
};

/** Ab dieser Restmenge (g) gilt eine Spule als „knapp“. */
export const LOW_FILAMENT_GRAMS = 200;

export interface Customer {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Person {
  id: number;
  name: string;
  contact: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FilamentType {
  id: number;
  name: string;
  description: string | null;
}

export interface Finish {
  id: number;
  name: string;
}

export interface FilamentSpool {
  id: number;
  typeId: number;
  manufacturer: string;
  colorName: string;
  colorHex: string;
  finishId: number | null;
  diameter: number;
  weightTotalG: number;
  weightRemainingG: number;
  price: number | null;
  purchaseDate: string | null;
  location: string | null;
  haTrayEntity: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Printer {
  id: number;
  name: string;
  model: string;
  nozzle: number;
  hasAms: boolean;
  haEntityPrefix: string | null;
  notes: string | null;
  /** Kostenparameter für die Maschinenstunde */
  powerW: number | null;
  electricityPrice: number | null;
  purchasePrice: number | null;
  lifetimeHours: number | null;
  maintenancePerYear: number | null;
  hoursPerYear: number | null;
  createdAt: string;
}

export interface PrinterHourlyCosts {
  power: number;
  wear: number;
  maintenance: number;
  total: number;
}

type PrinterCostParams = Pick<
  Printer,
  | 'powerW'
  | 'electricityPrice'
  | 'purchasePrice'
  | 'lifetimeHours'
  | 'maintenancePerYear'
  | 'hoursPerYear'
>;

/**
 * Kosten pro Druckstunde:
 * Strom = Watt / 1000 × €/kWh, Abnutzung = Druckerpreis / Lebensdauer,
 * Wartung = Wartungskosten pro Jahr / Druckstunden pro Jahr.
 */
export function calcPrinterHourly(p: PrinterCostParams): PrinterHourlyCosts {
  const power = ((p.powerW ?? 0) / 1000) * (p.electricityPrice ?? 0);
  const wear = p.purchasePrice && p.lifetimeHours ? p.purchasePrice / p.lifetimeHours : 0;
  const maintenance =
    p.maintenancePerYear && p.hoursPerYear ? p.maintenancePerYear / p.hoursPerYear : 0;
  return { power, wear, maintenance, total: power + wear + maintenance };
}

export interface ProjectMember {
  personId: number;
  role: MemberRole;
}

export interface ProjectFilament {
  id: number;
  spoolId: number;
  plannedGrams: number;
  usedGrams: number | null;
}

export interface ProjectCost {
  id: number;
  category: CostCategory;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: number;
  projectId: number;
  type: InvoiceType;
  date: string;
  number: string | null;
  amount: number;
  description: string | null;
  filePath: string | null;
  fileName: string | null;
  createdAt: string;
}

export interface Project {
  id: number;
  title: string;
  description: string | null;
  status: ProjectStatus;
  position: number;
  customerId: number | null;
  printerId: number | null;
  dueDate: string | null;
  priority: Priority;
  price: number | null;
  /** Geschätzte bzw. tatsächliche Druckzeit in Stunden */
  printHours: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Projekt inkl. aller Unterlisten, wie es die API ausliefert. */
export interface ProjectWithDetails extends Project {
  members: ProjectMember[];
  filaments: ProjectFilament[];
  costs: ProjectCost[];
  invoices: Invoice[];
}

export interface DashboardStats {
  projects: Record<ProjectStatus, number>;
  customers: number;
  persons: number;
  printers: number;
  spools: number;
  filamentTotalG: number;
  lowSpools: number;
}

export type Input<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

export interface CostBreakdown {
  filament: number;
  /** Druckzeit × Kosten pro Druckstunde des gewählten Druckers */
  machine: number;
  extras: number;
  total: number;
}

/** Filamentkosten (Preis/Spule anteilig nach Gramm) plus Maschinen- und Zusatzkosten. */
export function calcProjectCosts(
  project: Pick<ProjectWithDetails, 'filaments' | 'costs' | 'printerId' | 'printHours'>,
  spools: Pick<FilamentSpool, 'id' | 'price' | 'weightTotalG'>[],
  printers: (PrinterCostParams & { id: number })[] = [],
): CostBreakdown {
  const filament = project.filaments.reduce((sum, f) => {
    const spool = spools.find((s) => s.id === f.spoolId);
    if (!spool?.price || !spool.weightTotalG) return sum;
    const grams = f.usedGrams ?? f.plannedGrams;
    return sum + (spool.price / spool.weightTotalG) * grams;
  }, 0);
  const extras = project.costs.reduce((sum, c) => sum + c.quantity * c.unitPrice, 0);
  const printer = printers.find((p) => p.id === project.printerId);
  const machine =
    printer && project.printHours ? calcPrinterHourly(printer).total * project.printHours : 0;
  return { filament, machine, extras, total: filament + machine + extras };
}
