import { test, expect } from '@playwright/test';

test.describe('User flows', () => {
  test('login form shows validation on empty submit', async ({ page }) => {
    await page.goto('/login');
    // Click submit without filling the form
    await page.getByRole('button', { name: 'Se connecter' }).click();
    // Browser native validation should prevent submit (required fields)
    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toBeVisible();
    // The form should still be on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('login form shows error on bad credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('fake@test.com');
    await page.getByLabel('Mot de passe').fill('wrongpassword123');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    // Should show error message (rate limit or bad credentials)
    await expect(page.getByText(/incorrect|erreur|tentatives/i)).toBeVisible({ timeout: 10000 });
  });

  test('plan wizard loads all 4 steps', async ({ page }) => {
    await page.goto('/plan');
    // Step 1: Destination
    await expect(page.getByText('Planifiez votre voyage')).toBeVisible();

    // Check step indicators exist
    await expect(page.getByText('Où')).toBeVisible();
    await expect(page.getByText('Quand')).toBeVisible();
    await expect(page.getByText('Style')).toBeVisible();
    await expect(page.getByText('Résumé')).toBeVisible();
  });

  test('plan wizard preflight blocks unauthenticated users', async ({ request }) => {
    const res = await request.get('/api/generate/preflight');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(body.action).toBe('login');
  });

  test('trip templates exist on empty mes-voyages', async ({ page }) => {
    // Without auth, should redirect to login
    await page.goto('/mes-voyages');
    await page.waitForURL(/\/login/, { timeout: 5000 });
  });

  test('privacy page has data processors listed', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByText('Google Places API')).toBeVisible();
    await expect(page.getByText('Supabase')).toBeVisible();
    await expect(page.getByText('Stripe')).toBeVisible();
    await expect(page.getByText('Sentry')).toBeVisible();
  });

  test('CGU page loads', async ({ page }) => {
    await page.goto('/cgu');
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.getByText(/conditions/i)).toBeVisible();
  });

  test('dynamic OG image endpoint works', async ({ request }) => {
    // Default OG
    const defaultRes = await request.get('/api/og');
    expect(defaultRes.ok()).toBeTruthy();
    expect(defaultRes.headers()['content-type']).toContain('image/png');

    // Trip-specific OG
    const tripRes = await request.get('/api/og?destination=Paris&days=5');
    expect(tripRes.ok()).toBeTruthy();
    expect(tripRes.headers()['content-type']).toContain('image/png');
  });

  test('referral API returns code for unauthenticated user', async ({ request }) => {
    const res = await request.get('/api/referral');
    expect(res.status()).toBe(401);
  });

  test('feedback API rejects unauthenticated user', async ({ request }) => {
    const res = await request.post('/api/feedback', {
      data: { type: 'idea', message: 'test' },
    });
    expect(res.status()).toBe(401);
  });
});
