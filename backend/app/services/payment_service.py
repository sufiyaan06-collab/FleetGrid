"""Deprecated legacy payment service.

All public routes in the auxiliary Python API return HTTP 410. This module is
kept only to make accidental imports fail loudly; it must not create payment
records, fabricate provider references, or confirm shipment payments.
"""

from typing import Optional
from sqlalchemy.orm import Session


def create_payment(
    db: Session,
    amount: float,
    currency: str = "INR",
    shipment_id: Optional[str] = None,
    recovery_plan_id: Optional[str] = None,
    provider: str = "DISABLED",
):
    raise RuntimeError(
        "Legacy Python payment processing is disabled. Use the Node application's DEMO_ONLY simulator."
    )


def process_payment_confirmation(
    db: Session,
    payment_id: str,
    status: str = "PAID",
    provider_reference: Optional[str] = None,
):
    raise RuntimeError(
        "Legacy Python payment confirmation is disabled. Provider webhooks are not accepted."
    )
