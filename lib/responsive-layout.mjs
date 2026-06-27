export const MOBILE_BREAKPOINT = 768
export const DESKTOP_BREAKPOINT = 1200

/**
 * @param {number} width
 * @returns {"mobile" | "tablet" | "desktop"}
 */
export function getResponsiveLayout(width) {
  if (width < MOBILE_BREAKPOINT) return "mobile"
  if (width < DESKTOP_BREAKPOINT) return "tablet"
  return "desktop"
}
