import { SMALL_BUSINESS_NOTE, type CompanyProfile } from '@3dapp/shared';
import { Building2, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useCompany, useCompanySave } from '../api';
import { appUrl } from '../base';
import { Button, Card, ErrorText, Field, TextArea, TextInput } from './ui';

/** Längste Seite des Logos in Pixeln – reicht für den Druck in 6 cm Breite */
const LOGO_PX = 1200;

/**
 * Wandelt jedes Bild, das der Browser anzeigen kann (PNG, JPEG, SVG, WebP, GIF …), in ein PNG um.
 * Transparenz bleibt erhalten; Vektorlogos werden scharf auf LOGO_PX gerastert.
 */
export async function logoToPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 600;
    const h = img.naturalHeight || 300;
    const svg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    const scale = svg ? LOGO_PX / Math.max(w, h) : Math.min(1, LOGO_PX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild nicht lesbar'))), 'image/png'),
    );
  } catch {
    throw new Error('Dieses Bild kann der Browser nicht öffnen. Bitte PNG, JPEG oder SVG wählen.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CompanyCard() {
  const { data: company } = useCompany();
  return (
    <Card className="mt-4 p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Building2 size={18} /> Firmendaten für Angebote & Rechnungen
      </h2>
      <p className="mb-4 text-sm text-muted">
        Stehen im Kopf und in der Fußzeile jedes Angebots und jeder Rechnung. Schon erstellte
        Dokumente bleiben unverändert.
      </p>

      {company && <CompanyForm company={company} />}
    </Card>
  );
}

function CompanyForm({ company }: { company: CompanyProfile }) {
  const { save, logo } = useCompanySave();
  // Logo kommt immer frisch vom Server, die übrigen Felder aus dem Formular
  const logoPath = useCompany().data?.logoPath ?? null;
  const [form, setForm] = useState(company);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const text = (key: keyof CompanyProfile, label: string, placeholder?: string) => (
    <Field label={label}>
      <TextInput
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  );
  const days = (key: 'paymentDays' | 'offerValidDays' | 'vatRate', label: string) => (
    <Field label={label}>
      <TextInput
        inputMode="numeric"
        value={String(form[key])}
        onChange={(e) => set(key, Number(e.target.value.replace(',', '.')) || 0)}
      />
    </Field>
  );

  const pickLogo = async (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    try {
      logo.mutate(await logoToPng(file));
    } catch (e) {
      setLogoError((e as Error).message);
    }
  };

  const { logoPath: _logo, ...body } = form;

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      aria-label="Firmendaten"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(body, { onSuccess: () => setSaved(true) });
      }}
    >
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-dashed border-line bg-white p-2">
          {logoPath ? (
            <img src={appUrl(logoPath)} alt="Logo" className="max-h-full max-w-full" />
          ) : (
            <span className="text-xs text-neutral-500">Kein Logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button onClick={() => fileRef.current?.click()} disabled={logo.isPending}>
              <ImagePlus size={16} /> {logoPath ? 'Logo ändern' : 'Logo wählen'}
            </Button>
            {logoPath && (
              <Button variant="ghost" aria-label="Logo entfernen" onClick={() => logo.mutate(null)}>
                <Trash2 size={16} />
              </Button>
            )}
          </div>
          <p className="max-w-xs text-xs text-muted">
            Am besten PNG mit transparentem Hintergrund oder SVG. Andere Bildformate werden
            automatisch umgewandelt.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.svg"
          hidden
          data-testid="logo-file"
          onChange={(e) => {
            pickLogo(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="w-full">
          <ErrorText error={logoError ?? logo.error} />
        </div>
      </div>

      {text('name', 'Name / Firma', 'z.B. 3D-Druck Muster')}
      {text('email', 'E-Mail')}
      <Field label="Adresse" className="sm:row-span-2">
        <TextArea
          rows={4}
          value={form.address}
          placeholder={'Straße 1\n1234 Ort\nÖsterreich'}
          onChange={(e) => set('address', e.target.value)}
        />
      </Field>
      {text('phone', 'Telefon')}
      {text('website', 'Website')}
      {text('vatId', 'UID-Nummer (falls vorhanden)', 'ATU12345678')}
      {text('bank', 'Bank')}
      {text('iban', 'IBAN')}
      {text('bic', 'BIC')}
      {days('paymentDays', 'Zahlungsziel Rechnung (Tage)')}
      {days('offerValidDays', 'Angebot gültig (Tage)')}

      <label className="flex items-start gap-3 text-sm sm:col-span-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          checked={form.smallBusiness}
          onChange={(e) => set('smallBusiness', e.target.checked)}
        />
        <span>
          <span className="font-medium">Kleinunternehmer</span>
          <span className="block text-muted">
            Ohne Umsatzsteuer; auf jedem Angebot und jeder Rechnung steht „{SMALL_BUSINESS_NOTE}“.
          </span>
        </span>
      </label>
      {!form.smallBusiness && days('vatRate', 'Umsatzsteuer (%)')}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Firmendaten speichern
        </Button>
        {saved && <span className="text-sm text-emerald-600">Gespeichert</span>}
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}
