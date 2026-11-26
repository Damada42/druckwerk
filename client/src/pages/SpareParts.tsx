import {
  guessPartCategory,
  partLabel,
  modelLabel,
  storagePaths,
  storageTree,
  type PartCategory,
  type SparePart,
} from '@3dapp/shared';
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Minus,
  Pencil,
  Plus,
  Search,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useList, usePartStock, useSettings } from '../api';
import { EntityForm, type FieldDef } from '../components/EntityForm';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  PageHeader,
  Select,
  TextInput,
  cx,
  euro,
} from '../components/ui';

type SortMode = 'category' | 'manufacturer';
const SORT_KEY = 'druckwerk.parts.sort';
const collapsedKey = (mode: SortMode) => `druckwerk.parts.collapsed.${mode}`;

/** Gemerkte Ansicht (Sortierung, zugeklappte Abschnitte) – nur Bequemlichkeit, darf fehlen */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // privater Modus o.ä.: dann eben ohne Merken
  }
}

interface PartGroup {
  key: string;
  title: string;
  parts: SparePart[];
}

/** Teile in Abschnitte: nach Kategorie (Reihenfolge der Einstellungen) oder Hersteller (A–Z) */
function groupParts(parts: SparePart[], mode: SortMode, categories: PartCategory[]): PartGroup[] {
  const byName = (a: SparePart, b: SparePart) =>
    partLabel(a).localeCompare(partLabel(b), 'de', { numeric: true });
  if (mode === 'category') {
    const groups: PartGroup[] = categories.map((c) => ({
      key: String(c.id),
      title: c.name,
      parts: parts.filter((p) => p.categoryId === c.id).sort(byName),
    }));
    groups.push({
      key: 'none',
      title: 'Ohne Kategorie',
      parts: parts.filter((p) => !categories.some((c) => c.id === p.categoryId)).sort(byName),
    });
    return groups.filter((g) => g.parts.length);
  }
  const makers = new Map<string, PartGroup>();
  for (const p of parts) {
    const name = p.manufacturer?.trim() || '';
    const key = name.toLowerCase() || 'none';
    const g = makers.get(key) ?? { key, title: name || 'Ohne Hersteller', parts: [] };
    g.parts.push(p);
    makers.set(key, g);
  }
  return [...makers.values()]
    .map((g) => ({ ...g, parts: g.parts.sort(byName) }))
    .sort((a, b) =>
      a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.title.localeCompare(b.title, 'de'),
    );
}

export function SparePartsPage() {
  const { data: settings } = useSettings();
  const { data: parts = [], isLoading } = useList('spare-parts');
  const { data: tasks = [] } = useList('maintenance-tasks');
  const { data: printers = [] } = useList('printers');
  const { data: locations = [] } = useList('storage-locations', !!settings?.storageLocations);
  const { data: models = [] } = useList('printer-models');
  const { data: categories = [] } = useList('part-categories');
  const stock = usePartStock();
  /** Teil bearbeiten, neu anlegen oder als Vorlage für ein neues kopieren */
  const [editing, setEditing] = useState<SparePart | 'new' | { copyOf: SparePart } | null>(null);
  /** Filter: nur Teile für dieses Modell (0 = alle) */
  const [modelFilter, setModelFilter] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<SortMode>(() =>
    readStored<SortMode>(SORT_KEY, 'category') === 'manufacturer' ? 'manufacturer' : 'category',
  );
  const [collapsed, setCollapsedState] = useState<string[]>(() =>
    readStored<string[]>(collapsedKey(sort), []),
  );
  const setSort = (mode: SortMode) => {
    setSortState(mode);
    store(SORT_KEY, mode);
    setCollapsedState(readStored<string[]>(collapsedKey(mode), []));
  };
  const setCollapsed = (keys: string[]) => {
    setCollapsedState(keys);
    store(collapsedKey(sort), keys);
  };

  if (settings && !settings.maintenance) {
    return (
      <>
        <PageHeader title="Ersatzteile" />
        <Empty>
          Ersatzteile und Wartung sind ausgeschaltet. Du kannst sie unter{' '}
          <Link to="/einstellungen" className="font-medium text-accent underline">
            Einstellungen
          </Link>{' '}
          einschalten.
        </Empty>
      </>
    );
  }

  const paths = storagePaths(locations);
  const withPlaces = !!settings?.storageLocations;
  const guessId = (name: string) => categories.find((c) => c.key === guessPartCategory(name))?.id;
  const fields: FieldDef[] = [
    {
      key: 'name',
      label: 'Name',
      required: true,
      wide: true,
      // Neues Teil: Kategorie aus dem Namen vorschlagen, bis sie jemand selbst wählt
      onChange: (v, s) =>
        !s.id && !s.categoryChosen ? { categoryId: guessId(String(v ?? '')) ?? null } : {},
    },
    {
      key: 'variant',
      label: 'Ausführung',
      placeholder: 'z.B. gehärtet, 0,6 mm, Edelstahl',
    },
    {
      key: 'categoryId',
      label: 'Kategorie',
      type: 'select',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
      onChange: () => ({ categoryChosen: true }),
    },
    { key: 'manufacturer', label: 'Hersteller', type: 'manufacturer' },
    { key: 'partNumber', label: 'Artikelnummer' },
    { key: 'price', label: 'Preis (€)', type: 'number', step: '0.01' },
    { key: 'shopUrl', label: 'Shop-Link', wide: true, placeholder: 'https://…' },
    { key: 'modelIds', label: 'Passt für (Druckermodelle)', type: 'printerModels', wide: true },
    { key: 'stockQty', label: 'Auf Lager (Stück)', type: 'number' },
    { key: 'minStock', label: 'Mindestbestand', type: 'number', placeholder: '0 = keine Warnung' },
    ...(withPlaces
      ? [
          {
            key: 'storageLocationId',
            label: 'Lagerplatz',
            type: 'select' as const,
            wide: true,
            options: storageTree(locations).map(({ location, path }) => ({
              value: location.id,
              label: path,
            })),
          },
        ]
      : []),
    { key: 'notes', label: 'Notizen', type: 'textarea' },
  ];

  const modelName = (id: number) => {
    const m = models.find((x) => x.id === id);
    return m ? modelLabel(m) : null;
  };
  // Im Filter nur Modelle, für die es Teile gibt – und die Modelle der eigenen Drucker
  const filterIds = new Set([
    ...parts.flatMap((p) => p.modelIds),
    ...printers.flatMap((p) => (p.modelId ? [p.modelId] : [])),
  ]);
  const filterModels = models.filter((m) => filterIds.has(m.id));
  const search = query.trim().toLowerCase();
  const sorted = parts.filter(
    (p) =>
      (!modelFilter || p.modelIds.includes(modelFilter)) &&
      (!search || `${partLabel(p)}\n${p.notes ?? ''}`.toLowerCase().includes(search)),
  );
  const groups = groupParts(sorted, sort, categories);
  // Beim Suchen sind alle Abschnitte mit Treffern offen
  const isOpen = (key: string) => !!search || !collapsed.includes(key);
  const toggle = (key: string) =>
    setCollapsed(
      collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key],
    );
  const allClosed = groups.length > 0 && groups.every((g) => collapsed.includes(g.key));

  return (
    <>
      <PageHeader
        title="Ersatzteile"
        subtitle="Teile mit Lagerbestand. Welcher Drucker sie wann braucht, steht im Wartungsplan bei den Druckern."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Ersatzteil
          </Button>
        }
      />
      {parts.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_auto_minmax(0,1.5fr)_auto]">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <TextInput
              type="search"
              className="pl-9"
              aria-label="Ersatzteile suchen"
              placeholder="Suchen in Name und Notizen …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select
            aria-label="Sortieren nach"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
          >
            <option value="category">Nach Kategorie</option>
            <option value="manufacturer">Nach Hersteller</option>
          </Select>
          {filterModels.length > 0 ? (
            <Select
              aria-label="Nach Druckermodell filtern"
              value={modelFilter}
              onChange={(e) => setModelFilter(Number(e.target.value))}
            >
              <option value={0}>Alle Druckermodelle</option>
              {filterModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {modelLabel(m)}
                </option>
              ))}
            </Select>
          ) : (
            <span className="hidden lg:block" />
          )}
          <Button
            disabled={!groups.length || !!search}
            onClick={() => setCollapsed(allClosed ? [] : groups.map((g) => g.key))}
          >
            {allClosed ? 'Alle aufklappen' : 'Alle zuklappen'}
          </Button>
        </div>
      )}
      {!isLoading && parts.length > 0 && sorted.length === 0 && (
        <Empty>
          {search
            ? `Kein Ersatzteil mit „${query.trim()}“ im Namen oder in den Notizen.`
            : 'Keine Ersatzteile für dieses Modell.'}
        </Empty>
      )}
      {!isLoading && parts.length === 0 && (
        <Empty>
          Noch keine Ersatzteile. Lege sie hier an oder übernimm bei einem Drucker die Vorlage
          seines Modells.
        </Empty>
      )}
      <div className="space-y-3">
        {groups.map((g) => {
          const open = isOpen(g.key);
          const low = g.parts.filter((p) => p.minStock > 0 && p.stockQty < p.minStock).length;
          return (
            <section key={g.key} aria-label={g.title}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(g.key)}
                disabled={!!search}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase hover:text-[var(--text)]"
              >
                <ChevronRight
                  size={16}
                  className={cx('shrink-0 transition-transform', open && 'rotate-90')}
                />
                <span className="flex-1">{g.title}</span>
                {low > 0 && <Badge className="!text-red-600 normal-case">{low} knapp</Badge>}
                <span className="font-normal tabular-nums">{g.parts.length}</span>
              </button>
              {open && (
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  {g.parts.map(renderPart)}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <ErrorText error={stock.error} />
      {editing && (
        <EntityForm
          resource="spare-parts"
          title={
            editing === 'new'
              ? 'Neues Ersatzteil'
              : 'copyOf' in editing
                ? 'Ersatzteil kopieren'
                : editing.name
          }
          fields={fields}
          initial={
            editing === 'new'
              ? undefined
              : 'copyOf' in editing
                ? // Alles übernehmen außer Bestand; die Kategorie bleibt, auch wenn der Name sich ändert
                  ({
                    ...editing.copyOf,
                    id: undefined,
                    createdAt: undefined,
                    stockQty: 0,
                    categoryChosen: true,
                  } as unknown as SparePart)
                : editing
          }
          defaults={{ stockQty: 0, minStock: 0, modelIds: modelFilter ? [modelFilter] : [] }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );

  function renderPart(p: SparePart) {
    const low = p.minStock > 0 && p.stockQty < p.minStock;
    const usedBy = tasks
      .filter((t) => t.partId === p.id)
      .map((t) => `${printers.find((pr) => pr.id === t.printerId)?.name ?? '?'}: ${t.name}`);
    return (
      <Card key={p.id} className="p-4" role="region" aria-label={partLabel(p)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong dark:text-orange-300">
              <Wrench size={20} />
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {p.name}
                {p.variant && (
                  <span className="ml-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">
                    {p.variant}
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted">
                {[p.manufacturer, p.partNumber].filter(Boolean).join(' · ') || '–'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              className="!p-1.5"
              aria-label={`${partLabel(p)} kopieren`}
              title="Kopieren (als neues Teil)"
              onClick={() => setEditing({ copyOf: p })}
            >
              <Copy size={16} />
            </Button>
            <Button
              variant="ghost"
              className="!p-1.5"
              aria-label={`${partLabel(p)} bearbeiten`}
              title="Bearbeiten"
              onClick={() => setEditing(p)}
            >
              <Pencil size={16} />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              className="!p-1.5"
              aria-label={`${partLabel(p)} eins weniger`}
              disabled={p.stockQty === 0 || stock.isPending}
              onClick={() => stock.mutate({ id: p.id, delta: -1 })}
            >
              <Minus size={14} />
            </Button>
            <span
              className={cx(
                'min-w-16 text-center text-sm tabular-nums',
                low && 'font-semibold text-red-600',
              )}
              data-testid="stock"
            >
              {p.stockQty} Stück
            </span>
            <Button
              className="!p-1.5"
              aria-label={`${partLabel(p)} eins mehr`}
              disabled={stock.isPending}
              onClick={() => stock.mutate({ id: p.id, delta: 1 })}
            >
              <Plus size={14} />
            </Button>
            {low && <Badge className="!text-red-600">knapp (min. {p.minStock})</Badge>}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {p.price !== null && <span className="tabular-nums">{euro(p.price)}</span>}
            {p.shopUrl && (
              <a
                href={p.shopUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Shop <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>

        {p.notes?.trim() && (
          <p className="mt-3 text-xs whitespace-pre-line text-muted" data-testid="notes">
            {p.notes.trim()}
          </p>
        )}
        {(usedBy.length > 0 || p.modelIds.length > 0 || (withPlaces && p.storageLocationId)) && (
          <dl className="mt-3 space-y-1 text-xs">
            {p.modelIds.length > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted">Passt für</dt>
                <dd className="min-w-0">{p.modelIds.map(modelName).filter(Boolean).join(', ')}</dd>
              </div>
            )}
            {withPlaces && p.storageLocationId && (
              <div className="flex gap-2">
                <dt className="text-muted">Lagerplatz</dt>
                <dd>{paths.get(p.storageLocationId) ?? '–'}</dd>
              </div>
            )}
            {usedBy.length > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted">Gebraucht für</dt>
                <dd className="min-w-0">{usedBy.join(', ')}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>
    );
  }
}
