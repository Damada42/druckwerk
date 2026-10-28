import {
  storageChildren,
  storageSubtree,
  storageTree,
  type FilamentSpool,
  type StorageLocation,
} from '@3dapp/shared';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useList, useSave, useSettings, useStorageOrder } from '../api';
import {
  Button,
  Card,
  ColorDot,
  Empty,
  ErrorText,
  PageHeader,
  Select,
  TextInput,
  cx,
  grams,
} from '../components/ui';

/** Was gerade bearbeitet wird: neuer Platz unter parentId oder Umbenennen */
type Editing = { kind: 'add'; parentId: number | null } | { kind: 'rename'; id: number } | null;

export function StoragePage() {
  const { data: settings } = useSettings();
  const { data: locations = [], isLoading } = useList('storage-locations');
  const { data: spools = [] } = useList('spools');
  const [editing, setEditing] = useState<Editing>(null);

  if (settings && !settings.storageLocations) {
    return (
      <>
        <PageHeader title="Lager" />
        <Empty>
          Die Lagerplatz-Verwaltung ist ausgeschaltet. Du kannst sie unter{' '}
          <Link to="/einstellungen" className="font-medium text-accent underline">
            Einstellungen
          </Link>{' '}
          einschalten.
        </Empty>
      </>
    );
  }

  const top = storageChildren(locations, null);
  const unplaced = spools.filter((s) => s.storageLocationId === null);
  const placed = spools.length - unplaced.length;

  return (
    <>
      <PageHeader
        title="Lager"
        subtitle={`${locations.length} Lagerplätze · ${placed} von ${spools.length} Spulen zugeordnet`}
        actions={
          <Button variant="primary" onClick={() => setEditing({ kind: 'add', parentId: null })}>
            <Plus size={16} /> Regal / Schrank
          </Button>
        }
      />

      {editing?.kind === 'add' && editing.parentId === null && (
        <Card className="mb-4 p-4">
          <NameForm
            parentId={null}
            placeholder="z.B. Wandregal, Schrank"
            onDone={() => setEditing(null)}
          />
        </Card>
      )}

      {!isLoading && locations.length === 0 && editing === null && (
        <Empty>
          Noch keine Lagerplätze. Lege zuerst ein Regal oder einen Schrank an und darin z.B.
          „Links“, „Rechts“ oder „Reihe 1“.
        </Empty>
      )}

      <div className="space-y-4">
        {top.map((l) => (
          <Card key={l.id} className="overflow-hidden" aria-label={`Lagerplatz ${l.name}`}>
            <ul>
              <PlaceNode
                location={l}
                depth={0}
                locations={locations}
                spools={spools}
                editing={editing}
                setEditing={setEditing}
              />
            </ul>
          </Card>
        ))}
      </div>

      {unplaced.length > 0 && locations.length > 0 && (
        <Card className="mt-6 overflow-hidden" aria-label="Ohne Lagerplatz">
          <header className="border-b border-line bg-surface-2 px-4 py-3">
            <h2 className="font-semibold">Ohne Lagerplatz</h2>
            <p className="text-xs text-muted">Hier direkt einem Platz zuordnen.</p>
          </header>
          <ul className="divide-y divide-[var(--border)]">
            {unplaced.map((s) => (
              <SpoolPlaceRow key={s.id} spool={s} locations={locations} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function PlaceNode({
  location: l,
  depth,
  locations,
  spools,
  editing,
  setEditing,
}: {
  location: StorageLocation;
  depth: number;
  locations: StorageLocation[];
  spools: FilamentSpool[];
  editing: Editing;
  setEditing: (e: Editing) => void;
}) {
  const { remove } = useSave('storage-locations');
  const order = useStorageOrder();
  const children = storageChildren(locations, l.id);
  const siblings = storageChildren(locations, l.parentId);
  const index = siblings.findIndex((s) => s.id === l.id);
  const subtree = useMemo(() => storageSubtree(locations, l.id), [locations, l.id]);
  const inside = spools.filter(
    (s) => s.storageLocationId !== null && subtree.has(s.storageLocationId),
  );
  const here = spools.filter((s) => s.storageLocationId === l.id);
  const renaming = editing?.kind === 'rename' && editing.id === l.id;
  const adding = editing?.kind === 'add' && editing.parentId === l.id;

  const move = (delta: number) => {
    const ids = siblings.map((s) => s.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    order.mutate(ids);
  };

  const onDelete = () => {
    const subs = subtree.size - 1;
    const text = [
      `„${l.name}“ löschen?`,
      subs ? `${subs} Unterplätze werden mitgelöscht.` : '',
      inside.length ? `${inside.length} Spulen verlieren ihren Lagerplatz.` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (confirm(text)) remove.mutate(l.id);
  };

  return (
    <li className={cx(depth > 0 && 'border-t border-line')}>
      <div
        className={cx(
          'flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 pr-2',
          depth === 0 && 'bg-surface-2',
        )}
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        {renaming ? (
          <div className="min-w-0 flex-1">
            <NameForm id={l.id} initial={l.name} onDone={() => setEditing(null)} />
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <span className={cx('font-medium', depth === 0 && 'text-lg font-semibold')}>
                {l.name}
              </span>
              <span className="ml-2 text-xs text-muted">
                {inside.length} {inside.length === 1 ? 'Spule' : 'Spulen'}
                {inside.length > 0 &&
                  ` · ${grams(inside.reduce((sum, s) => sum + s.weightRemainingG, 0))}`}
              </span>
            </div>
            <div className="flex">
              <IconButton
                label={`${l.name} nach oben`}
                disabled={index <= 0}
                onClick={() => move(-1)}
              >
                <ArrowUp size={15} />
              </IconButton>
              <IconButton
                label={`${l.name} nach unten`}
                disabled={index >= siblings.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown size={15} />
              </IconButton>
              <IconButton
                label={`Unterplatz in ${l.name}`}
                onClick={() => setEditing({ kind: 'add', parentId: l.id })}
              >
                <Plus size={15} />
              </IconButton>
              <IconButton
                label={`${l.name} umbenennen`}
                onClick={() => setEditing({ kind: 'rename', id: l.id })}
              >
                <Pencil size={15} />
              </IconButton>
              <IconButton label={`${l.name} löschen`} onClick={onDelete}>
                <Trash2 size={15} />
              </IconButton>
            </div>
          </>
        )}
      </div>
      <ErrorText error={remove.error ?? order.error} />

      {here.length > 0 && (
        <ul className="pb-2" style={{ paddingLeft: depth * 20 }}>
          {here.map((s) => (
            <SpoolPlaceRow key={s.id} spool={s} locations={locations} />
          ))}
        </ul>
      )}

      {adding && (
        <div className="border-t border-line py-2.5 pr-2" style={{ paddingLeft: 36 + depth * 20 }}>
          <NameForm
            parentId={l.id}
            placeholder={depth === 0 ? 'z.B. Links, Rechts, Oben' : 'z.B. Reihe 1'}
            onDone={() => setEditing(null)}
          />
        </div>
      )}

      {children.length > 0 && (
        <ul>
          {children.map((c) => (
            <PlaceNode
              key={c.id}
              location={c}
              depth={depth + 1}
              locations={locations}
              spools={spools}
              editing={editing}
              setEditing={setEditing}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function IconButton({
  label,
  ...props
}: { label: string } & Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'title'>) {
  return <Button variant="ghost" className="!p-1.5" aria-label={label} title={label} {...props} />;
}

/** Neuen Platz anlegen (parentId) oder bestehenden umbenennen (id) */
function NameForm({
  id,
  parentId = null,
  initial = '',
  placeholder,
  onDone,
}: {
  id?: number;
  parentId?: number | null;
  initial?: string;
  placeholder?: string;
  onDone: () => void;
}) {
  const { save } = useSave('storage-locations');
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim())
          save.mutate(
            id ? { id, name: name.trim() } : { name: name.trim(), parentId },
            // Beim Anlegen offen lassen, damit Reihe 1, 2, 3 … schnell hintereinander gehen
            { onSuccess: () => (id ? onDone() : setName('')) },
          );
      }}
    >
      <TextInput
        className="min-w-40 flex-1"
        aria-label="Name des Lagerplatzes"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        autoFocus
      />
      <Button type="submit" variant="primary" disabled={!name.trim() || save.isPending}>
        <Check size={16} /> {id ? 'Speichern' : 'Anlegen'}
      </Button>
      <Button onClick={onDone} aria-label="Fertig">
        <X size={16} />
      </Button>
      <ErrorText error={save.error} />
    </form>
  );
}

/** Spule mit Auswahl des Lagerplatzes */
function SpoolPlaceRow({
  spool: s,
  locations,
}: {
  spool: FilamentSpool;
  locations: StorageLocation[];
}) {
  const { data: types = [] } = useList('filament-types');
  const { save } = useSave('spools');
  const type = types.find((t) => t.id === s.typeId)?.name;
  const label = `${type ?? ''} ${s.manufacturer} ${s.colorName}`.trim();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm">
      <ColorDot color={s.colorHex} size={18} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{label}</div>
        <div className="text-xs text-muted">
          {grams(s.weightRemainingG)} übrig
          {s.haTrayEntity && ' · gerade am Drucker'}
          {!s.storageLocationId && s.location && ` · bisher: ${s.location}`}
        </div>
      </div>
      <StorageSelect
        className="w-full sm:w-64"
        aria-label={`Lagerplatz für ${label}`}
        locations={locations}
        value={s.storageLocationId}
        onChange={(storageLocationId) => save.mutate({ id: s.id, storageLocationId })}
      />
      <ErrorText error={save.error} />
    </li>
  );
}

/** Auswahl eines Lagerplatzes mit vollem Pfad, eingerückt nach Ebene */
export function StorageSelect({
  locations,
  value,
  onChange,
  className,
  ...rest
}: {
  locations: StorageLocation[];
  value: number | null;
  onChange: (id: number | null) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <Select
      {...rest}
      className={className}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">– kein Lagerplatz –</option>
      {storageTree(locations).map(({ location, path }) => (
        <option key={location.id} value={location.id}>
          {path}
        </option>
      ))}
    </Select>
  );
}
