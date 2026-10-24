import type { Customer, Person } from '@3dapp/shared';
import { Mail, Phone, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useList } from '../api';
import { EntityForm, type FieldDef } from '../components/EntityForm';
import { Avatar, Button, Card, Empty, PageHeader, TextInput } from '../components/ui';

const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'company', label: 'Firma' },
  { key: 'email', label: 'E-Mail', type: 'email' },
  { key: 'phone', label: 'Telefon', type: 'tel' },
  { key: 'address', label: 'Adresse', type: 'textarea' },
  { key: 'notes', label: 'Notizen', type: 'textarea' },
];

const PERSON_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'contact', label: 'Kontakt (Telefon / E-Mail)' },
  {
    key: 'notes',
    label: 'Notizen / Fähigkeiten',
    type: 'textarea',
    placeholder: 'z.B. Elektronik, Lackieren',
  },
];

function useSearch<T extends { name: string }>(items: T[], extra: (t: T) => string) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((i) => `${i.name} ${extra(i)}`.toLowerCase().includes(q))
    : items;
  return { query, setQuery, filtered };
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
      />
      <TextInput
        placeholder="Suchen…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-44 pl-9 sm:w-56"
      />
    </div>
  );
}

export function CustomersPage() {
  const { data: customers = [], isLoading } = useList('customers');
  const { data: projects = [] } = useList('projects');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const { query, setQuery, filtered } = useSearch(
    customers,
    (c) => `${c.company ?? ''} ${c.email ?? ''}`,
  );

  return (
    <>
      <PageHeader
        title="Kunden"
        subtitle={`${customers.length} Kunden`}
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} />
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Kunde
            </Button>
          </>
        }
      />
      {!isLoading && customers.length === 0 && <Empty>Noch keine Kunden angelegt.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => {
          const own = projects.filter((p) => p.customerId === c.id);
          return (
            <Card
              key={c.id}
              className="cursor-pointer p-4 transition hover:border-accent/60"
              onClick={() => setEditing(c)}
            >
              <div className="flex items-center gap-3">
                <Avatar name={c.name} size={36} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.name}</div>
                  {c.company && <div className="truncate text-xs text-muted">{c.company}</div>}
                </div>
              </div>
              <div className="mt-3 space-y-1 text-sm text-muted">
                {c.email && (
                  <div className="flex items-center gap-2 truncate">
                    <Mail size={14} /> {c.email}
                  </div>
                )}
                {c.phone && (
                  <div className="flex items-center gap-2">
                    <Phone size={14} /> {c.phone}
                  </div>
                )}
              </div>
              {own.length > 0 && (
                <div
                  className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {own.map((p) => (
                    <Link
                      key={p.id}
                      to={`/projekte/${p.id}`}
                      className="rounded-md bg-surface-2 px-2 py-0.5 text-xs hover:text-accent"
                    >
                      {p.title}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {editing && (
        <EntityForm
          resource="customers"
          title={editing === 'new' ? 'Neuer Kunde' : editing.name}
          fields={CUSTOMER_FIELDS}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function PersonsPage() {
  const { data: persons = [], isLoading } = useList('persons');
  const { data: projects = [] } = useList('projects');
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const { query, setQuery, filtered } = useSearch(persons, (p) => p.notes ?? '');

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Personen, die bei Projekten helfen oder unterstützen."
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} />
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Person
            </Button>
          </>
        }
      />
      {!isLoading && persons.length === 0 && <Empty>Noch keine Personen angelegt.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => {
          const involved = projects.filter((pr) => pr.members.some((m) => m.personId === p.id));
          return (
            <Card
              key={p.id}
              className="cursor-pointer p-4 transition hover:border-accent/60"
              onClick={() => setEditing(p)}
            >
              <div className="flex items-center gap-3">
                <Avatar name={p.name} size={36} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  {p.contact && <div className="truncate text-xs text-muted">{p.contact}</div>}
                </div>
              </div>
              {p.notes && <p className="mt-3 line-clamp-2 text-sm text-muted">{p.notes}</p>}
              <p className="mt-3 text-xs text-muted">
                {involved.length === 0
                  ? 'In keinem Projekt'
                  : `In ${involved.length} Projekt${involved.length > 1 ? 'en' : ''}`}
              </p>
            </Card>
          );
        })}
      </div>
      {editing && (
        <EntityForm
          resource="persons"
          title={editing === 'new' ? 'Neue Person' : editing.name}
          fields={PERSON_FIELDS}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
