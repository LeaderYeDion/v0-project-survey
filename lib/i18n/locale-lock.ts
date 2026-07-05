import type { Locale } from "./locale"

export interface LocaleState {
  locale: Locale
  locked: boolean
}

export type LocaleAction =
  | { type: "set"; locale: Locale }
  | { type: "lock" }

export function transitionLocale(
  state: LocaleState,
  action: LocaleAction,
): LocaleState {
  if (action.type === "lock") {
    return state.locked ? state : { ...state, locked: true }
  }
  return state.locked || state.locale === action.locale
    ? state
    : { ...state, locale: action.locale }
}
