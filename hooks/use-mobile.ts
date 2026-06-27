import * as React from 'react'

import {
  DESKTOP_BREAKPOINT,
  MOBILE_BREAKPOINT,
  getResponsiveLayout,
} from '@/lib/responsive-layout.mjs'

export type ResponsiveLayout = 'mobile' | 'tablet' | 'desktop'

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = React.useState<ResponsiveLayout>('desktop')

  React.useEffect(() => {
    const updateLayout = () => setLayout(getResponsiveLayout(window.innerWidth))
    const mobileQuery = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    )
    const desktopQuery = window.matchMedia(
      `(min-width: ${DESKTOP_BREAKPOINT}px)`,
    )

    mobileQuery.addEventListener('change', updateLayout)
    desktopQuery.addEventListener('change', updateLayout)
    updateLayout()

    return () => {
      mobileQuery.removeEventListener('change', updateLayout)
      desktopQuery.removeEventListener('change', updateLayout)
    }
  }, [])

  return layout
}

export function useIsMobile() {
  return useResponsiveLayout() === 'mobile'
}
