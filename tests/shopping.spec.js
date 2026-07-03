// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Type in search and click the first suggestion that matches the given name
async function pickProduct(page, name) {
  await page.click('#tab-add');
  await page.fill('#add-input', name);
  await page.locator('.sugg-item').filter({ hasText: name }).first().click();
  await page.click('.btn-confirm.primary');
}

// ── Empty state ───────────────────────────────────────────────────────────────

test('shows empty state when list is empty', async ({ page }) => {
  await page.click('#tab-list');
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.empty-title')).toHaveText('הסל ריק');
});

// ── Search & suggestions ──────────────────────────────────────────────────────

test('suggestions appear while typing', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצ');
  await expect(page.locator('.suggestions')).not.toHaveClass(/hidden/);
  await expect(page.locator('.sugg-item').first()).toBeVisible();
});

test('suggestions hidden when input is cleared', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצ');
  await page.fill('#add-input', '');
  await expect(page.locator('.suggestions')).toHaveClass(/hidden/);
});

test('suggestions show category label', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצים');
  await expect(page.locator('.sugg-cat').first()).toBeVisible();
});

test('custom-product option shown when search has no exact match', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'מוצר לא קיים בDB');
  await expect(page.locator('.sugg-custom')).toBeVisible();
});

// ── Adding products ───────────────────────────────────────────────────────────

test('clicking suggestion adds product to list', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצים');
  await page.locator('.sugg-item').first().click();
  await page.click('.btn-confirm.primary');
  await expect(page.locator('.item-name')).toHaveText('ביצים');
});

test('input is cleared after selecting suggestion', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await expect(page.locator('#add-input')).toHaveValue('');
});

test('suggestions hidden after selecting product', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצים');
  await page.locator('.sugg-item').first().click();
  await expect(page.locator('.suggestions')).toHaveClass(/hidden/);
});

test('pressing Enter selects first suggestion', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצים');
  await expect(page.locator('.sugg-item').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.click('.btn-confirm.primary');
  await expect(page.locator('.item-name')).toContainText('ביצים');
});

test('adding same product twice increments quantity', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await pickProduct(page, 'ביצים');
  await expect(page.locator('.item')).toHaveCount(1);
  await expect(page.locator('.item-qty-badge')).toHaveText('×2');
});

test('can add multiple different products', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await pickProduct(page, 'חלב 3%');
  await pickProduct(page, 'לחם פרוס');
  await expect(page.locator('.item')).toHaveCount(3);
});

test('custom product added via "הוסף" option', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'מוצר מיוחד');
  await page.locator('.sugg-custom').click();
  await page.click('.btn-confirm.primary');
  await expect(page.locator('.item-name')).toHaveText('מוצר מיוחד');
});

// ── Keyboard navigation ───────────────────────────────────────────────────────

test('ArrowDown highlights first suggestion', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצ');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.sugg-item.highlighted, .sugg-custom.highlighted').first()).toBeVisible();
});

test('Escape closes suggestions', async ({ page }) => {
  await page.click('#tab-add');
  await page.fill('#add-input', 'ביצ');
  await expect(page.locator('.suggestions')).not.toHaveClass(/hidden/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.suggestions')).toHaveClass(/hidden/);
});

// ── Quantity controls ─────────────────────────────────────────────────────────

test('+ button increments quantity', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.qty-btn.plus');
  await expect(page.locator('.qty-num')).toHaveText('×2');
});

test('- button decrements quantity', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.qty-btn.plus'); // → 2
  await page.click('.qty-btn.minus'); // → 1
  await expect(page.locator('.qty-num')).toHaveText('×1');
});

test('- button at qty=1 removes the item', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.qty-btn.minus');
  await expect(page.locator('.item')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});

// ── Check / uncheck ───────────────────────────────────────────────────────────
// Checking items off is only available in edit mode ("✏️ עריכה").

test('checkbox marks item as checked', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.item-check');
  await expect(page.locator('.item')).toHaveClass(/checked/);
});

test('clicking checked item un-checks it', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.item-check');
  await page.click('.item-check');
  await expect(page.locator('.item')).not.toHaveClass(/checked/);
});

// ── Delete ────────────────────────────────────────────────────────────────────

test('delete button removes item', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.item-del');
  await expect(page.locator('.item')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});

// ── Progress bar & summary ────────────────────────────────────────────────────

test('progress bar fills as items are checked', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await pickProduct(page, 'חלב 3%');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await expect(page.locator('.progress-fill')).toHaveAttribute('style', /width:0%/);
  await page.locator('.item-check').first().click();
  await expect(page.locator('.progress-fill')).toHaveAttribute('style', /width:50%/);
});

test('"clear checked" button count updates when item is checked', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await pickProduct(page, 'חלב 3%');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.locator('.item-check').first().click();
  await expect(page.locator('.btn-sm:not(.danger)')).toContainText('מחק מסומנים (1)');
});

// ── Clear actions ─────────────────────────────────────────────────────────────
// Bulk-clear controls live in the bottom bar, shown only in edit mode.

test('clear all removes all items after modal confirmation', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await pickProduct(page, 'חלב 3%');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.btn-clear-all');
  await page.click('#modal-ok');
  await expect(page.locator('.item')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});

test('cancel in modal keeps items', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.btn-clear-all');
  await page.click('.btn-s');
  await expect(page.locator('.item')).toHaveCount(1);
});

test('clear checked removes only checked items', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await pickProduct(page, 'חלב 3%');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.locator('.item-check').first().click();
  await page.locator('.btn-sm:not(.danger)').click();
  await page.click('#modal-ok');
  await expect(page.locator('.item')).toHaveCount(1);
});

// ── Category grouping ─────────────────────────────────────────────────────────

test('products from DB appear grouped under correct category', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  // Category label "מוצרי חלב וביצים" should appear in the list
  await expect(page.locator('#list-container')).toContainText('מוצרי חלב וביצים');
});

// ── Persistence ───────────────────────────────────────────────────────────────

test('items persist across page reload', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.qty-btn.plus'); // qty → 2
  await page.click('.btn-edit'); // exit edit mode
  await page.reload();
  await page.click('#tab-list');
  await expect(page.locator('.item-name')).toHaveText('ביצים');
  await expect(page.locator('.item-qty-badge')).toHaveText('×2');
});

test('checked state persists across page reload', async ({ page }) => {
  await pickProduct(page, 'ביצים');
  await page.click('#tab-list');
  await page.click('.btn-edit');
  await page.click('.item-check');
  await page.reload();
  await page.click('#tab-list');
  await expect(page.locator('.item')).toHaveClass(/checked/);
});
