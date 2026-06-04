import {
  CalendarDays,
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
import { ChurchWebsite } from "./components/ChurchWebsite";
import { PresentationOutput } from "./components/PresentationOutput";
import { PresentationView } from "./components/PresentationView";
import { UserManager } from "./components/UserManager";
import { WorshipBuilderView } from "./components/WorshipBuilderView";
import { featureModules, type FeatureModule, type ModuleId } from "./data/featureMap";
import { appAssetUrl } from "./paths";
import { ToastViewport } from "./toast";

const iconMap = {
  planning: CalendarDays,
  music: ListMusic,
  worship: Music2,
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
  const isPresentationOutput = new URLSearchParams(window.location.search).get("presentation") === "output";
  const publicSiteEnabled = import.meta.env.VITE_PUBLIC_SITE_ENABLED === "true";
  const isMemberApp = !publicSiteEnabled || window.location.pathname.startsWith("/app");
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

  const permissions = useMemo(() => new Set(sessionUser?.permissions ?? []), [sessionUser]);
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
  const canCreateLibrary = permissions.has("library:create");
  const roleNames = useMemo(() => new Set(sessionUser?.roles ?? []), [sessionUser?.roles]);
  const canUseServiceOperator =
    canUsePresentation &&
    (roleNames.has("administrator") || roleNames.has("service_leader") || roleNames.has("worship_leader"));
  const canUseWorshipTools = canReadSongs && permissions.has("plans:read");

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
        if (module.id === "presentation") {
          return canUseServiceOperator;
        }
        if (module.id === "broadcast") {
          return canUseBroadcast;
        }
        if (module.id === "admin") {
          return canManageUsers;
        }
        return true;
      }),
    [canManageUsers, canUseBroadcast, canUseServiceOperator, canUseWorshipTools, workspace],
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
        {
          label: "Ready",
          value: String(workspace.songs.filter((song) => song.lyrics_status === "available").length),
        },
      ];
    }

    if (activeModule.id === "admin") {
      return [{ label: "Scope", value: "Users & access" }];
    }

    if (activeModule.id === "broadcast") {
      return [{ label: "Mode", value: "OBS" }];
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

  if (publicSiteEnabled && !isMemberApp) {
    return <ChurchWebsite />;
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
          <img alt="" src={appAssetUrl("images/xs-cspot.png")} />
          <span>cspot-pro</span>
        </div>

        <nav className="nav-list">
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
            <a className="topbar-link-pill" href="/">
              <Globe2 size={15} aria-hidden="true" />
              <span>Website</span>
            </a>
            <button className="user-pill" onClick={() => void signOut()} type="button">
              <strong>{sessionUser.name}</strong>
              <span>Sign out</span>
              <LogOut size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {activeModule.id === "worship" ? (
          <WorshipBuilderView
            canAccessAdminTools={canManageUsers}
            canArchiveSong={canDeleteSongs}
            canCreateSong={canCreateSongs}
            canDeletePlan={canDeletePlans}
            canEditSong={canEditSongs}
            canEditPlan={canEditPlans}
          />
        ) : activeModule.id === "presentation" ? (
          <PresentationView
            canAttachDeck={canEditPlans && canCreateLibrary}
            canCreatePlan={canCreatePlans}
            canDeletePlan={canDeletePlans}
            canEditPlan={canEditPlans}
            canCreateSong={canCreateSongs}
            canEditSong={canEditSongs}
          />
        ) : activeModule.id === "broadcast" ? (
          <BroadcastManager />
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
          />
        )}
      </section>
    </main>
  );
}

export default App;
