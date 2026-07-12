export interface TourStep {
  kicker: string
  title: string
  body: string
}

export interface TourTone {
  accent: string
  strong: string
  soft: string
  rgb: string
  on: string
}

export interface TourPanelScrollState {
  activeIndex: number
  activeStep: number
  virtualScroll: number
  drive: number
  progress: number
}
