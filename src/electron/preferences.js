import fs from 'node:fs/promises';
import path from 'node:path';

const PREFERENCES_FILENAME = 'preferences.json';

export async function loadPreferences(userDataDir, fallbackState) {
  try {
    const raw = await fs.readFile(getPreferencesPath(userDataDir), 'utf8');
    return {
      ...fallbackState,
      ...JSON.parse(raw),
    };
  } catch {
    return { ...fallbackState };
  }
}

export async function savePreferences(userDataDir, nextState) {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(
    getPreferencesPath(userDataDir),
    `${JSON.stringify(nextState, null, 2)}\n`,
    'utf8',
  );
}

function getPreferencesPath(userDataDir) {
  return path.join(userDataDir, PREFERENCES_FILENAME);
}
