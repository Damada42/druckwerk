import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useList, useSave } from '../api';
import { Button, Card, ErrorText, PageHeader, TextInput } from '../components/ui';

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Einstellungen" subtitle="Stammdaten, die in Auswahllisten auftauchen." />
      <div className="grid gap-4 lg:grid-cols-2">
        <NameList resource="filament-types" title="Filamenttypen" placeholder="z.B. PLA-CF" />
        <NameList resource="finishes" title="Art / Finish" placeholder="z.B. Seidenmatt" />
      </div>
      <Card className="mt-4 p-5 text-sm text-muted">
        <h2 className="mb-1 font-semibold text-main">Home Assistant</h2>
        Die Verbindung (Adresse + Token) wird mit der Drucker-Anbindung eingerichtet.
      </Card>
    </>
  );
}

function NameList({
  resource,
  title,
  placeholder,
}: {
  resource: 'filament-types' | 'finishes';
  title: string;
  placeholder: string;
}) {
  const { data = [] } = useList(resource);
  const { save, remove } = useSave(resource);
  const [name, setName] = useState('');

  const add = () => {
    if (!name.trim()) return;
    save.mutate({ name: name.trim() } as never, { onSuccess: () => setName('') });
  };

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {data.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
            {item.name}
            <Button
              variant="ghost"
              aria-label={`${item.name} löschen`}
              onClick={() => confirm(`„${item.name}“ löschen?`) && remove.mutate(item.id)}
            >
              <Trash2 size={15} />
            </Button>
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
          placeholder={placeholder}
        />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Card>
  );
}
