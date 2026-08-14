from app.modules.planning.routes import _merge_worship_roles


def test_inferred_worship_role_is_additive() -> None:
    assert _merge_worship_roles("middle,response", "opener") == "middle,response,opener"


def test_inferred_worship_role_replaces_generic_any_value() -> None:
    assert _merge_worship_roles("any", "closer") == "closer"


def test_inferred_worship_role_is_not_duplicated() -> None:
    assert _merge_worship_roles("opener,middle", "middle") == "opener,middle"
