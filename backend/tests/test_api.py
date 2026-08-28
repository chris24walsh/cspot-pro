from fastapi.testclient import TestClient

from app.main import create_app

app = create_app()


@app.patch("/api/v1/planning/test-change-revision")
def planning_mutation_probe() -> dict[str, str]:
    return {"status": "ok"}


client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_change_revision_is_lightweight_and_domain_specific() -> None:
    first = client.get("/api/v1/change-revision")
    mutation = client.patch("/api/v1/planning/test-change-revision")
    second = client.get("/api/v1/change-revision")

    assert first.status_code == 200
    assert mutation.status_code == 200
    assert second.status_code == 200
    assert set(first.json()["revisions"]) == {"planning", "music", "identity"}
    assert second.json()["revisions"]["planning"] > first.json()["revisions"]["planning"]
    assert second.json()["revisions"]["music"] == first.json()["revisions"]["music"]
    assert second.json()["revisions"]["identity"] == first.json()["revisions"]["identity"]


def test_app_info_lists_initial_modules() -> None:
    response = client.get("/api/v1/app")

    assert response.status_code == 200
    assert "planning" in response.json()["modules"]


def test_capabilities_cover_legacy_domains() -> None:
    response = client.get("/api/v1/capabilities")

    assert response.status_code == 200
    modules = {capability["module"] for capability in response.json()}
    assert {"identity", "planning", "music", "people", "library", "presentation"} <= modules
