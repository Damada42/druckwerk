import { modelLabel, storagePaths, storageTree, type SparePart } from '@3dapp/shared';
import { ExternalLink, Minus, Pencil, Plus, Wrench } from 'lucide-react';
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
  cx,
  euro,
} from '../components/ui';

export function SparePartsPage() {
  const { data: settings } = useSettings();
  const { data: parts = [], isLoading } = useList('spare-parts');
  const { data: tasks = [] } = useList('maintenance-tasks');
  const { data: printers = [] } = useList('printers');
  const { data: locations = [] } = useList('storage-locations', !!settings?.storageLocations);
  const { data: models = [] } = useList('printer-models');
  const stock = usePartStock();
  const [editing, setEditing] = useState<SparePart | 'new' | null>(null);
  /** Filter: nur Teile für dieses Modell (0 = alle) */
  const [modelFilter, setModelFilter] = useState(0);

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
  const fields: FieldDef[] = [
    { key: 'name', label: 'Name', required: true, wide: true },
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
  const sorted = [...parts]
    .filter((p) => !modelFilter || p.modelIds.includes(modelFilter))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

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
      {parts.length > 0 && filterModels.length > 0 && (
        <div className="mb-4 max-w-xs">
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
        </div>
      )}
      {!isLoading && parts.length > 0 && sorted.length === 0 && (
        <Empty>Keine Ersatzteile für dieses Modell.</Empty>
      )}
      {!isLoading && parts.length === 0 && (
        <Empty>
          Noch keine Ersatzteile. Lege sie hier an oder übernimm bei einem Drucker die Vorlage
          seines Modells.
        </Empty>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {sorted.map((p) => {
          const low = p.minStock > 0 && p.stockQty < p.minStock;
          const usedBy = tasks
            .filter((t) => t.partId === p.id)
            .map((t) => `${printers.find((pr) => pr.id === t.printerId)?.name ?? '?'}: ${t.name}`);
          return (
            <Card key={p.id} className="p-4" role="region" aria-label={p.name}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong dark:text-orange-300">
                    <Wrench size={20} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted">
                      {[p.manufacturer, p.partNumber].filter(Boolean).join(' · ') || '–'}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="!p-1.5"
                  aria-label={`${p.name} bearbeiten`}
                  title="Bearbeiten"
                  onClick={() => setEditing(p)}
                >
                  <Pencil size={16} />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    className="!p-1.5"
                    aria-label={`${p.name} eins weniger`}
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
                    aria-label={`${p.name} eins mehr`}
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

              {(usedBy.length > 0 ||
                p.modelIds.length > 0 ||
                (withPlaces && p.storageLocationId)) && (
                <dl className="mt-3 space-y-1 text-xs">
                  {p.modelIds.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted">Passt für</dt>
                      <dd className="min-w-0">
                        {p.modelIds.map(modelName).filter(Boolean).join(', ')}
                      </dd>
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
        })}
      </div>
      <ErrorText error={stock.error} />
      {editing && (
        <EntityForm
          resource="spare-parts"
          title={editing === 'new' ? 'Neues Ersatzteil' : editing.name}
          fields={fields}
          initial={editing === 'new' ? undefined : editing}
          defaults={{ stockQty: 0, minStock: 0, modelIds: modelFilter ? [modelFilter] : [] }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
