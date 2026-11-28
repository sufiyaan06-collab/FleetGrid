from datetime import datetime
from fastapi import APIRouter
from app.config import settings
from app.database import test_connection

router = APIRouter(tags=["Health"])

@router.get("/health")
def health_check():
    db_ok = test_connection()
    return {
        "status": "HEALTHY" if db_ok else "DEGRADED",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "timestamp": datetime.utcnow().isoformat(),
        "environment": settings.ENVIRONMENT,
        "legacy_api_enabled": settings.LEGACY_API_ENABLED,
        "demo_seeding_enabled": settings.ENVIRONMENT.strip().lower() not in {"production", "prod"},
        "payments": {"mode": "DISABLED_IN_LEGACY_API", "real_money_enabled": False},
        "database": {
            "type": "PostgreSQL" if settings.is_postgres else "SQLite",
            "connected": db_ok,
        }
    }
