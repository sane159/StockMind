export interface MarketBadgeInfo {
  style: string
  label: string
}

export function getMarketBadge(_market: string): MarketBadgeInfo {
  return { style: 'bg-blue-500/10 text-blue-600', label: 'A股' }
}
