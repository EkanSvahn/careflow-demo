const DEFAULT_DELAY_MS = 600;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCases({ fail = false } = {}) {
  await delay(DEFAULT_DELAY_MS);

  if (fail) {
    throw new Error('Simulerat fel vid laddning av ärenden.');
  }

  const response = await fetch('mock/cases.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Kunde inte hämta ärenden från API:t.');
  }

  return response.json();
}

export async function saveCase(payload, { fail = false } = {}) {
  await delay(DEFAULT_DELAY_MS);

  if (fail) {
    throw new Error('Simulerat fel vid sparande av ärende.');
  }

  const fallbackId = `CF-${Date.now().toString(36).toUpperCase()}`;
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? `CF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    : fallbackId;

  return {
    ...payload,
    id,
  };
}
