// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DelegatedManagement } from "./DelegatedManagement";
import { ServingManagementGrants } from "./ServingManagementGrants";
import { approveSelfRegistration, getPendingRegistrations, getServingManagement, getUsers, getRoles, getVolunteerAdminRecords, getManagedServingAreas, setManagedServingAreas, type SessionUser, type ServingArea, type User } from "../api";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  getPendingRegistrations: vi.fn(), getServingManagement: vi.fn(), getUsers: vi.fn(), getRoles: vi.fn(), getVolunteerAdminRecords: vi.fn(), approveSelfRegistration: vi.fn(), getManagedServingAreas: vi.fn(), setManagedServingAreas: vi.fn(),
}));

const area: ServingArea = { id: "chores", key: "chores", name: "Chores", category: "Practical", description: "Weekly chores", assignment_interval: "weekly", legacy_role_name: null };
const pending = { id: "new", name: "New Member", email: "new@example.com", email_confirmed: true, registration_pending: true } as User;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  vi.mocked(getPendingRegistrations).mockResolvedValue([pending]);
  vi.mocked(getServingManagement).mockResolvedValue({ areas: [area], members: [{ id: "member", name: "Member", direct_area_keys: [] }] });
  vi.mocked(getVolunteerAdminRecords).mockResolvedValue([]);
  vi.mocked(getUsers).mockResolvedValue([]);
  vi.mocked(getRoles).mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("loads only registrations for approval-only access and submits approval", async () => {
  vi.mocked(approveSelfRegistration).mockResolvedValue({ ...pending, registration_pending: false });
  await act(async () => root.render(<DelegatedManagement sessionUser={{ permissions: ["users:approve"] } as SessionUser} />));
  expect(getUsers).not.toHaveBeenCalled();
  expect(getServingManagement).not.toHaveBeenCalled();
  expect(host.textContent).toContain("New Member");
  expect(host.textContent).not.toContain("Invite user");
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))!.click());
  expect(approveSelfRegistration).toHaveBeenCalledWith("new");
  expect(host.textContent).toContain("Registration approved.");
});

it("loads scoped teams without fetching global accounts or registrations", async () => {
  await act(async () => root.render(<DelegatedManagement sessionUser={{ permissions: ["serving:manage"] } as SessionUser} />));
  expect(getServingManagement).toHaveBeenCalled();
  expect(getVolunteerAdminRecords).toHaveBeenCalled();
  expect(getUsers).not.toHaveBeenCalled();
  expect(getPendingRegistrations).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Practical · Chores");
  expect(host.textContent).not.toContain("Users & approvals");
});

it("preserves existing management scopes when adding another role", async () => {
  vi.mocked(getManagedServingAreas).mockResolvedValue(["welcome"]);
  vi.mocked(setManagedServingAreas).mockResolvedValue(["welcome", "chores"]);
  await act(async () => root.render(<ServingManagementGrants userId="manager" areas={[area]} />));
  await act(async () => host.querySelector<HTMLInputElement>("input[type='checkbox']")!.click());
  expect(setManagedServingAreas).toHaveBeenCalledWith("manager", ["welcome", "chores"]);
});

it("keeps management grant controls disabled when existing grants cannot be loaded", async () => {
  vi.mocked(getManagedServingAreas).mockRejectedValue(new Error("Cannot load grants"));
  await act(async () => root.render(<ServingManagementGrants userId="manager" areas={[area]} />));
  expect(host.querySelector<HTMLInputElement>("input[type='checkbox']")!.disabled).toBe(true);
  expect(host.textContent).toContain("Cannot load grants");
  expect(setManagedServingAreas).not.toHaveBeenCalled();
});

it("opens an emailed serving link on the requested member and team", async () => {
  vi.mocked(getServingManagement).mockResolvedValue({
    areas: [area, { ...area, id: "welcome", key: "welcome", name: "Welcome" }],
    members: [{ id: "member", name: "Member", direct_area_keys: [] }, { id: "other", name: "Other Member", direct_area_keys: [] }],
  });
  await act(async () => root.render(<DelegatedManagement initialUserId="other" initialAreaKey="welcome" sessionUser={{ permissions: ["users:admin", "users:approve", "serving:manage"] } as SessionUser} />));
  expect(host.textContent).toContain("Team management");
  expect(host.textContent).not.toContain("Registration approvals");
  expect([...host.querySelectorAll("select")].map((select) => select.value)).toEqual(["welcome", "other"]);
});
