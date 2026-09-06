import { clerkSecretKey } from './clerk-config.js';
import { createClerkClient } from '@clerk/backend';

export const CLICKUP_CREATOR_LIST_ID = process.env.CLICKUP_CREATOR_LIST_ID || '901111110302';
export const CLICKUP_CREATOR_VIEW_ID = process.env.CLICKUP_CREATOR_VIEW_ID || '6-901111110302-1';

function keyMode(value, livePrefix, testPrefix) {
  if ((value || '').startsWith(livePrefix)) return 'live';
  if ((value || '').startsWith(testPrefix)) return 'test';
  return value ? 'unknown' : 'missing';
}

function safeMessage(error) {
  return (error?.message || 'Connection failed').toString().replace(/\s+/g, ' ').slice(0, 240);
}

export function getIntegrationHealth() {
  const publishableMode = keyMode(process.env.VITE_CLERK_PUBLISHABLE_KEY, 'pk_live_', 'pk_test_');
  const secretMode = keyMode(clerkSecretKey(), 'sk_live_', 'sk_test_');
  const clerkConfigured = publishableMode === secretMode && ['live', 'test'].includes(secretMode);
  const clerkReady = clerkConfigured && secretMode === 'live';
  const clickupToken = Boolean(process.env.CLICKUP_API_TOKEN);
  const clickupList = Boolean(CLICKUP_CREATOR_LIST_ID);

  return {
    clerk: {
      ready: clerkReady,
      state: clerkReady ? 'ready' : clerkConfigured ? 'warning' : 'error',
      label: 'Clerk production',
      detail: clerkReady
        ? 'Live authentication keys are active.'
        : clerkConfigured
          ? 'Authentication works, but production is using Clerk test-mode keys.'
          : 'Clerk publishable and secret keys are missing, invalid, or from different modes.',
      action: clerkReady
        ? null
        : 'Use the Clerk production instance, then update both keys in Vercel Production.',
      env: ['CLERK_SECRET_KEY', 'VITE_CLERK_PUBLISHABLE_KEY'],
      mode: clerkConfigured ? secretMode : 'misconfigured',
    },
    clickup: {
      ready: clickupToken && clickupList,
      state: clickupToken && clickupList ? 'ready' : (clickupToken || clickupList) ? 'warning' : 'setup',
      label: 'ClickUp intake',
      detail: clickupToken && clickupList
        ? 'Direct applicant sync is configured.'
        : clickupToken || clickupList
          ? 'ClickUp is partially configured.'
          : 'CSV import works; direct applicant sync is not configured.',
      action: clickupToken && clickupList
        ? null
        : 'Add the ClickUp personal API token and applicant list ID to Vercel Production.',
      env: ['CLICKUP_API_TOKEN', 'CLICKUP_CREATOR_LIST_ID', 'CLICKUP_CREATOR_VIEW_ID'],
    },
    gmail: {
      ready: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      state: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ? 'ready' : 'warning'
        : 'setup',
      label: 'Gmail outreach',
      detail: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
          ? 'Per-user Google credentials are encrypted with a dedicated key.'
          : 'Per-user credentials are encrypted using existing application secrets. Add a dedicated encryption key before rotating Clerk or Google secrets.'
        : 'Google OAuth credentials are missing.',
      action: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
        ? 'Add GOOGLE_TOKEN_ENCRYPTION_KEY to Vercel Production, then have connected users reconnect once.'
        : null,
      env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY'],
    },
    instagram: {
      ready: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID),
      state: process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID ? 'ready' : 'setup',
      label: 'Instagram metrics',
      detail: process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID
        ? 'Business Discovery refresh is available.'
        : 'Meta token or Page ID is missing.',
      env: ['META_ACCESS_TOKEN', 'META_PAGE_ID'],
    },
    shopify: {
      ready: Boolean(
        (process.env.SHOPIFY_ACCESS_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET))
        && process.env.SHOPIFY_SEEDING_ACCESS_TOKEN
        && process.env.SHOPIFY_SEEDING_ENABLED === 'true'
      ),
      state: (process.env.SHOPIFY_ACCESS_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET))
        && process.env.SHOPIFY_SEEDING_ACCESS_TOKEN
        && process.env.SHOPIFY_SEEDING_ENABLED === 'true' ? 'ready' : 'setup',
      label: 'Shopify creator seeding',
      detail: process.env.SHOPIFY_SEEDING_ENABLED === 'true'
        ? 'Creator seeding is enabled with a separate least-privilege Shopify token.'
        : 'Catalog sync is read-only. Creator order creation is disabled by the Shopify safety switch.',
      action: 'Use a separate token limited to draft orders, then enable the seeding safety switch only when ready.',
      env: [
        'SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_SEEDING_ACCESS_TOKEN',
        'SHOPIFY_SEEDING_ENABLED', 'SHOPIFY_SEEDING_MAX_QUANTITY', 'SHOPIFY_SEEDING_DAILY_LIMIT',
      ],
    },
  };
}

export async function testIntegrationHealth() {
  const integrations = getIntegrationHealth();

  if (clerkSecretKey()) {
    try {
      const clerk = createClerkClient({ secretKey: clerkSecretKey() });
      const result = await clerk.users.getUserList({ limit: 1 });
      integrations.clerk.checked = true;
      integrations.clerk.reachable = true;
      integrations.clerk.account_count = Number(result.totalCount || result.data?.length || 0);
    } catch (error) {
      integrations.clerk.checked = true;
      integrations.clerk.reachable = false;
      integrations.clerk.ready = false;
      integrations.clerk.state = 'error';
      integrations.clerk.detail = `Clerk API check failed: ${safeMessage(error)}`;
    }
  }

  if (process.env.CLICKUP_API_TOKEN && CLICKUP_CREATOR_LIST_ID) {
    try {
      const response = await fetch(
        `https://api.clickup.com/api/v2/list/${encodeURIComponent(CLICKUP_CREATOR_LIST_ID)}`,
        { headers: { Authorization: process.env.CLICKUP_API_TOKEN.trim() } },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.err || data.error || `ClickUp returned ${response.status}`);
      integrations.clickup.checked = true;
      integrations.clickup.reachable = true;
      integrations.clickup.list_name = data.name || null;
      integrations.clickup.detail = data.name
        ? `Connected to ClickUp list: ${data.name}.`
        : 'ClickUp token and creator list are reachable.';
    } catch (error) {
      integrations.clickup.checked = true;
      integrations.clickup.reachable = false;
      integrations.clickup.ready = false;
      integrations.clickup.state = 'error';
      integrations.clickup.detail = `ClickUp API check failed: ${safeMessage(error)}`;
    }
  }

  return integrations;
}
