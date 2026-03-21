import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../lib/utils.js';

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
  await atomicWriteJson(getPreferencesPath(userDataDir), nextState);
}

function getPreferencesPath(userDataDir) {
  return path.join(userDataDir, PREFERENCES_FILENAME);
}

export function sanitizePreferences(parsedPreferences, fallbackState) {
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
