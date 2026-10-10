// The navigator is shared with the channel session chart; it lives in
// @streampulse/analytics-console so both charts get the same zoom bar.
export {
  ChartNavigator as HubChartNavigator,
  useChartScrollZoom,
  zoomNavigatorRange,
  type ChartNavigatorPreset as HubChartNavigatorPreset,
  type ChartNavigatorProps as HubChartNavigatorProps,
  type ChartNavigatorRange as HubChartNavigatorRange,
} from '@streampulse/analytics-console/chart-navigator'
