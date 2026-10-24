import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSave, type ResourceName, type Resources } from '../api';
import { Button, ErrorText, Field, Modal, Select, TextArea, TextInput } from './ui';

export interface FieldDef {
  key: string;
  label: string;
  type?:
    'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea' | 'color' | 'checkbox' | 'select';
  options?: { value: string | number; label: string }[];
  required?: boolean;
  wide?: boolean;
  placeholder?: string;
  step?: string;
}

type Values = Record<string, unknown>;

/** Generischer Anlegen/Bearbeiten-Dialog für einfache Datensätze. */
export function EntityForm<R extends ResourceName>({
  resource,
  title,
  fields,
  initial,
  defaults = {},
  onClose,
  extra,
}: {
  resource: R;
  title: string;
  fields: FieldDef[];
  initial?: Resources[R];
  defaults?: Values;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const [values, setValues] = useState<Values>(() => ({
    ...defaults,
    ...(initial as Values | undefined),
  }));
  const { save, remove } = useSave(resource);
  const id = (initial as { id?: number } | undefined)?.id;
  const missing = fields.some(
    (f) =>
      f.required && (values[f.key] === undefined || values[f.key] === null || values[f.key] === ''),
  );

  const submit = () => {
    if (missing) return;
    const data: Values = {};
    for (const f of fields) {
      const v = values[f.key];
      data[f.key] =
        (f.type === 'number' ||
          (f.type === 'select' && typeof f.options?.[0]?.value === 'number')) &&
        v !== '' &&
        v !== null &&
        v !== undefined
          ? Number(String(v).replace(',', '.'))
          : (v ?? null);
    }
    save.mutate({ ...data, id } as never, { onSuccess: onClose });
  };

  const onDelete = () => {
    if (id && confirm('Wirklich löschen?')) remove.mutate(id, { onSuccess: onClose });
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {id && (
            <Button variant="danger" className="mr-auto" onClick={onDelete}>
              <Trash2 size={16} /> Löschen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={missing || save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {fields.map((f, i) => {
          const value = values[f.key];
          const set = (v: unknown) => setValues((s) => ({ ...s, [f.key]: v }));
          const label = f.required ? `${f.label} *` : f.label;
          if (f.type === 'checkbox') {
            return (
              <label key={f.key} className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  checked={!!value}
                  onChange={(e) => set(e.target.checked)}
                />
                {f.label}
              </label>
            );
          }
          return (
            <Field
              key={f.key}
              label={label}
              className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined}
            >
              {f.type === 'textarea' ? (
                <TextArea
                  value={(value as string) ?? ''}
                  onChange={(e) => set(e.target.value)}
                  placeholder={f.placeholder}
                />
              ) : f.type === 'select' ? (
                <Select
                  value={(value as string) ?? ''}
                  onChange={(e) => set(e.target.value === '' ? null : e.target.value)}
                >
                  {!f.required && <option value="">–</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.type === 'color' ? (
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={(value as string) || '#cccccc'}
                    onChange={(e) => set(e.target.value)}
                    className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface-2 p-1"
                  />
                  <TextInput
                    value={(value as string) ?? ''}
                    onChange={(e) => set(e.target.value)}
                  />
                </div>
              ) : (
                <TextInput
                  autoFocus={i === 0}
                  type={f.type ?? 'text'}
                  step={f.step}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={(value as string | number) ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => set(e.target.value)}
                />
              )}
            </Field>
          );
        })}
        {extra && <div className="sm:col-span-2">{extra}</div>}
        <button type="submit" hidden />
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Modal>
  );
}
