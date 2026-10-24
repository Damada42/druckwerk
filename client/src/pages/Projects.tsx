import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
  type ProjectWithDetails,
} from '@3dapp/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, Plus, Printer as PrinterIcon, Search } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useList, useMoveProject } from '../api';
import {
  Avatar,
  Badge,
  Button,
  ColorDot,
  PageHeader,
  TextInput,
  cx,
  dateDe,
  euro,
} from '../components/ui';
import { ProjectDetail } from './ProjectDetail';

type Columns = Record<ProjectStatus, number[]>;

const COLUMN_ACCENT: Record<ProjectStatus, string> = {
  open: 'bg-stone-400',
  in_progress: 'bg-accent',
  done: 'bg-emerald-500',
};

function buildColumns(projects: ProjectWithDetails[]): Columns {
  const cols: Columns = { open: [], in_progress: [], done: [] };
  [...projects].sort((a, b) => a.position - b.position).forEach((p) => cols[p.status].push(p.id));
  return cols;
}

/** Neue Position als Mittelwert der Nachbarn, damit nur eine Karte gespeichert werden muss. */
function positionBetween(ids: number[], index: number, positionOf: (id: number) => number) {
  const prev = index > 0 ? positionOf(ids[index - 1]) : undefined;
  const next = index < ids.length - 1 ? positionOf(ids[index + 1]) : undefined;
  if (prev === undefined && next === undefined) return 1;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

export function ProjectsPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useList('projects');
  const move = useMoveProject();
  const [query, setQuery] = useState('');
  const [dragCols, setDragCols] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  // Nach dem Loslassen feuert der Browser noch einen Klick – der soll kein Detail öffnen
  const lastDragEnd = useRef(0);
  const open = (pid: number) => {
    if (Date.now() - lastDragEnd.current > 250) navigate(`/projekte/${pid}`);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? projects.filter((p) => `${p.title} ${p.description ?? ''}`.toLowerCase().includes(q))
      : projects;
  }, [projects, query]);

  const columns = dragCols ?? buildColumns(visible);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (cols: Columns, itemId: string | number): ProjectStatus | undefined => {
    if (PROJECT_STATUSES.includes(itemId as ProjectStatus)) return itemId as ProjectStatus;
    return PROJECT_STATUSES.find((s) => cols[s].includes(Number(itemId)));
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(Number(active.id));
    setDragCols(buildColumns(visible));
  };

  // Karte schon während des Ziehens in die Zielspalte übernehmen
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragCols) return;
    const from = findColumn(dragCols, active.id);
    const to = findColumn(dragCols, over.id);
    if (!from || !to || from === to) return;
    const overIndex = dragCols[to].indexOf(Number(over.id));
    const insertAt = overIndex >= 0 ? overIndex : dragCols[to].length;
    setDragCols({
      ...dragCols,
      [from]: dragCols[from].filter((x) => x !== Number(active.id)),
      [to]: [
        ...dragCols[to].slice(0, insertAt),
        Number(active.id),
        ...dragCols[to].slice(insertAt),
      ],
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const cols = dragCols;
    lastDragEnd.current = Date.now();
    setActiveId(null);
    setDragCols(null);
    if (!over || !cols) return;
    const status = findColumn(cols, active.id);
    if (!status) return;
    let ids = cols[status];
    const oldIndex = ids.indexOf(Number(active.id));
    const overIndex = ids.indexOf(Number(over.id));
    if (overIndex >= 0 && overIndex !== oldIndex) ids = arrayMove(ids, oldIndex, overIndex);
    const index = ids.indexOf(Number(active.id));
    const project = byId.get(Number(active.id))!;
    const position = positionBetween(ids, index, (pid) => byId.get(pid)!.position);
    if (project.status === status && project.position === position) return;
    // Unveränderte Reihenfolge in derselben Spalte nicht speichern
    if (project.status === status && buildColumns(visible)[status].join() === ids.join()) return;
    move.mutate({ id: project.id, status, position });
  };

  const isNew = params.get('neu') === '1';
  const openProject = id ? byId.get(Number(id)) : undefined;
  const closeDetail = () => {
    if (isNew) setParams({});
    navigate('/projekte');
  };

  const activeProject = activeId ? byId.get(activeId) : undefined;

  return (
    <>
      <PageHeader
        title="Projekte"
        subtitle="Karten zwischen den Spalten ziehen, um den Status zu ändern."
        actions={
          <>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <TextInput
                placeholder="Suchen…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-44 pl-9 sm:w-56"
              />
            </div>
            <Button variant="primary" onClick={() => setParams({ neu: '1' })}>
              <Plus size={16} /> Neues Projekt
            </Button>
          </>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted">Lade Projekte…</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDragCols(null);
          }}
        >
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
            {PROJECT_STATUSES.map((status) => (
              <Column key={status} status={status} count={columns[status].length}>
                <SortableContext items={columns[status]} strategy={verticalListSortingStrategy}>
                  {columns[status].map((pid) => {
                    const p = byId.get(pid);
                    return p ? (
                      <SortableCard key={pid} project={p} onOpen={() => open(pid)} />
                    ) : null;
                  })}
                </SortableContext>
                {status === 'open' && (
                  <button
                    type="button"
                    onClick={() => setParams({ neu: '1' })}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm text-muted hover:bg-surface hover:text-main"
                  >
                    <Plus size={15} /> Projekt hinzufügen
                  </button>
                )}
              </Column>
            ))}
          </div>
          <DragOverlay>
            {activeProject && <ProjectCard project={activeProject} dragging />}
          </DragOverlay>
        </DndContext>
      )}

      {(isNew || openProject) && <ProjectDetail project={openProject} onClose={closeDetail} />}
    </>
  );
}

function Column({
  status,
  count,
  children,
}: {
  status: ProjectStatus;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={cx(
        'flex w-[85%] shrink-0 snap-start flex-col gap-2.5 rounded-xl border border-line bg-surface-2 p-3 md:w-auto',
        isOver && 'border-accent/60',
      )}
    >
      <header className="flex items-center justify-between px-1 pb-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2.5 w-2.5 rounded-full ${COLUMN_ACCENT[status]}`} />
          {PROJECT_STATUS_LABELS[status]}
        </h2>
        <Badge>{count}</Badge>
      </header>
      <div className="flex min-h-24 flex-col gap-2.5">{children}</div>
    </section>
  );
}

function SortableCard({ project, onOpen }: { project: ProjectWithDetails; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      <ProjectCard project={project} />
    </div>
  );
}

function ProjectCard({ project, dragging }: { project: ProjectWithDetails; dragging?: boolean }) {
  const { data: customers = [] } = useList('customers');
  const { data: printers = [] } = useList('printers');
  const { data: spools = [] } = useList('spools');
  const { data: persons = [] } = useList('persons');

  const customer = customers.find((c) => c.id === project.customerId);
  const printer = printers.find((p) => p.id === project.printerId);
  const colors = project.filaments
    .map((f) => spools.find((s) => s.id === f.spoolId))
    .filter((s) => s !== undefined);
  const members = project.members
    .map((m) => persons.find((p) => p.id === m.personId))
    .filter((p) => p !== undefined);
  const overdue =
    project.dueDate &&
    project.status !== 'done' &&
    project.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <article
      className={cx(
        'cursor-grab touch-manipulation rounded-lg border border-line bg-surface p-3 shadow-sm transition select-none hover:border-accent/50',
        dragging && 'rotate-2 cursor-grabbing shadow-lg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm leading-snug font-semibold">{project.title}</h3>
        {project.priority === 'high' && (
          <Badge className="!bg-red-500/10 !text-red-600">Hoch</Badge>
        )}
      </div>
      {customer && <p className="mt-0.5 text-xs text-muted">{customer.name}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
        {printer && (
          <span className="flex items-center gap-1">
            <PrinterIcon size={13} /> {printer.name}
          </span>
        )}
        {project.dueDate && (
          <span className={cx('flex items-center gap-1', overdue && 'font-medium text-red-600')}>
            <CalendarDays size={13} /> {dateDe(project.dueDate)}
          </span>
        )}
        {project.price !== null && <span className="tabular-nums">{euro(project.price)}</span>}
      </div>

      {(colors.length > 0 || members.length > 0) && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-1">
            {colors.map((s) => (
              <ColorDot
                key={s.id}
                color={s.colorHex}
                size={12}
                title={`${s.manufacturer} ${s.colorName}`}
              />
            ))}
          </div>
          <div className="flex -space-x-1.5">
            {members.map((p) => (
              <Avatar key={p.id} name={p.name} size={22} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
