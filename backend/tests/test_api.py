from fastapi.testclient import TestClient

from app.main import create_app

client = TestClient(create_app())


def test_health_check() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_change_revision_is_lightweight_and_monotonic() -> None:
    first = client.get("/api/v1/change-revision")
    second = client.get("/api/v1/change-revision")

    assert first.status_code == 200
    assert second.status_code == 200
    assert isinstance(first.json()["revision"], int)
    assert second.json()["revision"] >= first.json()["revision"]


def test_app_info_lists_initial_modules() -> None:
    response = client.get("/api/v1/app")

    assert response.status_code == 200
    assert "planning" in response.json()["modules"]


def test_capabilities_cover_legacy_domains() -> None:
    response = client.get("/api/v1/capabilities")

    assert response.status_code == 200
    modules = {capability["module"] for capability in response.json()}
    assert {"identity", "planning", "music", "people", "library", "presentation"} <= modules
