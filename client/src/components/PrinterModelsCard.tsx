import type { PrinterModel } from '@3dapp/shared';
import { Check, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useList, useSave } from '../api';
import { ManufacturerSelect } from './ManufacturerSelect';
import { Button, Card, ErrorText, TextInput } from './ui';

/** Druckermodelle je Hersteller: Auswahl bei Druckern und Ersatzteilen */
export function PrinterModelsCard() {
  const { data: models = [] } = useList('printer-models');
  const { save, remove } = useSave('printer-models');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [maker, setMaker] = useState('');
  const [name, setName] = useState('');

  const groups = new Map<number, { manufacturer: string; models: PrinterModel[] }>();
  for (const m of models) {
    const g = groups.get(m.manufacturerId) ?? { manufacturer: m.manufacturer, models: [] };
    g.models.push(m);
    groups.set(m.manufacturerId, g);
  }

  const add = () => {
    if (!maker.trim() || !name.trim()) return;
    save.mutate({ manufacturer: maker.trim(), name: name.trim() } as never, {
      onSuccess: (m) => {
        setName('');
        setOpen((m as PrinterModel).manufacturerId);
      },
    });
  };
  const rename = (m: PrinterModel) => {
    if (!editing?.name.trim()) return;
    save.mutate(
      { id: m.id, manufacturerId: m.manufacturerId, name: editing.name.trim() } as never,
      { onSuccess: () => setEditing(null) },
    );
  };

  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Druckermodelle</h2>
      <p className="mb-3 text-xs text-muted">
        Auswahl bei Druckern und Ersatzteilen. Umbenennen ändert auch den Modellnamen der Drucker.
        Die Hersteller kommen aus der gemeinsamen Herstellerliste.
      </p>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {[...groups.entries()].map(([id, g]) => (
          <li key={id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium"
              aria-expanded={open === id}
              onClick={() => setOpen(open === id ? null : id)}
            >
              <ChevronRight
                size={16}
                className={open === id ? 'rotate-90 transition-transform' : 'transition-transform'}
              />
              <span className="flex-1">{g.manufacturer}</span>
              <span className="text-xs font-normal text-muted">{g.models.length}</span>
            </button>
            {open === id && (
              <ul className="mb-2 ml-6 divide-y divide-[var(--border)]">
                {g.models.map((m) =>
                  editing?.id === m.id ? (
                    <li key={m.id}>
                      <form
                        className="flex items-center gap-2 py-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          rename(m);
                        }}
                      >
                        <TextInput
                          autoFocus
                          aria-label={`${m.name} umbenennen`}
                          value={editing.name}
                          onChange={(e) => setEditing({ id: m.id, name: e.target.value })}
                        />
                        <Button type="submit" variant="ghost" aria-label="Übernehmen">
                          <Check size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label="Abbrechen"
                          onClick={() => setEditing(null)}
                        >
                          <X size={15} />
                        </Button>
                      </form>
                    </li>
                  ) : (
                    <li key={m.id} className="flex items-center gap-1 py-1 text-sm">
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <Button
                        variant="ghost"
                        aria-label={`${m.name} umbenennen`}
                        onClick={() => setEditing({ id: m.id, name: m.name })}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`${m.name} löschen`}
                        onClick={() =>
                          confirm(`„${g.manufacturer} ${m.name}“ löschen?`) && remove.mutate(m.id)
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <ManufacturerSelect value={maker} onChange={setMaker} id="new-model-maker" />
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Sidewinder X1"
          aria-label="Neues Druckermodell"
        />
        <Button type="submit" disabled={!maker.trim() || !name.trim() || save.isPending}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Card>
  );
}
