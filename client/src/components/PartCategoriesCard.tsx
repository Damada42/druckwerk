import type { PartCategory } from '@3dapp/shared';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useList, usePartCategoryOrder, useSave } from '../api';
import { Button, ErrorText, TextInput } from './ui';

/**
 * Kategorien der Ersatzteile: anlegen, umbenennen, Reihenfolge, löschen. Die Reihenfolge ist auch
 * die der Abschnitte auf der Ersatzteil-Seite.
 */
export function PartCategoriesSettings() {
  const { data: categories = [] } = useList('part-categories');
  const { data: parts = [] } = useList('spare-parts');
  const { save, remove } = useSave('part-categories');
  const order = usePartCategoryOrder();
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState('');

  const move = (index: number, by: number) => {
    const ids = categories.map((c) => c.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    order.mutate(ids);
  };
  const add = () =>
    name.trim() && save.mutate({ name: name.trim() } as never, { onSuccess: () => setName('') });
  const rename = (c: PartCategory) =>
    editing?.name.trim() &&
    save.mutate({ id: c.id, name: editing.name.trim() } as never, {
      onSuccess: () => setEditing(null),
    });
  const onDelete = (c: PartCategory) => {
    const used = parts.filter((p) => p.categoryId === c.id).length;
    const note = used ? ` ${used} Teil(e) stehen danach unter „Ohne Kategorie“.` : '';
    if (confirm(`Kategorie „${c.name}“ löschen?${note}`)) remove.mutate(c.id);
  };

  return (
    <section className="mt-4" aria-label="Ersatzteil-Kategorien">
      <h3 className="text-sm font-semibold">Ersatzteil-Kategorien</h3>
      <p className="mb-2 text-xs text-muted">
        Neue Teile bekommen ihre Kategorie aus dem Namen vorgeschlagen. Die Reihenfolge hier ist
        auch die auf der Ersatzteil-Seite.
      </p>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {categories.map((c, i) => (
          <li key={c.id} className="flex items-center gap-1 py-1 text-sm">
            {editing?.id === c.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(c);
                }}
              >
                <TextInput
                  autoFocus
                  aria-label={`${c.name} umbenennen`}
                  value={editing.name}
                  onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                />
                <Button type="submit" variant="ghost" aria-label="Übernehmen">
                  <Check size={15} />
                </Button>
                <Button variant="ghost" aria-label="Abbrechen" onClick={() => setEditing(null)}>
                  <X size={15} />
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="mr-1 text-xs text-muted tabular-nums">
                  {parts.filter((p) => p.categoryId === c.id).length || ''}
                </span>
                <Button
                  variant="ghost"
                  className="!p-1.5"
                  aria-label={`${c.name} nach oben`}
                  disabled={i === 0 || order.isPending}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={15} />
                </Button>
                <Button
                  variant="ghost"
                  className="!p-1.5"
                  aria-label={`${c.name} nach unten`}
                  disabled={i === categories.length - 1 || order.isPending}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={15} />
                </Button>
                <Button
                  variant="ghost"
                  className="!p-1.5"
                  aria-label={`${c.name} umbenennen`}
                  onClick={() => setEditing({ id: c.id, name: c.name })}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  className="!p-1.5"
                  aria-label={`${c.name} löschen`}
                  onClick={() => onDelete(c)}
                >
                  <Trash2 size={15} />
                </Button>
              </>
            )}
          </li>
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Werkzeug"
          aria-label="Neue Kategorie"
        />
        <Button type="submit" disabled={!name.trim() || save.isPending}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error ?? order.error} />
    </section>
  );
}
