from app.main import should_seed_demo_database


def test_demo_seed_is_allowed_in_development_when_database_is_empty():
    assert should_seed_demo_database("development", False) is True
    assert should_seed_demo_database("test", False) is True


def test_demo_seed_is_never_allowed_in_production():
    assert should_seed_demo_database("production", False) is False
    assert should_seed_demo_database("prod", False) is False


def test_demo_seed_does_not_overwrite_existing_data():
    assert should_seed_demo_database("development", True) is False
