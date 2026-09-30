import { expect, test, type Page } from '@playwright/test';

/** Reads the canonical document straight from the app (test-only hook). */
async function doc(page: Page) {
  return page.evaluate(() => (window as unknown as { __homePlanner: { doc: () => unknown } }).__homePlanner.doc()) as Promise<{
    walls: Array<{ length: number; status: string }>;
    rooms: Array<{ name: string; area: number }>;
    openings: number;
    items: number;
    variant: string;
  }>;
}

const IN = 25.4;

async function newEmptyProject(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-empty').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
}

async function typedRoom(page: Page, size: string) {
  const c = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.click(c.x + 300, c.y + 250);
  await page.keyboard.type('1');
  await page.getByTestId('dimension-input').fill(size);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

test('draw a room with exact dimensions, edit a length, undo/redo, 3D, persist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newEmptyProject(page);
  await typedRoom(page, `15'2" x 11'6"`);

  let d = await doc(page);
  expect(d.walls).toHaveLength(4);
  const lengths = d.walls.map((w) => w.length).sort((a, b) => a - b);
  expect(lengths[0]).toBeCloseTo(138 * IN, 6);
  expect(lengths[3]).toBeCloseTo(182 * IN, 6);
  expect(d.rooms).toHaveLength(1);

  // Click the top wall's dimension label and type a new value.
  await page.getByTestId('zoom-fit').click();
  await page.waitForTimeout(600);
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  let opened = false;
  for (let y = box.y + 40; y < box.y + box.height / 2 && !opened; y += 5) {
    await page.mouse.click(box.x + box.width / 2, y);
    opened = await page.getByTestId('dimension-popover').isVisible();
    if (!opened) await page.keyboard.press('Escape');
  }
  expect(opened).toBe(true);
  await page.getByTestId('dimension-input').fill(`15' 8"`);
  await page.getByTestId('dimension-apply').click();

  d = await doc(page);
  const long = d.walls.map((w) => w.length).sort((a, b) => b - a);
  // Both the edited wall and the opposite wall follow (connected mode keeps it rectangular).
  expect(long[0]).toBeCloseTo(188 * IN, 6);
  expect(long[1]).toBeCloseTo(188 * IN, 6);
  const areaAfter = d.rooms[0].area;

  await page.getByTestId('undo').click();
  d = await doc(page);
  expect(Math.max(...d.walls.map((w) => w.length))).toBeCloseTo(182 * IN, 6);
  await page.getByTestId('redo').click();
  d = await doc(page);
  expect(d.rooms[0].area).toBeCloseTo(areaAfter, 3);

  // 3D renders the same model.
  await page.locator('[data-testid=view-mode] button[data-v="3d"]').click();
  await expect(page.getByTestId('scene-3d').locator('canvas')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __homePlanner: { sceneMeshes: () => number } }).__homePlanner.sceneMeshes())).toBeGreaterThan(3);

  // Autosave, reload, reopen.
  await expect(page.getByTestId('save-state')).toHaveText(/Saved/, { timeout: 5000 });
  await page.reload();
  await page.getByTestId('project-card').first().click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  d = await doc(page);
  expect(Math.max(...d.walls.map((w) => w.length))).toBeCloseTo(188 * IN, 6);
  expect(errors).toEqual([]);
});

test('design option marks deleted walls for demolition and keeps the measured plan', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-sample').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  const base = await doc(page);
  expect(base.rooms.length).toBe(5);

  await page.getByTestId('variant-menu').click();
  await page.getByTestId('new-option').click();
  // Select all walls and delete: in an option this marks them "demolish".
  await page.evaluate(() => (window as unknown as { __homePlanner: { selectFirstWall: () => void } }).__homePlanner.selectFirstWall());
  await page.keyboard.press('Delete');
  const opt = await doc(page);
  expect(opt.walls.filter((w) => w.status === 'demolish')).toHaveLength(1);
  expect(opt.walls).toHaveLength(base.walls.length);

  // Measured plan unchanged.
  await page.getByTestId('variant-menu').click();
  await page.locator('.menu button', { hasText: 'Measured Plan' }).click();
  const again = await doc(page);
  expect(again.walls.every((w) => w.status === 'existing')).toBe(true);
});

test('furniture from the library: place it, then set its exact distance to a wall', async ({ page }) => {
  await newEmptyProject(page);
  await typedRoom(page, `12' x 10'`);
  await page.getByTestId('zoom-fit').click();
  await page.waitForTimeout(500);
  await page.getByTestId('tool-library').click();
  await page.getByTestId('lib-base-cabinet').click();
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const d = await doc(page);
  expect(d.items).toBe(1);
  await expect(page.locator('.inspector-head h3')).toHaveText('Base cabinet');
  // Type an exact distance to the wall behind it: it moves flush against the finished face.
  const back = page.locator('.field', { hasText: 'Back' }).locator('input');
  await back.fill('0');
  await back.press('Enter');
  await expect(back).toHaveValue('0"');
  // …and 18" from it.
  await back.fill(`1' 6"`);
  await back.press('Enter');
  await expect(back).toHaveValue(`1' 6"`);
});
