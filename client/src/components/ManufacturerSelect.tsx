import { useState } from 'react';
import { useList } from '../api';
import { Button, Select, TextInput } from './ui';

const NEW = '__neu__';

/**
 * Hersteller aus der Liste wählen (Einstellungen → Hersteller), damit sich niemand vertippt. Ein
 * neuer Hersteller lässt sich direkt eintragen; der Server nimmt ihn beim Speichern in die Liste auf.
 */
export function ManufacturerSelect({
  value,
  onChange,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  const { data: manufacturers = [], isLoading } = useList('manufacturers');
  const known = manufacturers.find((m) => m.name.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(false);

  if (typing) {
    return (
      <div className="flex gap-2">
        <TextInput
          id={id}
          autoFocus
          value={value}
          placeholder="Name des Herstellers"
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" onClick={() => setTyping(false)}>
          Liste
        </Button>
      </div>
    );
  }
  return (
    <Select
      id={id}
      autoFocus={autoFocus}
      value={known?.name ?? value}
      disabled={isLoading}
      onChange={(e) => {
        if (e.target.value === NEW) {
          onChange('');
          setTyping(true);
        } else onChange(e.target.value);
      }}
    >
      {!value && <option value="">– Hersteller wählen –</option>}
      {/* Erkannt (Scan, AMS) oder bisher frei eingetragen, aber noch nicht in der Liste */}
      {value && !known && <option value={value}>{value} (neu)</option>}
      {manufacturers.map((m) => (
        <option key={m.id} value={m.name}>
          {m.name}
        </option>
      ))}
      <option value={NEW}>＋ Neuer Hersteller …</option>
    </Select>
  );
}
