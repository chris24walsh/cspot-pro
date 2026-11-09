// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RemoteContributionPanel } from "./RemoteContributionPanel";
const { request } = vi.hoisted(() => ({request: vi.fn()}));
vi.mock("../remoteContribution", () => ({contributionRequest: request, receiveContribution: vi.fn()}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("lists service-user cameras and operates on-air without invitation controls", async () => {
  const data={ice_servers:[], guests:[
    {id:"owned",label:"Teacher",self_managed:true,connected:true,live:false},
    {id:"old-invite",label:"Legacy invitation",connected:true,live:false},
  ]};
  request.mockResolvedValue(data);
  const host=document.createElement("div"); document.body.append(host);
  const root=createRoot(host);
  try {
    await act(async () => root.render(<RemoteContributionPanel/>));
    expect(host.textContent).toContain("Teacher");
    expect(host.textContent).not.toContain("Legacy invitation");
    expect(host.textContent).not.toContain("Create invitation");
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Bring on air"))!.click());
    expect(request).toHaveBeenCalledWith("/owned/on-air", "POST", {live:true});
    data.guests[0].live=true;
    await act(async () => root.render(<RemoteContributionPanel/>));
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Take off air"))!.click());
    expect(request).toHaveBeenCalledWith("/owned/on-air", "POST", {live:false});
  } finally {await act(async () => root.unmount()); host.remove();}
});
