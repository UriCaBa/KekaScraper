import fs from 'node:fs/promises';
import path from 'node:path';

const PREFERENCES_FILENAME = 'preferences.json';
const BLOCKED_PREFERENCE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export async function loadPreferences(userDataDir, fallbackState) {
  try {
    const raw = await fs.readFile(getPreferencesPath(userDataDir), 'utf8');
    const parsedPreferences = JSON.parse(raw);
    return {
      ...fallbackState,
      ...sanitizePreferences(parsedPreferences, fallbackState),
    };
  } catch {
    return { ...fallbackState };
  }
}

export async function savePreferences(userDataDir, nextState) {
  await fs.mkdir(userDataDir, { recursive: true });
  const preferencesPath = getPreferencesPath(userDataDir);
  const tempPath = `${preferencesPath}.tmp`;
  const serializedState = `${JSON.stringify(nextState, null, 2)}\n`;

  await fs.writeFile(tempPath, serializedState, 'utf8');
  await fs.rename(tempPath, preferencesPath);
}

function getPreferencesPath(userDataDir) {
  return path.join(userDataDir, PREFERENCES_FILENAME);
}

function sanitizePreferences(parsedPreferences, fallbackState) {
  if (!parsedPreferences || typeof parsedPreferences !== 'object' || Array.isArray(parsedPreferences)) {
    return {};
  }

  const sanitizedPreferences = {};

  for (const [key, value] of Object.entries(parsedPreferences)) {
    if (BLOCKED_PREFERENCE_KEYS.has(key) || !Object.hasOwn(fallbackState, key)) {
      continue;
    }

    sanitizedPreferences[key] = value;
  }

  return sanitizedPreferences;
}
