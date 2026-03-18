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
  const preferencesPath = getPreferencesPath(userDataDir);
  const tempPath = `${preferencesPath}.tmp`;
  const serializedState = `${JSON.stringify(nextState, null, 2)}\n`;

  await fs.writeFile(tempPath, serializedState, 'utf8');
  await fs.rename(tempPath, preferencesPath);
}

function getPreferencesPath(userDataDir) {
  return path.join(userDataDir, PREFERENCES_FILENAME);
}
