import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Search, Bot, RefreshCw, Play, Bell, Newspaper, ExternalLink, BarChart3, Clock, Cpu } from 'lucide-react'
import { fetchAPI, stocksApi, type AIService, type NotifyChannel } from '@panwatch/api'
import { useLocalStorage } from '@/lib/utils'
import { SuggestionBadge, type SuggestionInfo, type KlineSummary } from '@panwatch/biz-ui/components/suggestion-badge'
import { buildKlineSuggestion } from '@/lib/kline-scorer'
import { KlineSummaryDialog } from '@panwatch/biz-ui/components/kline-summary-dialog'
import { Button } from '@panwatch/base-ui/components/ui/button'
import { Input } from '@panwatch/base-ui/components/ui/input'
import { Switch } from '@panwatch/base-ui/components/ui/switch'
import { Badge } from '@panwatch/base-ui/components/ui/badge'
import { Skeleton } from '@panwatch/base-ui/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@panwatch/base-ui/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@panwatch/base-ui/components/ui/select'
import { useToast } from '@panwatch/base-ui/components/ui/toast'
import StockInsightModal from '@panwatch/biz-ui/components/stock-insight-modal'
import { getMarketBadge } from '@panwatch/biz-ui'
import StockPriceAlertPanel from '@panwatch/biz-ui/components/stock-price-alert-panel'

interface AgentResult {
  success?: boolean
  message?: string
  title: string
  content: string
  should_alert: boolean
  notified: boolean
  skipped?: boolean
}

interface StockAgentInfo {
  agent_name: string
  schedule: string
  ai_model_id: number | null
  notify_channel_ids: number[]
}

interface Stock {
  id: number
  symbol: string
  name: string
  market: string
  sort_order?: number
  agents: StockAgentInfo[]
}

interface AgentConfig {
  name: string
  display_name: string
  description: string
  enabled: boolean
  schedule: string
  execution_mode: string
}

interface SchedulePreview {
  schedule: string
  timezone: string
  next_runs: string[]
}

interface SearchResult {
  symbol: string
  name: string
  market: string
}

interface QuoteRequestItem {
  symbol: string
  market: string
}

interface QuoteResponse {
  symbol: string
  market: string
  current_price: number | null
  change_pct: number | null
}

interface StockForm {
  symbol: string
  name: string
  market: string
}

interface StockSuggestionData {
  symbol: string
  suggestion: SuggestionInfo | null
  kline: KlineSummary | null
}

interface PoolSuggestion {
  id: number
  stock_symbol: string
  stock_market?: string
  stock_name: string
  action: string
  action_label: string
  signal: string
  reason: string
  agent_name: string
  agent_label: string
  created_at: string
  expires_at: string | null
  is_expired: boolean
  prompt_context: string
  ai_response: string
  meta?: Record<string, any>
  should_alert?: boolean
}

interface MarketStatus {
  code: string
  name: string
  status: string
  status_text: string
  is_trading: boolean
  sessions: string[]
  local_time: string
}

interface NewsItem {
  source: string
  source_label: string
  external_id: string
  title: string
  content: string
  publish_time: string
  symbols: string[]
  importance: number
  url: string
}

interface PriceAlertRuleSummary {
  stock_symbol: string
  market: string
  enabled: boolean
}

const emptyStockForm: StockForm = { symbol: '', name: '', market: 'CN' }

const formatPrice = (value: number) => value.toFixed(4).replace(/\.?0+$/, '')

export default function StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [services, setServices] = useState<AIService[]>([])
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [loading, setLoading] = useState(true)

  // Quotes
  const [quotes, setQuotes] = useState<Record<string, { current_price: number | null; change_pct: number | null }>>({})
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [klineSummaries, setKlineSummaries] = useState<Record<string, KlineSummary>>({})

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useLocalStorage('panwatch_stocks_autoRefresh', false)
  const [refreshInterval, setRefreshInterval] = useLocalStorage('panwatch_stocks_refreshInterval', 30)
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>()

  // Scanning
  const [scanning, setScanning] = useState(false)

  // Suggestions
  const [suggestions] = useState<Record<string, StockSuggestionData>>({})
  const [poolSuggestions, setPoolSuggestions] = useState<Record<string, PoolSuggestion>>({})
  const [poolSuggestionsLoading, setPoolSuggestionsLoading] = useState(false)
  const [priceAlertSummaryMap, setPriceAlertSummaryMap] = useState<Record<string, { total: number; enabled: number }>>({})

  // News Dialog
  const [newsDialogOpen, setNewsDialogOpen] = useState(false)
  const [newsDialogSymbol, setNewsDialogSymbol] = useState<string>('')
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(false)

  // Kline Dialog
  const [klineDialogOpen, setKlineDialogOpen] = useState(false)
  const [klineDialogSymbol, setKlineDialogSymbol] = useState('')
  const [klineDialogMarket, setKlineDialogMarket] = useState('CN')
  const [klineDialogName, setKlineDialogName] = useState<string | undefined>(undefined)
  const [klineDialogInitialSummary, setKlineDialogInitialSummary] = useState<KlineSummary | null>(null)

  // Insight Modal
  const [insightOpen, setInsightOpen] = useState(false)
  const [insightSymbol, setInsightSymbol] = useState('')
  const [insightMarket, setInsightMarket] = useState('CN')
  const [insightName, setInsightName] = useState<string | undefined>(undefined)

  // Market status
  const [marketStatus, setMarketStatus] = useState<MarketStatus[]>([])
  const klineRefreshInFlight = useRef<Promise<void> | null>(null)

  // Stock form
  const [showStockForm, setShowStockForm] = useState(false)
  const [stockForm, setStockForm] = useState<StockForm>(emptyStockForm)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMarket, setSearchMarket] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [refreshingStockList, setRefreshingStockList] = useState(false)

  // Remove confirm
  const [removeWatchStock, setRemoveWatchStock] = useState<Stock | null>(null)
  const [removingWatchStock, setRemovingWatchStock] = useState(false)

  // Drag sort
  const [draggingWatchStockId, setDraggingWatchStockId] = useState<number | null>(null)
  const watchDragSnapshotRef = useRef<Stock[] | null>(null)

  // Stock list filter
  const [stockListFilter, setStockListFilter] = useState('')
  const [watchlistOnlyAlerts, setWatchlistOnlyAlerts] = useLocalStorage<boolean>('panwatch_watchlist_only_alerts', false)

  // Agent dialog
  const [agentDialogStock, setAgentDialogStock] = useState<Stock | null>(null)
  const [triggeringAgent, setTriggeringAgent] = useState<string | null>(null)
  const [schedulePreviewCache, setSchedulePreviewCache] = useState<Record<string, SchedulePreview | { error: string }>>({})
  const [schedulePreviewLoading, setSchedulePreviewLoading] = useState<Record<string, boolean>>({})
  const [runningAgents, setRunningAgents] = useState<Record<number, string | null>>({})
  const [agentResultDialog, setAgentResultDialog] = useState<{ title: string; content: string; should_alert: boolean; notified: boolean } | null>(null)

  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { toast } = useToast()

  // ========== Drag sort ==========
  const moveById = <T extends { id: number }>(list: T[], fromId: number, toId: number): T[] => {
    const fromIdx = list.findIndex(x => x.id === fromId)
    const toIdx = list.findIndex(x => x.id === toId)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return list
    const next = [...list]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    return next
  }

  const persistWatchlistOrder = useCallback(async (ordered: Stock[]) => {
    const payload = ordered.map((s, idx) => ({ id: s.id, sort_order: idx + 1 }))
    await fetchAPI('/stocks/reorder', { method: 'PUT', body: JSON.stringify({ items: payload }) })
  }, [])

  const previewWatchlistReorder = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return
    setStocks(prev => {
      const ordered = [...prev].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.id - b.id)
      const moved = moveById(ordered, fromId, toId)
      return moved.map((s, idx) => ({ ...s, sort_order: idx + 1 }))
    })
  }, [])

  const commitWatchlistReorder = useCallback(async () => {
    if (!stocks || stocks.length === 0) return
    try {
      await persistWatchlistOrder(stocks)
    } catch (e) {
      if (watchDragSnapshotRef.current) setStocks(watchDragSnapshotRef.current)
      toast(e instanceof Error ? e.message : '保存排序失败', 'error')
    }
  }, [persistWatchlistOrder, stocks, toast])

  const isSuppressCardClick = () => {
    try {
      const until = (window as any).__panwatch_suppress_card_click_until
      return typeof until === 'number' && Date.now() < until
    } catch { return false }
  }

  // ========== Data loading ==========
  const loadConfigAsync = async () => {
    try {
      const [agentData, servicesData, channelsData] = await Promise.all([
        fetchAPI<AgentConfig[]>('/agents'),
        fetchAPI<AIService[]>('/providers/services'),
        fetchAPI<NotifyChannel[]>('/channels'),
      ])
      setAgents(agentData)
      setServices(servicesData)
      setChannels(channelsData)
    } catch (e) {
      console.warn('加载配置数据失败:', e)
    }
  }

  const load = async () => {
    try {
      const stockData = await fetchAPI<Stock[]>('/stocks')
      setStocks(stockData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
    loadConfigAsync()
    try {
      const marketStatusData = await fetchAPI<MarketStatus[]>('/stocks/markets/status')
      setMarketStatus(marketStatusData)
    } catch (e) {
      console.warn('获取市场状态失败:', e)
    }
  }

  const buildQuoteItems = useCallback((): QuoteRequestItem[] => {
    const seen = new Set<string>()
    return stocks.reduce<QuoteRequestItem[]>((acc, stock) => {
      const key = `${stock.market}:${stock.symbol}`
      if (!seen.has(key)) { seen.add(key); acc.push({ symbol: stock.symbol, market: stock.market }) }
      return acc
    }, [])
  }, [stocks])

  const refreshQuotes = useCallback(async () => {
    const items = buildQuoteItems()
    if (items.length === 0) return
    setQuotesLoading(true)
    try {
      const data = await fetchAPI<QuoteResponse[]>('/quotes/batch', {
        method: 'POST',
        body: JSON.stringify({ items }),
      })
      const map: Record<string, { current_price: number | null; change_pct: number | null }> = {}
      for (const item of data) {
        map[`${item.market}:${item.symbol}`] = { current_price: item.current_price ?? null, change_pct: item.change_pct ?? null }
      }
      setQuotes(map)
      setLastRefreshTime(new Date())
    } catch (e) {
      console.warn('刷新行情失败:', e)
    } finally {
      setQuotesLoading(false)
    }
  }, [buildQuoteItems])

  const refreshKlines = useCallback(async () => {
    if (klineRefreshInFlight.current) return klineRefreshInFlight.current
    const run = (async () => {
      const items = buildQuoteItems()
      if (items.length === 0) return
      const limit = 5
      const map: Record<string, KlineSummary> = {}
      let idx = 0
      const worker = async () => {
        while (idx < items.length) {
          const i = idx++
          const it = items[i]
          try {
            const res = await fetchAPI<{ symbol: string; market: string; summary: KlineSummary }>(
              `/klines/${encodeURIComponent(it.symbol)}/summary?market=${encodeURIComponent(it.market)}`
            )
            if (res && (res as any).summary) map[`${it.market}:${it.symbol}`] = (res as any).summary as KlineSummary
          } catch { /* ignore single failure */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
      setKlineSummaries(prev => ({ ...prev, ...map }))
    })()
    klineRefreshInFlight.current = run
    try { await run } finally { klineRefreshInFlight.current = null }
  }, [buildQuoteItems])

  const loadPoolSuggestions = useCallback(async () => {
    setPoolSuggestionsLoading(true)
    try {
      const data = await fetchAPI<Record<string, PoolSuggestion>>('/suggestions?include_expired=true')
      setPoolSuggestions(data)
    } catch (e) {
      console.warn('加载建议池失败:', e)
    } finally {
      setPoolSuggestionsLoading(false)
    }
  }, [])

  const loadPriceAlertSummaries = useCallback(async () => {
    try {
      const rows = await fetchAPI<PriceAlertRuleSummary[]>('/price-alerts')
      const map: Record<string, { total: number; enabled: number }> = {}
      for (const r of rows || []) {
        const key = `${String(r.market || 'CN').toUpperCase()}:${String(r.stock_symbol || '').toUpperCase()}`
        if (!map[key]) map[key] = { total: 0, enabled: 0 }
        map[key].total += 1
        if (r.enabled) map[key].enabled += 1
      }
      setPriceAlertSummaryMap(map)
    } catch (e) {
      console.warn('加载提醒摘要失败:', e)
    }
  }, [])

  const loadNews = useCallback(async (stockName?: string) => {
    setNewsLoading(true)
    try {
      const params = new URLSearchParams({ hours: '168', limit: '50' })
      if (stockName) params.set('names', stockName)
      const newsData = await fetchAPI<NewsItem[]>(`/news?${params}`)
      setNews(newsData)
    } catch (e) {
      console.error('加载新闻失败:', e)
    } finally {
      setNewsLoading(false)
    }
  }, [])

  const openKlineDialog = useCallback((symbol: string, market: string, name?: string) => {
    setKlineDialogSymbol(symbol)
    setKlineDialogMarket(market || 'CN')
    setKlineDialogName(name)
    setKlineDialogInitialSummary(klineSummaries[`${market || 'CN'}:${symbol}`] || null)
    setKlineDialogOpen(true)
  }, [klineSummaries])

  const openNewsDialog = useCallback((stockName?: string) => {
    setNewsDialogSymbol(stockName || '')
    setNewsDialogOpen(true)
    loadNews(stockName)
  }, [loadNews])

  const openStockDetail = useCallback((stockSymbol: string, stockMarket: string, stockName?: string) => {
    setInsightSymbol(stockSymbol)
    setInsightMarket(stockMarket || 'CN')
    setInsightName(stockName)
    setInsightOpen(true)
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshQuotes(), loadPoolSuggestions(), refreshKlines()])
  }, [refreshQuotes, loadPoolSuggestions, refreshKlines])

  // ========== Effects ==========
  useEffect(() => { load(); loadPoolSuggestions(); loadPriceAlertSummaries() }, [])

  const watchlistKlineInitDone = useRef(false)
  const klineMissingRetryRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (watchlistKlineInitDone.current) return
    if (!stocks || stocks.length === 0) return
    watchlistKlineInitDone.current = true
    refreshKlines()
  }, [stocks, refreshKlines])

  useEffect(() => {
    if (!stocks || stocks.length === 0) return
    const now = Date.now()
    const retryGapMs = 2 * 60 * 1000
    const missing = stocks.filter(s => {
      const key = `${s.market || 'CN'}:${s.symbol}`
      if (klineSummaries[key]) return false
      const lastTry = klineMissingRetryRef.current[key] || 0
      return (now - lastTry) > retryGapMs
    })
    if (missing.length === 0) return
    for (const s of missing) klineMissingRetryRef.current[`${s.market || 'CN'}:${s.symbol}`] = now
    refreshKlines()
  }, [stocks, klineSummaries, refreshKlines])

  useEffect(() => {
    if (stocks.length === 0) return
    refreshQuotes()
    ;(async () => { try { await refreshKlines() } catch {} })()
  }, [stocks])

  // Agent dialog schedule preview
  const effectiveSchedule = (agent: AgentConfig, stockAgent?: StockAgentInfo | null): string => {
    const local = (stockAgent?.schedule || '').trim()
    return local || (agent.schedule || '').trim()
  }

  useEffect(() => {
    if (!agentDialogStock) return
    if (!agents || agents.length === 0) return
    const stockAgentMap = new Map((agentDialogStock.agents || []).map(a => [a.agent_name, a]))
    const schedules = new Set<string>()
    for (const agent of agents) {
      if (agent.execution_mode === 'batch') continue
      const sa = stockAgentMap.get(agent.name)
      if (!sa) continue
      const eff = effectiveSchedule(agent, sa)
      if (eff) schedules.add(eff)
    }
    const toFetch = Array.from(schedules).filter(s => !schedulePreviewCache[s] && !schedulePreviewLoading[s])
    if (toFetch.length === 0) return
    let cancelled = false
    ;(async () => {
      setSchedulePreviewLoading(prev => { const next = { ...prev }; for (const s of toFetch) next[s] = true; return next })
      try {
        const pairs = await Promise.all(toFetch.map(async s => {
          try {
            const p = await fetchAPI<SchedulePreview>(`/agents/schedule/preview?schedule=${encodeURIComponent(s)}&count=5`)
            return [s, p] as const
          } catch (e) {
            return [s, { error: e instanceof Error ? e.message : '预览失败' }] as const
          }
        }))
        if (!cancelled) setSchedulePreviewCache(prev => ({ ...prev, ...Object.fromEntries(pairs) }))
      } finally {
        if (!cancelled) setSchedulePreviewLoading(prev => { const next = { ...prev }; for (const s of toFetch) next[s] = false; return next })
      }
    })()
    return () => { cancelled = true }
  }, [agentDialogStock, agents, schedulePreviewCache, schedulePreviewLoading])

  // ========== Scan ==========
  const scanAndReload = useCallback(async () => {
    setScanning(true)
    try {
      await fetchAPI('/agents/intraday/scan?analyze=true', { method: 'POST' })
      await loadPoolSuggestions()
      await refreshKlines()
      setLastRefreshTime(new Date())
    } catch (e) {
      console.error('扫描失败:', e)
      toast(e instanceof Error ? e.message : '扫描失败', 'error')
    } finally {
      setScanning(false)
    }
  }, [loadPoolSuggestions, refreshKlines, toast])

  // Auto-refresh timer
  useEffect(() => {
    if (autoRefresh) {
      refreshQuotes(); refreshKlines(); loadPoolSuggestions()
      refreshTimerRef.current = setInterval(() => {
        refreshQuotes(); refreshKlines(); loadPoolSuggestions()
      }, refreshInterval * 1000)
    } else {
      if (refreshTimerRef.current) { clearInterval(refreshTimerRef.current); refreshTimerRef.current = undefined }
    }
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current) }
  }, [autoRefresh, refreshInterval, refreshQuotes, refreshKlines])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ========== Stock handlers ==========
  const doSearch = async (q: string, market: string = searchMarket) => {
    if (q.length < 1) { setSearchResults([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const marketParam = market ? `&market=${market}` : ''
      const results = await fetchAPI<SearchResult[]>(`/stocks/search?q=${encodeURIComponent(q)}${marketParam}`)
      setSearchResults(results)
      setShowDropdown(results.length > 0)
    } catch { setSearchResults([]) }
    finally { setSearching(false) }
  }

  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(value), 500)
  }

  const handleSearchMarketChange = (market: string) => {
    setSearchMarket(market)
    if (searchQuery) doSearch(searchQuery, market)
  }

  const refreshStockListCache = async () => {
    setRefreshingStockList(true)
    try {
      const result = await fetchAPI<{ count: number }>('/stocks/refresh-list', { method: 'POST' })
      toast(`已刷新股票列表，共 ${result.count} 只`, 'success')
      if (searchQuery) doSearch(searchQuery)
    } catch {
      toast('刷新失败', 'error')
    } finally {
      setRefreshingStockList(false)
    }
  }

  const selectStock = (item: SearchResult) => {
    setStockForm({ symbol: item.symbol, name: item.name, market: item.market })
    setSearchQuery(`${item.symbol} ${item.name}`)
    setShowDropdown(false)
  }

  const handleStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await stocksApi.create(stockForm)
      setStockForm(emptyStockForm)
      setSearchQuery('')
      setShowStockForm(false)
      load()
      toast('股票已添加', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '添加股票失败', 'error')
    }
  }

  const removeFromWatchlist = async (stock: Stock) => {
    setRemovingWatchStock(true)
    try {
      await stocksApi.remove(stock.id)
      toast('股票已删除', 'success')
      setRemoveWatchStock(null)
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败', 'error')
    } finally {
      setRemovingWatchStock(false)
    }
  }

  // ========== Agent handlers ==========
  const toggleAgent = async (stock: Stock, agentName: string) => {
    try {
      const current = stock.agents || []
      const isAssigned = current.some(a => a.agent_name === agentName)
      const newAgents = isAssigned
        ? current.filter(a => a.agent_name !== agentName)
        : [...current, { agent_name: agentName, schedule: '', ai_model_id: null, notify_channel_ids: [] }]
      await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
      load()
      setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '更新 Agent 失败', 'error')
    }
  }

  const triggerStockAgent = async (stockId: number, agentName: string) => {
    setTriggeringAgent(agentName)
    setRunningAgents(prev => ({ ...prev, [stockId]: agentName }))
    setAgentDialogStock(null)
    try {
      const resp = await fetchAPI<{ result: AgentResult; success?: boolean; message?: string }>(
        `/stocks/${stockId}/agents/${agentName}/trigger?bypass_throttle=true`,
        { method: 'POST' }
      )
      const result = resp?.result
      if (result) {
        if (result.success === false) { toast(result.message || result.content || '执行未通过', 'info'); return }
        const isSkipped = !!result.skipped || /已跳过执行|非交易时段/.test(result.content || '')
        if (isSkipped) {
          toast(result.content || '当前非交易时段，已跳过执行', 'info')
        } else {
          toast(result.should_alert ? 'AI 建议关注' : 'AI 判断无需关注', result.should_alert ? 'success' : 'info')
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '触发失败'
      toast(msg, /非交易时段|跳过执行/.test(msg) ? 'info' : 'error')
    } finally {
      setTriggeringAgent(null)
      setRunningAgents(prev => ({ ...prev, [stockId]: null }))
    }
  }

  const updateStockAgentModel = async (stock: Stock, agentName: string, modelId: number | null) => {
    try {
      const newAgents = (stock.agents || []).map(a => a.agent_name === agentName ? { ...a, ai_model_id: modelId } : a)
      await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
      load()
      setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '更新 Agent 模型失败', 'error')
    }
  }

  const toggleStockAgentChannel = async (stock: Stock, agentName: string, channelId: number) => {
    try {
      const newAgents = (stock.agents || []).map(a => {
        if (a.agent_name !== agentName) return a
        const current = a.notify_channel_ids || []
        const newIds = current.includes(channelId) ? current.filter(id => id !== channelId) : [...current, channelId]
        return { ...a, notify_channel_ids: newIds }
      })
      await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
      load()
      setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '更新 Agent 通知配置失败', 'error')
    }
  }

  const updateStockAgentSchedule = async (stock: Stock, agentName: string, schedule: string) => {
    try {
      const newAgents = (stock.agents || []).map(a => a.agent_name === agentName ? { ...a, schedule } : a)
      await fetchAPI(`/stocks/${stock.id}/agents`, { method: 'PUT', body: JSON.stringify({ agents: newAgents }) })
      load()
      setAgentDialogStock(prev => prev ? { ...prev, agents: newAgents } : null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '更新 Agent 调度失败', 'error')
    }
  }

  // ========== Helpers ==========
  const getStockQuote = (quoteKey: string) => quotes[quoteKey] || null

  const getPriceAlertSummary = (symbol: string, market: string) => {
    const key = `${String(market || 'CN').toUpperCase()}:${String(symbol || '').toUpperCase()}`
    return priceAlertSummaryMap[key] || { total: 0, enabled: 0 }
  }

  const getSuggestionForStock = (symbol: string, market: string): { suggestion: SuggestionInfo | null; kline: KlineSummary | null } => {
    const key = `${market || 'CN'}:${symbol}`
    const poolSug =
      poolSuggestions[key] ||
      (() => {
        const fallback = poolSuggestions[symbol]
        if (!fallback) return null
        const fm = String(fallback.stock_market || '').toUpperCase()
        return fm && fm !== String(market || 'CN').toUpperCase() ? null : fallback
      })()
    if (poolSug) {
      const preloadedKline = klineSummaries[key] || (suggestions[symbol]?.kline as any) || null
      return {
        suggestion: {
          id: poolSug.id,
          action: poolSug.action,
          action_label: poolSug.action_label,
          signal: poolSug.signal,
          reason: poolSug.reason,
          should_alert: poolSug.should_alert ?? (['alert', 'avoid', 'sell', 'reduce'].includes(poolSug.action)),
          agent_name: poolSug.agent_name,
          agent_label: poolSug.agent_label,
          created_at: poolSug.created_at,
          is_expired: poolSug.is_expired,
          prompt_context: poolSug.prompt_context,
          ai_response: poolSug.ai_response,
          meta: poolSug.meta,
        },
        kline: preloadedKline,
      }
    }
    const ks = klineSummaries[key]
    if (ks) {
      const scored = buildKlineSuggestion(ks as any, false)
      return {
        suggestion: { action: scored.action, action_label: scored.action_label, signal: scored.signal, reason: '', should_alert: false, agent_label: '技术指标' },
        kline: ks,
      }
    }
    return { suggestion: null, kline: null }
  }

  const formatPreviewTime = (iso: string, tz?: string): string => {
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return iso
      return d.toLocaleString('zh-CN', { timeZone: tz || undefined, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    } catch { return iso }
  }

  // ========== Render ==========
  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-16" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 p-3">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] md:text-[22px] font-bold text-foreground tracking-tight">自选股</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {marketStatus.map(m => {
                const statusColors: Record<string, string> = {
                  trading: 'bg-emerald-500',
                  pre_market: 'bg-amber-500',
                  break: 'bg-amber-500',
                  after_hours: 'bg-slate-400',
                  closed: 'bg-slate-400',
                }
                return (
                  <div key={m.code} className="flex items-center gap-1" title={`${m.sessions.join(', ')} (${m.local_time})`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusColors[m.status] || 'bg-slate-400'}`} />
                    <span className="text-[11px] text-muted-foreground">{m.name}</span>
                    <span className={`text-[10px] ${m.is_trading ? 'text-emerald-600' : 'text-muted-foreground/60'}`}>{m.status_text}</span>
                  </div>
                )
              })}
            </div>
          </div>
          {/* Desktop buttons */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-accent/30">
              <div className="flex items-center gap-1.5">
                <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-90" />
                <span className="text-[11px] text-muted-foreground">自动刷新</span>
                {autoRefresh && (
                  <Select value={refreshInterval.toString()} onValueChange={v => setRefreshInterval(parseInt(v))}>
                    <SelectTrigger className="h-6 w-14 text-[10px] px-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10s</SelectItem>
                      <SelectItem value="30">30s</SelectItem>
                      <SelectItem value="60">1分钟</SelectItem>
                      <SelectItem value="120">2分钟</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              {(poolSuggestionsLoading || Object.keys(poolSuggestions).length > 0) && (
                <>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {poolSuggestionsLoading && <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
                    {!poolSuggestionsLoading && Object.keys(poolSuggestions).length > 0 && (
                      <span className="text-[10px] text-primary">{Object.keys(poolSuggestions).length}</span>
                    )}
                  </div>
                </>
              )}
              {lastRefreshTime && (
                <>
                  <div className="w-px h-4 bg-border" />
                  <span className="text-[10px] text-muted-foreground/60">
                    {lastRefreshTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </>
              )}
            </div>
            <Button variant="secondary" onClick={handleRefresh} disabled={quotesLoading}>
              <RefreshCw className={`w-4 h-4 ${quotesLoading ? 'animate-spin' : ''}`} /> 刷新
            </Button>
            <Button variant="secondary" onClick={scanAndReload} disabled={scanning}>
              <Bot className="w-4 h-4" /> 扫描
            </Button>
            <Button onClick={() => { setStockForm(emptyStockForm); setSearchQuery(''); setShowStockForm(true) }}>
              <Plus className="w-4 h-4" /> 添加股票
            </Button>
          </div>
          {/* Mobile buttons */}
          <div className="flex md:hidden items-center gap-1.5">
            <Button variant="secondary" size="sm" className="h-8 w-8 p-0" onClick={handleRefresh} disabled={quotesLoading}>
              <RefreshCw className={`w-4 h-4 ${quotesLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="secondary" size="sm" className="h-8 w-8 p-0" onClick={scanAndReload} disabled={scanning}>
              <Bot className="w-4 h-4" />
            </Button>
            <Button size="sm" className="h-8 w-8 p-0" onClick={() => { setStockForm(emptyStockForm); setSearchQuery(''); setShowStockForm(true) }}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {/* Mobile controls row */}
        <div className="flex md:hidden items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-accent/30">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-90" />
            <span className="text-[11px] text-muted-foreground">自动刷新</span>
            {autoRefresh && (
              <Select value={refreshInterval.toString()} onValueChange={v => setRefreshInterval(parseInt(v))}>
                <SelectTrigger className="h-6 w-14 text-[10px] px-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10s</SelectItem>
                  <SelectItem value="30">30s</SelectItem>
                  <SelectItem value="60">1分钟</SelectItem>
                  <SelectItem value="120">2分钟</SelectItem>
                </SelectContent>
              </Select>
            )}
            {lastRefreshTime && (
              <span className="text-[10px] text-muted-foreground/60">
                {lastRefreshTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stock list filter */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div />
        <button
          onClick={() => setWatchlistOnlyAlerts(!watchlistOnlyAlerts)}
          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
            watchlistOnlyAlerts
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-600'
              : 'bg-accent/30 border-border/50 text-muted-foreground hover:border-rose-500/30'
          }`}
        >
          仅预警
        </button>
      </div>

      {/* Stock grid */}
      {stocks.length === 0 ? (
        <div className="py-12 text-center">
          <div className="text-[13px] text-muted-foreground">还没有添加自选股</div>
          <div className="mt-2 text-[11px] text-muted-foreground/70">点击右上角"添加股票"开始</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stocks
            .filter(s => !stockListFilter || s.market === stockListFilter)
            .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.id - b.id)
            .filter(stock => {
              if (!watchlistOnlyAlerts) return true
              const { suggestion } = getSuggestionForStock(stock.symbol, stock.market)
              return !!suggestion?.should_alert
            })
            .map(stock => {
              const quote = getStockQuote(`${stock.market}:${stock.symbol}`)
              const changeColor = quote?.change_pct != null
                ? (quote.change_pct > 0 ? 'text-rose-500' : quote.change_pct < 0 ? 'text-emerald-500' : 'text-muted-foreground')
                : 'text-muted-foreground'
              const { suggestion, kline } = getSuggestionForStock(stock.symbol, stock.market)
              return (
                <div
                  key={stock.id}
                  draggable={stockListFilter === '' && !watchlistOnlyAlerts}
                  onDragStart={(e) => {
                    if (stockListFilter !== '' || watchlistOnlyAlerts) return
                    watchDragSnapshotRef.current = stocks
                    setDraggingWatchStockId(stock.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (stockListFilter !== '' || watchlistOnlyAlerts) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (draggingWatchStockId != null) previewWatchlistReorder(draggingWatchStockId, stock.id)
                  }}
                  onDrop={(e) => {
                    if (stockListFilter !== '' || watchlistOnlyAlerts) return
                    e.preventDefault()
                    if (draggingWatchStockId != null) commitWatchlistReorder()
                    setDraggingWatchStockId(null)
                    watchDragSnapshotRef.current = null
                  }}
                  onDragEnd={() => {
                    setDraggingWatchStockId(null)
                    watchDragSnapshotRef.current = null
                  }}
                  className={`group rounded-xl border border-border/40 bg-background/30 hover:bg-accent/20 transition-colors p-3 cursor-pointer ${draggingWatchStockId === stock.id ? 'opacity-60' : ''}`}
                  onClick={() => { if (isSuppressCardClick()) return; setAgentDialogStock(stock) }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${getMarketBadge(stock.market).style}`}>
                          {getMarketBadge(stock.market).label}
                        </span>
                        <button
                          className="font-mono text-[12px] font-semibold text-foreground hover:text-primary flex-shrink-0"
                          onClick={(e) => { e.stopPropagation(); openStockDetail(stock.symbol, stock.market, stock.name) }}
                        >
                          {stock.symbol}
                        </button>
                        <button
                          className="text-[12px] text-muted-foreground truncate hover:text-primary"
                          onClick={(e) => { e.stopPropagation(); openStockDetail(stock.symbol, stock.market, stock.name) }}
                        >
                          {stock.name}
                        </button>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`font-mono text-[14px] font-bold leading-tight ${changeColor}`}>
                        {quote?.current_price != null ? formatPrice(quote.current_price) : '--'}
                      </div>
                      <div className={`font-mono text-[11px] leading-tight ${changeColor}`}>
                        {quote?.change_pct != null ? `${quote.change_pct >= 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%` : '--'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2">
                    {(suggestion || kline) ? (
                      <SuggestionBadge
                        suggestion={suggestion}
                        stockName={stock.name}
                        stockSymbol={stock.symbol}
                        kline={kline}
                        market={stock.market}
                        hasPosition={false}
                      />
                    ) : (
                      <div className="text-[11px] text-muted-foreground/70 py-2">暂无技术面/AI 分析</div>
                    )}
                  </div>

                  <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(stock.agents || []).length > 0 && (
                        <div className="flex items-center gap-1">
                          {(stock.agents || []).map(a => (
                            <span key={a.agent_name} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                              {a.agent_name}
                            </span>
                          ))}
                        </div>
                      )}
                      {runningAgents[stock.id] && (
                        <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      {(() => {
                        const { suggestion: sg, kline: kl } = getSuggestionForStock(stock.symbol, stock.market)
                        return (!sg && !kl) ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openKlineDialog(stock.symbol, stock.market, stock.name)} title="K线指标">
                            <BarChart3 className="w-3 h-3" />
                          </Button>
                        ) : null
                      })()}
                      <StockPriceAlertPanel
                        mode="icon"
                        stockId={stock.id}
                        symbol={stock.symbol}
                        market={stock.market}
                        stockName={stock.name}
                        initialTotal={getPriceAlertSummary(stock.symbol, stock.market).total}
                        initialEnabled={getPriceAlertSummary(stock.symbol, stock.market).enabled}
                        onChanged={loadPriceAlertSummaries}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNewsDialog(stock.name)} title="相关资讯">
                        <Newspaper className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => setRemoveWatchStock(stock)} title="删除">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* Add Stock Dialog */}
      <Dialog open={showStockForm} onOpenChange={(open) => { setShowStockForm(open); if (!open) { setSearchQuery(''); setSearchMarket('') } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加股票到自选</DialogTitle>
            <DialogDescription>搜索并添加到自选股列表</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleStockSubmit}>
            <div className="relative" ref={dropdownRef}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-medium">搜索股票</span>
                <button
                  type="button"
                  onClick={refreshStockListCache}
                  disabled={refreshingStockList}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
                  title="搜索不到？点击刷新股票列表"
                >
                  {refreshingStockList ? (
                    <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> 刷新中...</span>
                  ) : (
                    <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3" /> 刷新列表</span>
                  )}
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <Input
                  value={searchQuery}
                  onChange={e => handleSearchInput(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  placeholder="代码或名称，如 600519 或 茅台"
                  className="pl-10"
                  autoComplete="off"
                />
                {searching && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
              </div>
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 max-h-48 overflow-auto scrollbar card shadow-lg">
                  {searchResults.map(item => (
                    <button
                      key={`${item.market}-${item.symbol}`}
                      type="button"
                      onClick={() => selectStock(item)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-accent/50 text-left transition-colors"
                    >
                      <span className={`text-[9px] px-1 py-0.5 rounded ${getMarketBadge(item.market).style}`}>{getMarketBadge(item.market).label}</span>
                      <span className="font-mono text-muted-foreground text-[12px]">{item.symbol}</span>
                      <span className="flex-1 text-foreground">{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {stockForm.symbol && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/30">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${getMarketBadge(stockForm.market).style}`}>{getMarketBadge(stockForm.market).label}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{stockForm.symbol}</span>
                <span className="text-[13px] text-foreground">{stockForm.name}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setShowStockForm(false)}>取消</Button>
              <Button type="submit" disabled={!stockForm.symbol}>添加</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove confirm dialog */}
      <Dialog open={!!removeWatchStock} onOpenChange={open => !open && setRemoveWatchStock(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除自选股</DialogTitle>
            <DialogDescription>
              确定删除 {removeWatchStock?.name}（{removeWatchStock?.symbol}）？
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setRemoveWatchStock(null)}>取消</Button>
            <Button variant="destructive" disabled={removingWatchStock} onClick={() => removeWatchStock && removeFromWatchlist(removeWatchStock)}>
              {removingWatchStock ? '删除中...' : '删除'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Agent config dialog */}
      <Dialog open={!!agentDialogStock} onOpenChange={open => !open && setAgentDialogStock(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" />
              {agentDialogStock?.name}
              <span className="font-mono text-[12px] text-muted-foreground">{agentDialogStock?.symbol}</span>
            </DialogTitle>
            <DialogDescription>配置 AI Agent 分析任务</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {agents.length === 0 ? (
              <p className="text-[13px] text-muted-foreground text-center py-4">暂无可用 Agent</p>
            ) : (
              agents.filter(a => a.execution_mode !== 'batch').map(agent => {
                const stockAgent = (agentDialogStock?.agents || []).find(a => a.agent_name === agent.name)
                const isEnabled = !!stockAgent
                const eff = effectiveSchedule(agent, stockAgent)
                const preview = eff ? schedulePreviewCache[eff] : null
                return (
                  <div key={agent.name} className={`rounded-lg border p-3 transition-colors ${isEnabled ? 'border-primary/30 bg-primary/5' : 'border-border/40 bg-accent/10'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => agentDialogStock && toggleAgent(agentDialogStock, agent.name)}
                          className="scale-90"
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-foreground">{agent.display_name || agent.name}</div>
                          {agent.description && <div className="text-[11px] text-muted-foreground truncate">{agent.description}</div>}
                        </div>
                      </div>
                      {isEnabled && (
                        <Button
                          variant="secondary" size="sm" className="h-7 text-[11px] px-2.5 flex-shrink-0"
                          disabled={triggeringAgent === agent.name}
                          onClick={() => agentDialogStock && triggerStockAgent(agentDialogStock.id, agent.name)}
                        >
                          {triggeringAgent === agent.name ? (
                            <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          立即分析
                        </Button>
                      )}
                    </div>
                    {isEnabled && (
                      <div className="mt-3 space-y-2 pl-8">
                        {/* Schedule */}
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <Input
                            value={stockAgent?.schedule || ''}
                            onChange={e => agentDialogStock && updateStockAgentSchedule(agentDialogStock, agent.name, e.target.value)}
                            placeholder={agent.schedule || '使用全局调度'}
                            className="h-7 text-[11px] font-mono"
                          />
                        </div>
                        {preview && !('error' in preview) && (
                          <div className="text-[10px] text-muted-foreground pl-5">
                            下次: {preview.next_runs.slice(0, 3).map(t => formatPreviewTime(t, preview.timezone)).join(' / ')}
                          </div>
                        )}
                        {preview && 'error' in preview && (
                          <div className="text-[10px] text-rose-500 pl-5">{(preview as any).error}</div>
                        )}
                        {schedulePreviewLoading[eff] && (
                          <div className="text-[10px] text-muted-foreground pl-5 flex items-center gap-1">
                            <span className="w-2.5 h-2.5 border border-primary/30 border-t-primary rounded-full animate-spin" /> 加载预览...
                          </div>
                        )}
                        {/* AI Model */}
                        {services.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Cpu className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <Select
                              value={stockAgent?.ai_model_id?.toString() || '__default__'}
                              onValueChange={v => agentDialogStock && updateStockAgentModel(agentDialogStock, agent.name, v === '__default__' ? null : parseInt(v))}
                            >
                              <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__default__">默认模型</SelectItem>
                                {services.map(s => (
                                  <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {/* Notify channels */}
                        {channels.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Bell className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            {channels.map(ch => {
                              const active = (stockAgent?.notify_channel_ids || []).includes(ch.id)
                              return (
                                <button
                                  key={ch.id}
                                  onClick={() => agentDialogStock && toggleStockAgentChannel(agentDialogStock, agent.name, ch.id)}
                                  className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${
                                    active ? 'bg-primary/10 border-primary/30 text-primary font-medium' : 'bg-accent/30 border-border/50 text-muted-foreground hover:border-primary/30'
                                  }`}
                                >
                                  {ch.name}
                                </button>
                              )
                            })}
                            {(stockAgent?.notify_channel_ids || []).length === 0 && (
                              <span className="text-[10px] text-muted-foreground">系统默认</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Agent result dialog */}
      <Dialog open={!!agentResultDialog} onOpenChange={open => !open && setAgentResultDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{agentResultDialog?.title}</DialogTitle>
            <DialogDescription className="flex items-center gap-2 pt-1">
              {agentResultDialog?.should_alert ? (
                <Badge variant="default" className="text-[10px]">建议关注</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">无需关注</Badge>
              )}
              {agentResultDialog?.notified && <Badge variant="outline" className="text-[10px]">已发送通知</Badge>}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 p-3 bg-accent/30 rounded-lg">
            <pre className="text-[13px] whitespace-pre-wrap font-sans leading-relaxed">{agentResultDialog?.content}</pre>
          </div>
          <div className="flex justify-end mt-2">
            <Button variant="outline" size="sm" onClick={() => setAgentResultDialog(null)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* News dialog */}
      <Dialog open={newsDialogOpen} onOpenChange={setNewsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-blue-500" />
              相关资讯
            </DialogTitle>
            <DialogDescription>
              {newsDialogSymbol ? `${newsDialogSymbol} 的相关新闻和公告` : '自选股相关新闻和公告（近 7 天）'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 flex-wrap py-2 border-b">
            <span className="text-[12px] text-muted-foreground">筛选:</span>
            <button
              onClick={() => { setNewsDialogSymbol(''); loadNews() }}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${!newsDialogSymbol ? 'bg-primary text-primary-foreground' : 'bg-accent/50 text-muted-foreground hover:bg-accent'}`}
            >
              全部
            </button>
            {stocks.slice(0, 10).map(stock => (
              <button
                key={stock.symbol}
                onClick={() => { setNewsDialogSymbol(stock.name); loadNews(stock.name) }}
                className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${newsDialogSymbol === stock.name ? 'bg-primary text-primary-foreground' : 'bg-accent/50 text-muted-foreground hover:bg-accent'}`}
              >
                {stock.name}
              </button>
            ))}
            {stocks.length > 10 && <span className="text-[10px] text-muted-foreground">+{stocks.length - 10}</span>}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 py-2">
            {newsLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="ml-2 text-[13px] text-muted-foreground">加载中...</span>
              </div>
            ) : news.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-[13px]">暂无相关资讯</div>
            ) : (
              <div className="space-y-2">
                {news.map((item, idx) => (
                  <div key={`${item.source}-${item.external_id}-${idx}`} className="p-3 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            item.source === 'eastmoney' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                            item.source === 'eastmoney_news' ? 'bg-blue-500/10 text-blue-500' :
                            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          }`}>{item.source_label}</span>
                          {item.importance >= 2 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500">重要</span>}
                          <span className="text-[10px] text-muted-foreground/60 ml-auto">{new Date(item.publish_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-[13px] text-foreground leading-snug mb-1.5">{item.title}</div>
                        {item.content && item.content !== item.title && (
                          <div className="text-[11px] text-muted-foreground line-clamp-2">{item.content}</div>
                        )}
                        {item.symbols && item.symbols.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {item.symbols.slice(0, 5).map(stockName => (
                              <button
                                key={stockName}
                                onClick={() => { setNewsDialogSymbol(stockName); loadNews(stockName) }}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono hover:bg-primary/20 transition-colors"
                              >
                                {stockName}
                              </button>
                            ))}
                            {item.symbols.length > 5 && <span className="text-[10px] text-muted-foreground">+{item.symbols.length - 5}</span>}
                          </div>
                        )}
                      </div>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 p-1.5 rounded-md hover:bg-accent transition-colors" title="查看原文">
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-[11px] text-muted-foreground">共 {news.length} 条资讯</span>
            <Button variant="secondary" size="sm" onClick={() => loadNews(newsDialogSymbol || undefined)} disabled={newsLoading}>
              <RefreshCw className={`w-3 h-3 ${newsLoading ? 'animate-spin' : ''}`} /> 刷新
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Kline dialog */}
      <KlineSummaryDialog
        open={klineDialogOpen}
        onOpenChange={setKlineDialogOpen}
        symbol={klineDialogSymbol}
        market={klineDialogMarket}
        stockName={klineDialogName}
        initialSummary={klineDialogInitialSummary}
      />

      {/* Stock insight modal */}
      <StockInsightModal
        open={insightOpen}
        onOpenChange={setInsightOpen}
        symbol={insightSymbol}
        market={insightMarket}
        stockName={insightName}
      />
    </div>
  )
}

