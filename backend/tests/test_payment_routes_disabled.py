def test_legacy_payment_creation_is_disabled(client):
    response = client.post("/payments/create", json={
        "shipment_id": "SHP-TEST-001",
        "amount": 1.0,
        "currency": "USD",
        "provider": "Dodo Payments",
    })
    assert response.status_code == 410
    assert "disabled" in response.json()["detail"].lower()


def test_legacy_payment_lookup_is_disabled(client):
    response = client.get("/payments/PAY-TEST-001")
    assert response.status_code == 410


def test_legacy_dodo_webhook_routes_are_disabled(client):
    payload = {
        "event_type": "payment.succeeded",
        "payment_id": "PAY-FORGED",
        "status": "PAID",
        "provider_reference": "forged-reference",
    }
    router_response = client.post("/payments/webhook/dodo", json=payload)
    webhook_response = client.post("/webhooks/dodo", json=payload)
    assert router_response.status_code == 410
    assert webhook_response.status_code == 410
