import type {
  BarcodeLookup,
  SpoolBatchInput,
  Customer,
  DashboardStats,
  FilamentSpool,
  FilamentType,
  Finish,
  Input,
  Invoice,
  Person,
  Printer,
  ProjectStatus,
  ProjectWithDetails,
} from '@3dapp/shared';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

export class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json', ...init.headers }
        : init?.headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Fehler ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (url: string) => request<void>(url, { method: 'DELETE' }),
};

/** Ressourcen mit Standard-CRUD auf dem Server. */
export interface Resources {
  customers: Customer;
  persons: Person;
  printers: Printer;
  spools: FilamentSpool;
  'filament-types': FilamentType;
  finishes: Finish;
  projects: ProjectWithDetails;
}

export type ResourceName = keyof Resources;

export function useList<R extends ResourceName>(name: R) {
  return useQuery({ queryKey: [name], queryFn: () => api.get<Resources[R][]>(`/${name}`) });
}

/** Anlegen/Ändern/Löschen; danach werden Liste und Dashboard neu geladen. */
export function useSave<R extends ResourceName>(name: R) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [name] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };
  const save = useMutation({
    mutationFn: ({ id, ...data }: Partial<Input<Resources[R]>> & { id?: number }) =>
      id ? api.put<Resources[R]>(`/${name}/${id}`, data) : api.post<Resources[R]>(`/${name}`, data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/${name}/${id}`),
    onSuccess: invalidate,
  });
  return { save, remove };
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => api.get<DashboardStats>('/stats') });
}

export function useMoveProject() {
  const qc = useQueryClient();
  const key: QueryKey = ['projects'];
  return useMutation({
    mutationFn: ({
      id,
      status,
      position,
    }: {
      id: number;
      status: ProjectStatus;
      position: number;
    }) => api.patch<ProjectWithDetails>(`/projects/${id}/move`, { status, position }),
    // Optimistisch verschieben, damit die Karte nicht zurückspringt
    onMutate: async ({ id, status, position }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ProjectWithDetails[]>(key);
      qc.setQueryData<ProjectWithDetails[]>(key, (list) =>
        list?.map((p) => (p.id === id ? { ...p, status, position } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(key, ctx?.previous),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useInvoices(projectId: number) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['projects'] });
  const add = useMutation({
    mutationFn: (form: FormData) => api.post<Invoice>(`/projects/${projectId}/invoices`, form),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/invoices/${id}`),
    onSuccess: invalidate,
  });
  return { add, remove };
}

export function useBarcodeLookup(code: string | null) {
  return useQuery({
    queryKey: ['barcode', code],
    queryFn: () => api.get<BarcodeLookup>(`/barcodes/${encodeURIComponent(code!)}`),
    enabled: !!code,
    staleTime: 0,
  });
}

export function useSpoolBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SpoolBatchInput) => api.post<FilamentSpool[]>('/spools/batch', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spools'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['barcode'] });
    },
  });
}

export function useConsume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, grams }: { id: number; grams: number }) =>
      api.post<FilamentSpool>(`/spools/${id}/consume`, { grams }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spools'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
