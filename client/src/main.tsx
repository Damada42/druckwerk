import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
import { CustomersPage, PersonsPage } from './pages/Contacts';
import { DashboardPage } from './pages/Dashboard';
import { FilamentPage } from './pages/Filament';
import { PrintersPage } from './pages/Printers';
import { ProjectsPage } from './pages/Projects';
import { SettingsPage } from './pages/Settings';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="projekte" element={<ProjectsPage />} />
            <Route path="projekte/:id" element={<ProjectsPage />} />
            <Route path="kunden" element={<CustomersPage />} />
            <Route path="personen" element={<PersonsPage />} />
            <Route path="filament" element={<FilamentPage />} />
            <Route path="drucker" element={<PrintersPage />} />
            <Route path="einstellungen" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
