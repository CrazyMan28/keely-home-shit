import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const sketch = fileURLToPath(new URL('../fixtures/measurement-sketches/synthetic-kitchen-bath.png', import.meta.url));

test('import a sketch, transcribe, surface the conflict, resolve it, build the plan', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-import').click();
  await page.getByTestId('sketch-input').setInputFiles(sketch);
  const img = page.getByTestId('sketch-viewer').locator('img');
  await expect(img).toBeVisible();
  const ib = (await img.boundingBox())!;
  const S = (x: number, y: number) => ({ x: ib.x + (x / 1000) * ib.width, y: ib.y + (y / 760) * ib.height });

  const readings: Array<[number, number, number, number, string, string]> = [
    [295, 92, 392, 132, `15' 2"`, 'E'],
    [636, 305, 730, 345, `11' 6"`, 'S'],
    [295, 532, 392, 572, `15' 4"`, 'W'],
    [15, 305, 110, 345, `11' 6"`, 'N'],
  ];
  for (const [i, [x1, y1, x2, y2, text, dir]] of readings.entries()) {
    await page.getByTestId('sketch-mode-box').click();
    const a = S(x1, y1);
    const b = S(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await page.getByTestId('annotate-value').fill(text);
    if (i === 0) await page.getByTestId('annotate-room').fill('Kitchen');
    await page.locator(`[data-testid=annotate-form] .segmented button:text-is("${dir}")`).click();
    await page.getByTestId('annotate-save').click();
  }
  await expect(page.getByTestId('obs-row')).toHaveCount(4);

  // The measurements disagree by 2": this must be reported, not silently fixed.
  await page.getByTestId('import-issues-tab').click();
  await expect(page.getByText('these measurements can’t all be true')).toBeVisible();
  await page.getByRole('button', { name: `Keep others, adjust 15' 4"` }).click();
  await expect(page.getByText('Everything adds up')).toBeVisible();

  await page.getByTestId('build-plan').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  const d = await page.evaluate(() => (window as unknown as { __homePlanner: { doc: () => { rooms: Array<{ name: string; area: number }>; walls: unknown[] } } }).__homePlanner.doc());
  expect(d.walls).toHaveLength(4);
  expect(d.rooms[0].name).toBe('Kitchen');
  // Finished interior area = 15'2" × 11'6" exactly.
  expect(d.rooms[0].area).toBeCloseTo(182 * 25.4 * 138 * 25.4, -2);
});
