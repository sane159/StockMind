from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.web.database import get_db
from src.web.models import PaperTradingAccount, PaperTradingPosition, Stock
from src.collectors.akshare_collector import _tencent_symbol, _fetch_tencent_quotes
from src.models.market import MarketCode

router = APIRouter()


class PositionCreate(BaseModel):
    symbol: str
    market: str = "CN"
    name: str = ""
    quantity: int
    entry_price: float
    stop_loss: float | None = None
    target_price: float | None = None


class PositionUpdate(BaseModel):
    quantity: int | None = None
    entry_price: float | None = None
    stop_loss: float | None = None
    target_price: float | None = None


def _get_or_create_account(db: Session) -> PaperTradingAccount:
    account = db.query(PaperTradingAccount).first()
    if not account:
        account = PaperTradingAccount(
            initial_capital=1_000_000.0,
            current_capital=1_000_000.0,
        )
        db.add(account)
        db.commit()
        db.refresh(account)
    return account


def _position_to_dict(pos: PaperTradingPosition, current_price: float | None = None) -> dict:
    cost = pos.entry_price * pos.quantity
    market_value = (current_price * pos.quantity) if current_price is not None else None
    pnl = (market_value - cost) if market_value is not None else None
    pnl_pct = (pnl / cost * 100) if (pnl is not None and cost > 0) else None
    return {
        "id": pos.id,
        "symbol": pos.stock_symbol,
        "market": pos.stock_market,
        "name": pos.stock_name,
        "quantity": pos.quantity,
        "cost_price": pos.entry_price,
        "stop_loss": pos.stop_loss,
        "target_price": pos.target_price,
        "current_price": current_price,
        "market_value_cny": market_value,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "status": pos.status,
        "opened_at": pos.opened_at.isoformat() if pos.opened_at else None,
    }


@router.get("/summary")
def get_portfolio_summary(
    include_quotes: bool = False,
    db: Session = Depends(get_db),
):
    account = _get_or_create_account(db)
    positions = (
        db.query(PaperTradingPosition)
        .filter(PaperTradingPosition.status == "open")
        .all()
    )

    price_map: dict[str, float] = {}
    if include_quotes and positions:
        try:
            tencent_symbols = [_tencent_symbol(p.stock_symbol) for p in positions]
            items = _fetch_tencent_quotes(tencent_symbols)
            for item in items:
                price_map[f"{item.get('market', 'CN')}:{item['symbol']}"] = item.get("current_price") or 0
        except Exception:
            pass

    pos_dicts = []
    total_cost = 0.0
    total_market_value = 0.0

    for pos in positions:
        key = f"{pos.stock_market}:{pos.stock_symbol}"
        cp = price_map.get(key)
        d = _position_to_dict(pos, cp)
        pos_dicts.append(d)
        total_cost += pos.entry_price * pos.quantity
        if cp is not None:
            total_market_value += cp * pos.quantity
        else:
            total_market_value += pos.entry_price * pos.quantity

    total_pnl = total_market_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0.0

    watchlist_count = db.query(Stock).count()

    return {
        "accounts": [
            {
                "id": account.id,
                "name": "模拟盘",
                "available_funds": account.current_capital,
                "total_cost": round(total_cost, 2),
                "total_market_value": round(total_market_value, 2),
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round(total_pnl_pct, 2),
                "total_assets": round(total_market_value + account.current_capital, 2),
                "positions": pos_dicts,
            }
        ],
        "total": {
            "total_market_value": round(total_market_value, 2),
            "total_cost": round(total_cost, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl_pct, 2),
            "available_funds": round(account.current_capital, 2),
            "total_assets": round(total_market_value + account.current_capital, 2),
        },
        "portfolio": {
            "positions_count": len(positions),
            "watchlist_count": watchlist_count,
            "available_funds": round(account.current_capital, 2),
            "invested_cost": round(total_cost, 2),
            "by_market": _group_by_market(positions),
        },
    }


def _group_by_market(positions: list[PaperTradingPosition]) -> list[dict]:
    groups: dict[str, dict] = {}
    for pos in positions:
        m = pos.stock_market
        if m not in groups:
            groups[m] = {"market": m, "positions": 0, "invested_cost": 0.0}
        groups[m]["positions"] += 1
        groups[m]["invested_cost"] += pos.entry_price * pos.quantity
    for g in groups.values():
        g["invested_cost"] = round(g["invested_cost"], 2)
    return list(groups.values())


@router.get("/positions")
def list_positions(db: Session = Depends(get_db)):
    positions = (
        db.query(PaperTradingPosition)
        .filter(PaperTradingPosition.status == "open")
        .all()
    )
    return [_position_to_dict(p) for p in positions]


@router.post("/positions")
def create_position(payload: PositionCreate, db: Session = Depends(get_db)):
    existing = (
        db.query(PaperTradingPosition)
        .filter(
            PaperTradingPosition.stock_symbol == payload.symbol,
            PaperTradingPosition.stock_market == payload.market,
            PaperTradingPosition.status == "open",
        )
        .first()
    )
    if existing:
        raise HTTPException(400, f"已存在 {payload.symbol} 的持仓，请先删除或修改现有持仓")

    pos = PaperTradingPosition(
        stock_symbol=payload.symbol,
        stock_market=payload.market,
        stock_name=payload.name,
        quantity=payload.quantity,
        entry_price=payload.entry_price,
        stop_loss=payload.stop_loss,
        target_price=payload.target_price,
        status="open",
    )
    db.add(pos)
    db.commit()
    db.refresh(pos)
    return _position_to_dict(pos)


@router.put("/positions/{position_id}")
def update_position(
    position_id: int,
    payload: PositionUpdate,
    db: Session = Depends(get_db),
):
    pos = db.query(PaperTradingPosition).filter(PaperTradingPosition.id == position_id).first()
    if not pos:
        raise HTTPException(404, "持仓不存在")
    if payload.quantity is not None:
        pos.quantity = payload.quantity
    if payload.entry_price is not None:
        pos.entry_price = payload.entry_price
    if payload.stop_loss is not None:
        pos.stop_loss = payload.stop_loss
    if payload.target_price is not None:
        pos.target_price = payload.target_price
    db.commit()
    db.refresh(pos)
    return _position_to_dict(pos)


@router.delete("/positions/{position_id}")
def delete_position(position_id: int, db: Session = Depends(get_db)):
    pos = db.query(PaperTradingPosition).filter(PaperTradingPosition.id == position_id).first()
    if not pos:
        raise HTTPException(404, "持仓不存在")
    db.delete(pos)
    db.commit()
    return {"ok": True}
