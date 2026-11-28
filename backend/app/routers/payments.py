from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/payments", tags=["Payments"])
webhook_router = APIRouter(tags=["Webhooks"])

_DISABLED_DETAIL = (
    "Payment processing is disabled in the legacy Python API. "
    "Use the FleetGrid Node application's clearly labelled demo simulator; "
    "no real-money shipment payments or provider webhooks are supported here."
)

@router.post("/create")
def disabled_payment_creation():
    raise HTTPException(status_code=410, detail=_DISABLED_DETAIL)

@router.get("/{payment_id}")
def disabled_payment_lookup(payment_id: str):
    raise HTTPException(status_code=410, detail=_DISABLED_DETAIL)

@router.post("/webhook/dodo")
@webhook_router.post("/webhooks/dodo")
def disabled_dodo_webhook():
    raise HTTPException(status_code=410, detail=_DISABLED_DETAIL)
