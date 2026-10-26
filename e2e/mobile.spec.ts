import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('Handy: untere Navigation statt Seitenleiste', async ({ page }) => {
  await page.goto('/');
  const bottomNav = page.locator('nav').last();
  await expect(bottomNav).toBeVisible();
  await expect(page.locator('aside')).toBeHidden();
  await expectNoHorizontalScroll(page);

  for (const [label, heading] of [
    ['Projekte', 'Projekte'],
    ['Kunden', 'Kunden'],
    ['Filament', 'Filament'],
    ['Drucker', 'Drucker'],
    ['Übersicht', 'Übersicht'],
  ]) {
    await bottomNav.getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('Handy: Projekt-Dialog passt auf den Bildschirm', async ({ page }) => {
  await page.goto('/projekte');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
});

test('Handy: Karte per Finger von „In Arbeit“ nach „Erledigt“ ziehen', async ({
  page,
  request,
}) => {
  const res = await request.post('/api/projects', {
    data: { title: 'Touch-Umzug', status: 'in_progress' },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: number };

  await page.goto('/projekte');
  const card = page.getByRole('heading', { name: 'Touch-Umzug' });
  // Wie am Handy: zur Spalte „In Arbeit“ wischen
  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'In Arbeit' }) })
    .evaluate((el) => el.scrollIntoView({ inline: 'start', behavior: 'instant' }));
  const box = (await card.boundingBox())!;
  const viewport = page.viewportSize()!;

  // Echte Touch-Ereignisse wie am Handy: lange drücken, dann zur rechten Kante wischen
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: x === undefined ? [] : [{ x, y: y! }],
    } as Parameters<typeof cdp.send<'Input.dispatchTouchEvent'>>[1]);
  let x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await touch('touchStart', x, y);
  await page.waitForTimeout(400);
  const edge = viewport.width - 8;
  while (x < edge) {
    x = Math.min(edge, x + 15);
    await touch('touchMove', x, y);
    await page.waitForTimeout(16);
  }
  // An der Kante halten, bis die Spalte „Erledigt“ hereingescrollt ist
  const done = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Erledigt' }) });
  await expect
    .poll(async () => (await done.boundingBox())!.x, { timeout: 5_000 })
    .toBeLessThan(viewport.width / 2);
  const target = (await done.boundingBox())!;
  await touch('touchMove', target.x + target.width / 2, target.y + 80);
  await page.waitForTimeout(100);
  await touch('touchMove', target.x + target.width / 2 + 2, target.y + 82);

  // Langsame Server-Antwort: Die Karte darf in keinem Bild zur alten Spalte zurückspringen
  await page.route('**/move', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  const watch = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const working = [...document.querySelectorAll('section')].find((s) =>
          s.querySelector('h2')?.textContent?.includes('In Arbeit'),
        )!;
        let backInOldColumn = 0;
        let frames = 0;
        const check = () => {
          if (working.textContent?.includes('Touch-Umzug')) backInOldColumn++;
          if (++frames < 60) requestAnimationFrame(check);
          else resolve(backInOldColumn);
        };
        requestAnimationFrame(check);
      }),
  );
  await touch('touchEnd');
  expect(await watch).toBe(0);

  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/projects/${id}`)).json()) as { status: string }).status,
    )
    .toBe('done');
});
