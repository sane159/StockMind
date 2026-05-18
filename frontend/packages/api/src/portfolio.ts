import { fetchAPI } from './client'

export interface PortfolioPosition {
  id: number
  symbol: string
  market: string
  name: string
  quantity: number
  cost_price: number
  stop_loss: number | null
  target_price: number | null
  current_price: number | null
  market_value_cny: number | null
  pnl: number | null
  pnl_pct: number | null
  status: string
  opened_at: string | null
}

export interface PortfolioAccount {
  id: number
  name: string
  available_funds: number
  total_cost: number
  total_market_value: number
  total_pnl: number
  total_pnl_pct: number
  total_assets: number
  positions: PortfolioPosition[]
}

export interface PortfolioSummary {
  accounts: PortfolioAccount[]
  total: {
    total_market_value: number
    total_cost: number
    total_pnl: number
    total_pnl_pct: number
    available_funds: number
    total_assets: number
  }
  portfolio: {
    positions_count: number
    watchlist_count: number
    available_funds: number
    invested_cost: number
    by_market: Array<{ market: string; positions: number; invested_cost: number }>
  }
}

export interface PositionCreatePayload {
  symbol: string
  market: string
  name: string
  quantity: number
  entry_price: number
  stop_loss?: number | null
  target_price?: number | null
}

export interface PositionUpdatePayload {
  quantity?: number
  entry_price?: number
  stop_loss?: number | null
  target_price?: number | null
}

export const portfolioApi = {
  summary: (params?: { include_quotes?: boolean }) => {
    const qs = params?.include_quotes ? '?include_quotes=true' : ''
    return fetchAPI<PortfolioSummary>(`/portfolio/summary${qs}`)
  },

  listPositions: () => fetchAPI<PortfolioPosition[]>('/portfolio/positions'),

  createPosition: (payload: PositionCreatePayload) =>
    fetchAPI<PortfolioPosition>('/portfolio/positions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePosition: (id: number, payload: PositionUpdatePayload) =>
    fetchAPI<PortfolioPosition>(`/portfolio/positions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deletePosition: (id: number) =>
    fetchAPI<{ ok: boolean }>(`/portfolio/positions/${id}`, { method: 'DELETE' }),
}
