import {
  CalendarDays,
  BookOpen,
  Clapperboard,
  Globe2,
  ListMusic,
  LogOut,
  Music2,
  Radio,
  Settings,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AUTH_REQUIRED_EVENT,
  ApiError,
  getBootstrapStatus,
  getPlan,
  getPlans,
  getSessionUser,
  getSongs,
  logout,
  type PlanDetail,
  type PlanSummary,
  type SessionUser,
  type Song,
} from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { BroadcastManager } from "./components/BroadcastManager";
import { PresentationOutput } from "./components/PresentationOutput";
import { PresentationView } from "./components/PresentationView";
import { ServiceBroadcastView } from "./components/ServiceBroadcastView";
import { SundaySchoolView } from "./components/SundaySchoolView";
import { UserManager } from "./components/UserManager";
import { WorshipBuilderView } from "./components/WorshipBuilderView";
import { featureModules, type FeatureModule, type ModuleId } from "./data/featureMap";
import { appAssetUrl } from "./paths";
import { ToastViewport } from "./toast";

const iconMap = {
  planning: CalendarDays,
  music: ListMusic,
  worship: Music2,
  sunday_school: BookOpen,
  broadcast: Radio,
  people: UsersRound,
  presentation: Clapperboard,
  imports: UploadCloud,
  admin: Settings,
} satisfies Record<ModuleId, typeof CalendarDays>;

interface ApiWorkspace {
  live: boolean;
  plans: PlanSummary[];
  selectedPlan: PlanDetail | null;
  songs: Song[];
}

interface HeaderStat {
  label: string;
  value: string;
}

function isTransientApiError(error: unknown) {
  return error instanceof ApiError && [408, 502, 503, 504].includes(error.status);
}

function App() {
  const initialParams = new URLSearchParams(window.location.search);
  const isPresentationOutput = initialParams.get("presentation") === "output";
  const publicWebsiteUrl = import.meta.env.VITE_PUBLIC_WEBSITE_URL || "/";
  const [activeModuleId, setActiveModuleId] = useState<ModuleId>("presentation");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspace, setWorkspace] = useState<ApiWorkspace>({
    live: false,
    plans: [],
    selectedPlan: null,
    songs: [],
  });
  const [broadcastMode, setBroadcastMode] = useState<"control" | "viewer">("viewer");

  const permissions = useMemo(() => new Set(sessionUser?.permissions ?? []), [sessionUser]);
  const roleNames = useMemo(() => new Set(sessionUser?.roles ?? []), [sessionUser?.roles]);
  const isAdmin = roleNames.has("administrator");
  const isViewer = roleNames.has("viewer");
  const isMusician = roleNames.has("musician");
  const isWorshipLeader = roleNames.has("worship_leader");
  const isSundaySchoolTeacher = roleNames.has("sunday_school_teacher");
  const isSundaySchoolLeader = roleNames.has("sunday_school_leader");
  const isTeacher = roleNames.has("teacher");
  const isPresenter = roleNames.has("presenter");
  const canManageUsers = permissions.has("users:manage");
  const canCreatePlans = permissions.has("plans:create");
  const canDeletePlans = permissions.has("plans:delete");
  const canEditPlans = canCreatePlans || permissions.has("plans:edit");
  const canReadSongs = permissions.has("songs:read");
  const canCreateSongs = permissions.has("songs:create");
  const canDeleteSongs = permissions.has("songs:delete");
  const canEditSongs = canCreateSongs || permissions.has("songs:edit");
  const canUsePresentation = permissions.has("presentation:use");
  const canUseBroadcast = permissions.has("broadcast:use");
  const canWatchBroadcast = isViewer || isAdmin || canUseBroadcast;
  const canCreateLibrary = permissions.has("library:create");
  const canUseServiceOperator = canUsePresentation && (isAdmin || isTeacher || isPresenter);
  const canUseWorshipTools = canReadSongs && (isAdmin || isMusician || isWorshipLeader);
  const canUseSundaySchool = isAdmin || isSundaySchoolTeacher || isSundaySchoolLeader;
  const canEditSlideNotes = isTeacher;

  const loadAuth = useCallback(async () => {
    setAuthLoading(true);

    try {
      const user = await getSessionUser();
      setSessionUser(user);
      setBootstrapAvailable(false);
    } catch {
      setSessionUser(null);
      try {
        const bootstrap = await getBootstrapStatus();
        setBootstrapAvailable(bootstrap.available);
      } catch {
        setBootstrapAvailable(false);
      }
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!sessionUser) {
      setWorkspace({ live: false, plans: [], selectedPlan: null, songs: [] });
      return;
    }

    try {
      const [plans, songs] = await Promise.all([getPlans(), getSongs()]);
      const selectedPlan = plans[0] ? await getPlan(plans[0].id) : null;
      setWorkspace({ live: true, plans, selectedPlan, songs });
    } catch (error) {
      setWorkspace((current) =>
        isTransientApiError(error) && current.live
          ? current
          : { live: false, plans: [], selectedPlan: null, songs: [] },
      );
    }
  }, [sessionUser]);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    function handleAuthRequired() {
      void loadAuth();
    }

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, [loadAuth]);

  const modules = useMemo(
    () =>
      featureModules.map((module) => {
        if (module.id === "planning" && workspace.live) {
          return {
            ...module,
            metrics: [
              { label: "Plans", value: String(workspace.plans.length) },
              { label: "Current items", value: String(workspace.selectedPlan?.items.length ?? 0) },
              { label: "Source", value: "Live API" },
            ],
          };
        }

        return module;
      }).filter((module) => {
        if (module.id === "planning" || module.id === "people" || module.id === "imports") {
          return false;
        }
        if (module.id === "worship") {
          return canUseWorshipTools;
        }
        if (module.id === "sunday_school") {
          return canUseSundaySchool;
        }
        if (module.id === "presentation") {
          return canUseServiceOperator;
        }
        if (module.id === "broadcast") {
          return canWatchBroadcast;
        }
        if (module.id === "admin") {
          return canManageUsers;
        }
        return true;
      }),
    [canManageUsers, canUseServiceOperator, canUseSundaySchool, canUseWorshipTools, canWatchBroadcast, workspace],
  );

  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) ?? modules[0],
    [activeModuleId, modules],
  );
  const headerStats = useMemo<HeaderStat[]>(() => {
    if (!activeModule) {
      return [];
    }

    if (activeModule.id === "presentation") {
      return [];
    }

    if (activeModule.id === "worship") {
      return [
        { label: "Services", value: String(workspace.plans.length) },
        { label: "Songs", value: String(workspace.songs.length) },
      ];
    }

    if (activeModule.id === "admin") {
      return [{ label: "Scope", value: "Users & access" }];
    }

    return [];
  }, [activeModule, workspace]);
  const compactWorkspace = true;

  useEffect(() => {
    if (!modules.some((module) => module.id === activeModuleId) && modules[0]) {
      setActiveModuleId(modules[0].id);
    }
  }, [activeModuleId, modules]);

  useEffect(() => {
    if (sessionUser && canWatchBroadcast && !canUsePresentation && modules.some((module) => module.id === "broadcast")) {
      setActiveModuleId("broadcast");
    }
  }, [canUsePresentation, canWatchBroadcast, modules, sessionUser]);

  useEffect(() => {
    if (!sessionUser || !canManageUsers || !modules.some((module) => module.id === "admin")) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has("googleDrive")) {
      setActiveModuleId("admin");
    }
  }, [canManageUsers, modules, sessionUser]);

  if (isPresentationOutput) {
    return <PresentationOutput />;
  }

  if (authLoading) {
    return <main className="auth-shell"><section className="auth-card"><p>Loading cspot-pro...</p></section></main>;
  }

  if (!sessionUser) {
    return <AuthScreen bootstrapAvailable={bootstrapAvailable} onAuthenticated={setSessionUser} />;
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      setSessionUser(null);
      setWorkspace({ live: false, plans: [], selectedPlan: null, songs: [] });
      void loadAuth();
    }
  }

  return (
    <main className="shell">
      <ToastViewport />
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <img alt="" src={appAssetUrl("images/cspot.png")} />
          <span>cspot-pro</span>
        </div>

        <nav className="nav-list">
          <a className="nav-item" href={publicWebsiteUrl} title="Website">
            <Globe2 size={18} aria-hidden="true" />
            <span>Website</span>
          </a>
          {modules.map((module) => {
            const Icon = iconMap[module.id];
            return (
              <button
                className={`nav-item ${module.id === activeModule.id ? "active" : ""}`}
                key={module.id}
                onClick={() => setActiveModuleId(module.id)}
                title={module.kicker}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{module.label}</span>
              </button>
            );
          })}
          <button className="nav-item" onClick={() => void signOut()} title="Sign out" type="button">
            <LogOut size={18} aria-hidden="true" />
            <span>{sessionUser.name} · Sign out</span>
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className={`topbar topbar-${activeModule.id} ${compactWorkspace ? "topbar-compact" : ""}`}>
          <div className="title-lockup">
            <p className="eyebrow">{activeModule.kicker}</p>
            <h1>{activeModule.label}</h1>
          </div>
          <div className="topbar-context-slot" id="workspace-topbar-slot" />
          <div className="topbar-actions">
            {headerStats.map((stat) => (
              <div className="topbar-stat" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </header>

        {activeModule.id === "broadcast" && canUseBroadcast && canWatchBroadcast ? (
          <div className="broadcast-mode-switch segmented-control" role="tablist" aria-label="Broadcast mode">
            <button
              className={broadcastMode === "viewer" ? "is-active" : ""}
              onClick={() => setBroadcastMode("viewer")}
              type="button"
            >
              Viewer
            </button>
            <button
              className={broadcastMode === "control" ? "is-active" : ""}
              onClick={() => setBroadcastMode("control")}
              type="button"
            >
              Settings
            </button>
          </div>
        ) : null}

        {activeModule.id === "worship" ? (
          <WorshipBuilderView
            canAccessAdminTools={canManageUsers}
            canArchiveSong={canDeleteSongs}
            canCreateSong={canCreateSongs}
            canDeletePlan={canDeletePlans}
            canEditSong={canEditSongs}
            canEditPlan={canEditPlans}
          />
        ) : activeModule.id === "sunday_school" ? (
          <SundaySchoolView canEdit={canEditPlans || canCreatePlans} />
        ) : activeModule.id === "presentation" ? (
          <PresentationView
            canAttachDeck={canEditPlans && canCreateLibrary}
            canCreatePlan={canCreatePlans}
            canDeletePlan={canDeletePlans}
            canEditPlan={canEditPlans}
            canCreateSong={canCreateSongs}
            canEditSong={canEditSongs}
            canEditSlideNotes={canEditSlideNotes}
          />
        ) : activeModule.id === "broadcast" ? (
          canUseBroadcast && broadcastMode === "control" ? (
            <BroadcastManager />
          ) : canWatchBroadcast ? (
            <ServiceBroadcastView />
          ) : (
            <section className="empty-state" aria-label="Broadcast access restricted">
              <h2>Broadcast viewer access is restricted</h2>
              <p>This remote service view is temporarily limited to accounts with the viewer role.</p>
            </section>
          )
        ) : activeModule.id === "admin" ? (
          <UserManager />
        ) : (
          <PresentationView
            canAttachDeck={canEditPlans && canCreateLibrary}
            canCreatePlan={canCreatePlans}
            canDeletePlan={canDeletePlans}
            canEditPlan={canEditPlans}
            canCreateSong={canCreateSongs}
            canEditSong={canEditSongs}
            canEditSlideNotes={canEditSlideNotes}
          />
        )}
      </section>
    </main>
  );
}

export default App;
