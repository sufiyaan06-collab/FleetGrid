from app.config import settings
from app.main import should_disable_legacy_api, should_seed_demo_database


def test_demo_seed_is_allowed_in_development_when_database_is_empty():
    assert should_seed_demo_database("development", False) is True
    assert should_seed_demo_database("test", False) is True


def test_demo_seed_is_never_allowed_in_production():
    assert should_seed_demo_database("production", False) is False
    assert should_seed_demo_database("prod", False) is False


def test_demo_seed_does_not_overwrite_existing_data():
    assert should_seed_demo_database("development", True) is False


def test_auxiliary_api_is_disabled_in_production_unless_explicitly_enabled():
    assert should_disable_legacy_api("production", False) is True
    assert should_disable_legacy_api("prod", False) is True
    assert should_disable_legacy_api("production", True) is False
    assert should_disable_legacy_api("development", False) is False


def test_production_middleware_blocks_legacy_routes_but_keeps_health(client, monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "LEGACY_API_ENABLED", False)

    blocked = client.get("/shipments")
    health = client.get("/health")

    assert blocked.status_code == 410
    assert blocked.json()["code"] == "LEGACY_API_DISABLED"
    assert health.status_code == 200
    health_body = health.json()
    assert health_body["legacy_api_enabled"] is False
    assert health_body["payments"]["real_money_enabled"] is False
