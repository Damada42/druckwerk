import { storagePaths, type FilamentSpool } from '@3dapp/shared';
import { useMemo } from 'react';
import { useList, useSettings, useSlotPlaces } from '../api';

/**
 * Wo eine Spule hingehört und wo sie gerade steckt:
 * `storage` = Lagerplatz (bzw. Freitext-Ort ohne Lagerplatz-Verwaltung),
 * `inUse` = Drucker und Slot, wenn sie einem AMS-Slot zugeordnet ist.
 */
export function useSpoolPlace() {
  const { data: settings } = useSettings();
  const { data: locations = [] } = useList('storage-locations');
  const { data: spools = [] } = useList('spools');
  const { data: slots = {} } = useSlotPlaces(spools.some((s) => s.haTrayEntity));
  const paths = useMemo(() => storagePaths(locations), [locations]);

  const storage = (s: FilamentSpool): string | undefined =>
    settings?.storageLocations
      ? s.storageLocationId !== null
        ? paths.get(s.storageLocationId)
        : undefined
      : s.location?.trim() || undefined;

  const inUse = (s: FilamentSpool, withPrinter = true): string | undefined => {
    if (!s.haTrayEntity) return undefined;
    const place = slots[s.haTrayEntity];
    if (!place) return 'am Drucker';
    return withPrinter ? `${place.printerName} · ${place.slotLabel}` : place.slotLabel;
  };

  return { storage, inUse, slots };
}
