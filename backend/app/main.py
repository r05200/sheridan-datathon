"""FastAPI app. Run: uvicorn app.main:app --reload  (from backend/)"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from .ai import config, explainer, shock_parser
from .finance import engine
from .db.config import BACKUP_SQL, backup_mode, build_url
from .db import (AccountNotFound, DatabaseUnavailable, NoHistory, get_session, load_config, services,
                 session_scope)
from .ai.shock_parser import LIMITS
from .finance.planning import PlanningOptions
from . import insights

app = FastAPI(title="Tangerine resilience engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)
explainer.load_cache()


class OneOffModel(BaseModel):
    label: str = "one-off cost"
    amount_dollars: float | None = Field(None, ge=0, le=shock_parser.MAX_ONE_OFF_DOLLARS)
    multiple_of_monthly_spending: float | None = Field(None, ge=LIMITS["multiple_of_monthly_spending"][0],
                                                       le=LIMITS["multiple_of_monthly_spending"][1])

    @model_validator(mode="after")
    def exactly_one_size(self):
        if (self.amount_dollars is None) == (self.multiple_of_monthly_spending is None):
            raise ValueError("Provide exactly one one-off size: dollars or a spending multiple")
        return self


class RecurringModel(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    monthly_change: float = Field(ge=-1_000_000, le=1_000_000, allow_inf_nan=False)
    source: str = "user_estimate"


class ShockModel(BaseModel):
    """Slider values. Null = unchanged. Ranges enforced here so nothing out of range reaches the engine."""
    income_multiplier: float | None = Field(None, ge=LIMITS["income_multiplier"][0], le=LIMITS["income_multiplier"][1])
    income_duration_months: int | None = Field(None, ge=LIMITS["income_duration_months"][0],
                                               le=LIMITS["income_duration_months"][1])
    household_bills_pct_change: float | None = Field(None, ge=-50, le=200)
    spending_pct_change: float | None = Field(None, ge=-50, le=200)
    one_off_costs: list[OneOffModel] = []

    recurring_costs: list[RecurringModel] = Field(default_factory=list)
    scenario_duration_months: int | None = Field(None, ge=1, le=60)
    overlap_acknowledged: bool = False
    # Stacked scenarios, each applied only for its own duration. One level deep; top-level fields are ignored.
    parts: list[ShockModel] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def parts_not_nested(self):
        if any(p.parts for p in self.parts):
            raise ValueError("Stacked scenarios cannot be nested")
        return self

    def to_engine(self) -> engine.Shock:
        if self.parts:
            return engine.Shock(parts=[p.to_engine() for p in self.parts])
        return engine.Shock(
            self.income_multiplier, self.income_duration_months, self.household_bills_pct_change,
            self.spending_pct_change,
            [engine.OneOffCost(c.label, c.amount_dollars, c.multiple_of_monthly_spending)
             for c in self.one_off_costs],
            recurring_costs=[engine.RecurringCost(c.label, c.monthly_change, c.source) for c in self.recurring_costs],
            scenario_duration_months=self.scenario_duration_months,
            overlap_acknowledged=self.overlap_acknowledged)


class PlanningModel(BaseModel):
    target_months: int = Field(3, ge=1, le=12)
    deadline_months: int = Field(12, ge=1, le=120)
    monthly_contribution: float | None = Field(None, gt=0, le=1_000_000, allow_inf_nan=False)
    confirmed_monthly_cut: float = Field(0, ge=0, le=1_000_000, allow_inf_nan=False)
    confirmed_extra_income: float = Field(0, ge=0, le=1_000_000, allow_inf_nan=False)
    confirmed_upfront_funds: float = Field(0, ge=0, le=1_000_000, allow_inf_nan=False)


class PlanRequest(BaseModel):
    account_id: int
    shock: ShockModel = ShockModel()
    planning: PlanningModel = Field(default_factory=PlanningModel)


class ParseRequest(BaseModel):
    text: str
    account_id: int | None = None      # only used to show dollar amounts; never sent to Gemini


@app.exception_handler(AccountNotFound)
def _not_found(_, e: AccountNotFound):
    return JSONResponse({"detail": str(e)}, status_code=404)


@app.exception_handler(NoHistory)
def _no_history(_, e: NoHistory):
    return JSONResponse({"detail": str(e)}, status_code=422)


@app.exception_handler(DatabaseUnavailable)
def _db_down(_, e: DatabaseUnavailable):
    return JSONResponse({"detail": str(e)}, status_code=503)


def _database_status() -> str:
    if backup_mode():
        return "backup" if BACKUP_SQL.exists() else "backup_missing"
    return "configured" if _database_configured() else "not_configured"


def _database_configured() -> bool:
    try:
        build_url(load_config())      # present and well-formed (does not connect)
        return True
    except DatabaseUnavailable:
        return False


def _without_id(obj) -> dict[str, Any]:
    return {k: v for k, v in asdict(obj).items() if k != "account_id"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "gemini_enabled": not config.gemini_disabled(),
            "gemini_model": config.gemini_model(),
            "gemini_timeout_seconds": config.GEMINI_TIMEOUT_S,
            "database": _database_status()}


@app.get("/api/accounts/{account_id}/baseline")
def baseline(account_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    snap = services.get_account_snapshot(session, account_id)
    payload = {"account_id": account_id, **_without_id(snap.baseline),
               "loan_payment": snap.loan_payment, "flexible_spending": _without_id(snap.flexible)}
    try:
        payload.update(insights.account_insights(account_id, payload))
        return payload
    except insights.InsightsUnavailable as e:
        raise HTTPException(503, str(e)) from None
    except KeyError:
        raise HTTPException(404, f"Account {account_id} not found in historical insight data") from None


@app.post("/api/plan")
def plan(req: PlanRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Numbers only (fast). The UI shows these first, then calls /api/explain."""
    try:
        result = engine.plan_for_account(
            session, req.account_id, req.shock.to_engine(), PlanningOptions(**req.planning.model_dump())
        )
        result["account_context"] = insights.plan_context(req.account_id, result["baseline"])
        return result
    except ValueError as e:
        raise HTTPException(422, str(e))
    except insights.InsightsUnavailable as e:
        raise HTTPException(503, str(e)) from None


@app.post("/api/explain")
def explain(plan_json: dict[str, Any]) -> dict[str, str]:
    """Body: the plan JSON returned by /api/plan. Always returns text (template if Gemini fails)."""
    if "baseline" not in plan_json or "after_shock" not in plan_json:
        raise HTTPException(422, "body must be a plan from /api/plan")
    return explainer.explain_plan({k: v for k, v in plan_json.items() if k != "action_plan"})


@app.post("/api/parse-shock")
def parse_shock(req: ParseRequest) -> dict[str, Any]:
    base = None
    if req.account_id is not None:
        # Session opened only when needed, so parsing still works with no database configured.
        with session_scope() as session:
            base = _without_id(services.get_account_baseline(session, req.account_id))
    return shock_parser.parse_shock(req.text, base)


class ResolveRequest(BaseModel):
    account_id: int
    draft: shock_parser.ParsedShockSchema
    category_amounts: dict[str, float] = Field(default_factory=dict)
    duration_months: int | None = Field(None, ge=1, le=60)
    income_replacement_pct: float | None = Field(None, ge=0, le=150, allow_inf_nan=False)
    overlap_acknowledged: bool = False


@app.post("/api/resolve-shock")
def resolve_shock(req: ResolveRequest, session: Session = Depends(get_session)):
    base = _without_id(services.get_account_baseline(session, req.account_id))
    try:
        return shock_parser.resolve_draft(req.draft, base, req.category_amounts,
                                          req.duration_months, req.overlap_acknowledged, req.income_replacement_pct)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/accounts")
def accounts(session: Session = Depends(get_session)):
    return {"account_ids": sorted(services.get_all_baselines(session))}


@app.get("/api/tangerine/accounts")
def tangerine_accounts(filter: str = "all") -> dict[str, Any]:
    try:
        return insights.account_directory(filter)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    except insights.InsightsUnavailable as e:
        raise HTTPException(503, str(e)) from None


@app.get("/api/tangerine/portfolio")
def tangerine_portfolio(session: Session = Depends(get_session)) -> dict[str, Any]:
    baselines = services.get_all_baselines(session)
    return insights.portfolio_summary({
        account_id: asdict(baseline) for account_id, baseline in baselines.items()
    })


@app.get("/api/tangerine/spotlights")
def tangerine_spotlights() -> dict[str, Any]:
    try:
        return insights.spotlight_snapshots()
    except insights.InsightsUnavailable as e:
        raise HTTPException(503, str(e)) from None


# Built React app (npm run build -> frontend/dist). Mounted last so every /api route above wins.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (FRONTEND_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    @app.get("/", include_in_schema=False)
    def frontend_not_built():
        return HTMLResponse("<p>Frontend not built. Run <code>npm run build</code> from the repository root, "
                            "or <code>npm start</code> and open http://localhost:5173.</p>")
