import {
  calcPrinterHourly,
  type CostCategory,
  type FilamentSpool,
  type FilamentType,
  type Finish,
  type Printer,
  type ProjectWithDetails,
} from '@3dapp/shared';
import { grams } from './ui';

/** Position im Angebots-/Rechnungsformular, Zahlen als Text (wie eingegeben) */
export interface ItemDraft {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** Aufschlag in Prozent; Vorschlag aus dem Projekt, nur für dieses Dokument änderbar */
  markup: string;
}

export const str = (n: number) => String(n).replace('.', ',');
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ItemContext {
  spools: FilamentSpool[];
  types: FilamentType[];
  finishes: Finish[];
  printers: Printer[];
  categories: CostCategory[];
}

/**
 * Positionen aus den Projektkosten: je Filament eine Materialposition, die Druckzeit mit dem
 * Stundensatz des Druckers und alle Zusatzkosten. Preise ohne Aufschlag; der kommt pro Position
 * aus dem Projekt dazu.
 */
export function costItems(project: ProjectWithDetails, ctx: ItemContext): ItemDraft[] {
  const markup = project.markupPercent ? str(project.markupPercent) : '';
  const items: ItemDraft[] = [];

  for (const f of project.filaments) {
    const spool = ctx.spools.find((s) => s.id === f.spoolId);
    if (!spool) continue;
    const used = f.usedGrams ?? f.plannedGrams;
    const type = ctx.types.find((t) => t.id === spool.typeId)?.name ?? '';
    const finish = ctx.finishes.find((x) => x.id === spool.finishId)?.name;
    const price =
      spool.price && spool.weightTotalG ? round2((spool.price / spool.weightTotalG) * used) : 0;
    items.push({
      description: `Material: ${type} ${spool.colorName}${finish && finish !== 'Normal' ? ` ${finish}` : ''} (${spool.manufacturer}), ${grams(used)}`,
      quantity: '1',
      unit: '',
      unitPrice: str(price),
      markup,
    });
  }

  const printer = ctx.printers.find((p) => p.id === project.printerId);
  if (printer && project.printHours) {
    items.push({
      description: `Druckzeit (${printer.name})`,
      quantity: str(project.printHours),
      unit: 'Stunde',
      unitPrice: str(round2(calcPrinterHourly(printer).total)),
      markup,
    });
  }

  for (const c of project.costs) {
    const category = ctx.categories.find((k) => k.key === c.category)?.name ?? '';
    items.push({
      description: c.description || category,
      quantity: str(c.quantity),
      unit: c.unit,
      unitPrice: str(c.unitPrice),
      markup,
    });
  }
  return items;
}

/** Eine Pauschalposition aus Projekttitel und Verkaufspreis (wie bisher) */
export function flatItem(project: ProjectWithDetails): ItemDraft[] {
  return [
    {
      description: project.title,
      quantity: '1',
      unit: '',
      unitPrice: str(project.price ?? 0),
      markup: project.markupPercent ? str(project.markupPercent) : '',
    },
  ];
}
