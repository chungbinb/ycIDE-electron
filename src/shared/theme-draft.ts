import { resolveThemeTokenPayload, type ThemeId, type ThemeTokenPayload } from './theme'

export interface ThemeDraftSnapshot {
  themeId: ThemeId
  payload: ThemeTokenPayload
}

export interface ThemeDraftSession {
  originThemeId: ThemeId
  entrySnapshot: ThemeDraftSnapshot
  workingThemeId: ThemeId
  workingPayload: ThemeTokenPayload
  dirty: boolean
  history: ThemeDraftSnapshot[]
  historyCursor: number
}

function cloneSnapshot(snapshot: ThemeDraftSnapshot): ThemeDraftSnapshot {
  return {
    themeId: snapshot.themeId,
    payload: resolveThemeTokenPayload(snapshot.payload, snapshot.payload.tokenValues),
  }
}

export function createThemeDraftSession(themeId: ThemeId, payload: ThemeTokenPayload): ThemeDraftSession {
  const entrySnapshot = cloneSnapshot({
    themeId,
    payload,
  })

  return {
    originThemeId: themeId,
    entrySnapshot,
    workingThemeId: entrySnapshot.themeId,
    workingPayload: resolveThemeTokenPayload(entrySnapshot.payload, entrySnapshot.payload.tokenValues),
    dirty: false,
    history: [cloneSnapshot(entrySnapshot)],
    historyCursor: 0,
  }
}

