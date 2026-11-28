import { test, expect } from '@playwright/test';

test.describe('FleetGrid browser and API integration', () => {
  test('public landing routes visitors to the real sign-in and registration forms', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('requestfailed', request => failedRequests.push(request.url()));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Move freight/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create your account', exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Shipper sign in', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Sign in to Shipper' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    await page.getByLabel('Email address').fill('unknown@example.test');
    await page.getByLabel('Password').fill('incorrect-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    expect(failedRequests.filter(url => url.includes('/auth/login'))).toHaveLength(0);

    await page.getByRole('button', { name: /Back to FleetGrid/i }).click();
    await page.getByRole('button', { name: 'Create your account', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Create your FleetGrid account' })).toBeVisible();
  });

  test('registration switches roles and fails closed when email delivery is not configured', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create your account', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Create your FleetGrid account' })).toBeVisible();

    await page.getByRole('button', { name: 'Driver / Fleet Operator' }).click();
    const addTruck = page.getByRole('checkbox', { name: /Add my truck now/i });
    await expect(addTruck).toBeChecked();
    await expect(page.getByLabel('Registration no.')).toBeVisible();
    await addTruck.uncheck();
    await expect(page.getByLabel('Registration no.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Business / Shipper' }).click();
    await page.getByLabel('Full name').fill('Integration Test Shipper');
    await page.getByLabel('Email address').fill('integration-shipper@example.test');
    await page.getByLabel('Password').fill('FleetGrid-Test-Password-2026');
    await page.getByLabel('Phone number').fill('+919876543210');
    await page.getByRole('button', { name: 'Create Business account' }).click();

    await expect(page.getByText(/Email verification is not available yet/i)).toBeVisible();
  });

  test('verification links require an explicit button action', async ({ page }) => {
    await page.goto('/?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(page.getByRole('heading', { name: 'Sign in to FleetGrid' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify email' })).toBeVisible();
    await expect(page.getByText(/verification link is ready/i)).toBeVisible();

    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByText(/invalid|expired|verification token/i)).toBeVisible();
  });

  test('mobile navigation exposes role-specific sign-in portals', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Driver sign in', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Sign in to Driver' })).toBeVisible();
    await expect(page.getByText(/only authorised Admin/i)).toHaveCount(0);
  });
});

test('payments are not exposed from the public landing page before authentication', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Move freight/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FleetGrid Payments Hub' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Administrator sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Admin / Operations' })).toBeVisible();
  await expect(page.getByText(/only authorised Admin \/ Operations accounts/i)).toBeVisible();
});

test('public portal entry points keep shipper, driver and administrator sign-ins distinct', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrator sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Admin / Operations' })).toBeVisible();
  await expect(page.getByText(/only authorised Admin \/ Operations accounts/i)).toBeVisible();

  await page.getByRole('button', { name: /Back to FleetGrid/i }).click();
  await page.getByRole('button', { name: 'Driver sign in', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in to Driver' })).toBeVisible();

  await page.getByRole('button', { name: /Back to FleetGrid/i }).click();
  await page.getByRole('button', { name: 'Shipper sign in', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in to Shipper' })).toBeVisible();
});
