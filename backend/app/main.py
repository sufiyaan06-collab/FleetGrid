from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal
from app.models.truck import Truck
from app.services.seed_service import seed_demo_database

def should_seed_demo_database(environment: str, has_trucks: bool) -> bool:
    """Demo fixtures are allowed only outside production and only on an empty DB."""
    return environment.strip().lower() not in {"production", "prod"} and not has_trucks


from app.routers import (
    auth_router,
    org_router,
    trucks_router,
    shipments_router,
    capacity_router,
    payments_router,
    webhook_router,
    incidents_router,
    recovery_router,
    events_router,
    proof_router,
    demo_router,
    health_router,
    ws_router,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tables are managed by Alembic. Demo fixtures are strictly development/test only.
    # Never populate a production database with deterministic sample identities or freight.
    try:
        db = SessionLocal()
        try:
            existing_truck = db.query(Truck).first()
            if should_seed_demo_database(settings.ENVIRONMENT, existing_truck is not None):
                seed_demo_database(db)
        finally:
            db.close()
    except Exception:
        # Tables may not exist yet (first deploy before migration) — skip seeding.
        pass

    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Authoritative backend and agent coordination engine for FleetGrid Logistics Network.",
    lifespan=lifespan
)

# CORS — supports explicit origin list or open wildcard.
# Browser spec forbids allow_credentials=True with allow_origins=["*"].
_wildcard_cors = "*" in settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _wildcard_cors else settings.CORS_ORIGINS,
    allow_credentials=not _wildcard_cors,  # credentials not allowed with wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(org_router)
app.include_router(trucks_router)
app.include_router(shipments_router)
app.include_router(capacity_router)
app.include_router(payments_router)
app.include_router(webhook_router)
app.include_router(incidents_router)
app.include_router(recovery_router)
app.include_router(events_router)
app.include_router(proof_router)
app.include_router(demo_router)
app.include_router(ws_router)

@app.get("/")
def root():
    return {
        "project": "FleetGrid Logistics Network",
        "authoritative_backend": True,
        "docs_url": "/docs",
        "health_url": "/health",
        "status": "ONLINE"
    }
