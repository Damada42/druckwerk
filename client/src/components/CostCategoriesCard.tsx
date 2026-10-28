import { COST_UNITS, type CostCategory } from '@3dapp/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useList, useSave } from '../api';
import { Button, Card, ErrorText, NumberInput, TextInput } from './ui';

/** Vorschläge für das Einheiten-Feld (frei eingebbar), auch im Projekt verwendet */
export function UnitSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {COST_UNITS.map((u) => (
        <option key={u} value={u} />
      ))}
    </datalist>
  );
}

/**
 * Kategorien für Zusatzkosten (Versand, Verpackung, Nachbearbeitung …) mit Einheit und
 * Standardpreis. Beides ist nur ein Vorschlag für neue Positionen im Projekt.
 */
export function CostCategoriesCard() {
  const { data: categories = [] } = useList('cost-categories');
  const { save, remove } = useSave('cost-categories');
  const [name, setName] = useState('');

  const add = () => {
    if (!name.trim()) return;
    save.mutate({ name: name.trim() } as never, { onSuccess: () => setName('') });
  };

  return (
    <Card className="mt-4 p-5">
      <h2 className="mb-1 font-semibold">Kategorien für Zusatzkosten</h2>
      <p className="mb-3 text-sm text-muted">
        Einheit und Preis werden im Projekt als Vorschlag eingetragen, wenn du die Kategorie wählst
        – dort lassen sie sich je Position ändern.
      </p>
      <UnitSuggestions id="cost-units" />
      <div className="mb-1 hidden grid-cols-[1fr_8rem_8rem_2rem] gap-2 px-1 text-xs text-muted sm:grid">
        <span>Name</span>
        <span>Einheit</span>
        <span>Standardpreis €</span>
      </div>
      <ul className="mb-3 space-y-2">
        {categories.map((c) => (
          <CategoryRow
            key={`${c.id}-${c.name}-${c.unit}-${c.defaultPrice}`}
            category={c}
            onSave={(patch) => save.mutate({ ...patch, id: c.id } as never)}
            onDelete={() => confirm(`Kategorie „${c.name}“ löschen?`) && remove.mutate(c.id)}
          />
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput
          aria-label="Neue Kategorie"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Versand, Verpackung, Nachbearbeitung"
        />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Card>
  );
}

/** Eine Kategorie – speichert beim Verlassen eines Feldes */
function CategoryRow({
  category,
  onSave,
  onDelete,
}: {
  category: CostCategory;
  onSave: (patch: Partial<Pick<CostCategory, 'name' | 'unit' | 'defaultPrice'>>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [unit, setUnit] = useState(category.unit);

  return (
    <li
      className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_8rem_8rem_2rem] sm:border-0 sm:p-0"
      aria-label={`Kategorie ${category.name}`}
    >
      <TextInput
        aria-label={`${category.name}: Name`}
        className="col-span-3 sm:col-span-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== category.name && onSave({ name: name.trim() })}
      />
      <TextInput
        aria-label={`${category.name}: Einheit`}
        list="cost-units"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => unit.trim() !== category.unit && onSave({ unit: unit.trim() || 'Stück' })}
      />
      <NumberInput
        aria-label={`${category.name}: Standardpreis`}
        placeholder="–"
        min={0}
        value={category.defaultPrice}
        onChange={() => undefined}
        onBlur={(e) => {
          const raw = e.currentTarget.value.trim().replace(',', '.');
          const price = raw === '' ? null : Number(raw);
          if (price !== category.defaultPrice && (price === null || Number.isFinite(price)))
            onSave({ defaultPrice: price });
        }}
      />
      <Button
        variant="ghost"
        className="!p-1.5"
        aria-label={`${category.name} löschen`}
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </Button>
    </li>
  );
}
