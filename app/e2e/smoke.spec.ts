import { test, expect } from '@playwright/test';

async function dismissCookieBanner(page: Parameters<typeof test>[0]['page']) {
  const refuseButton = page.getByRole('button', { name: 'Refuser' });
  await refuseButton.waitFor({ state: 'visible', timeout: 1500 }).catch(() => null);
  if (await refuseButton.isVisible().catch(() => false)) {
    await refuseButton.click();
    await expect(refuseButton).toBeHidden();
  }
}

test.describe('Smoke tests — public pages load', () => {
  test('homepage loads with key elements', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Narae/);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await dismissCookieBanner(page);
    await expect(page.getByText('Continuer avec Google')).toBeVisible();
    await expect(page.getByText('Continuer avec Apple')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('register page loads', async ({ page }) => {
    await page.goto('/register');
    await dismissCookieBanner(page);
    await expect(page.getByRole('heading', { name: 'Rejoindre Narae' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer mon compte' })).toBeVisible();
  });

  test('explore page loads', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('pricing page loads', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('health ping returns ok', async ({ request }) => {
    const res = await request.get('/api/health/ping');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });
});
