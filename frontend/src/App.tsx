import {
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  ListMusic,
  Settings,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AUTH_REQUIRED_EVENT,
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
import { ImportManager } from "./components/ImportManager";
import { PlanManager } from "./components/PlanManager";
import { PresentationOutput } from "./components/PresentationOutput";
import { PresentationView } from "./components/PresentationView";
import { SongManager } from "./components/SongManager";
import { TeamManager } from "./components/TeamManager";
import { UserManager } from "./components/UserManager";
import { featureModules, type FeatureModule, type ModuleId } from "./data/featureMap";

const iconMap = {
  planning: CalendarDays,
  music: ListMusic,
  people: UsersRound,
  presentation: Clapperboard,
  imports: UploadCloud,
  admin: Settings,
} satisfies Record<ModuleId, typeof CalendarDays>;

const statusTone: Record<FeatureModule["status"], string> = {
  Demo: "status-demo",
  Scaffolded: "status-scaffolded",
  Next: "status-next",
};

interface ApiWorkspace {
  live: boolean;
  plans: PlanSummary[];
  selectedPlan: PlanDetail | null;
  songs: Song[];
}

function App() {
  const isPresentationOutput = new URLSearchParams(window.location.search).get("presentation") === "output";
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
  const canEditPlans = canCreatePlans || permissions.has("plans:edit");
  const canCreateSongs = permissions.has("songs:create");
  const canEditSongs = canCreateSongs || permissions.has("songs:edit");

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
    } catch {
      setWorkspace({ live: false, plans: [], selectedPlan: null, songs: [] });
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

        if (module.id === "music" && workspace.live) {
          return {
            ...module,
            metrics: [
              { label: "Songs", value: String(workspace.songs.length) },
              {
                label: "Lyrics",
                value: String(workspace.songs.filter((song) => song.lyrics_status === "available").length),
              },
              { label: "Source", value: "Live API" },
            ],
            lanes: [
              {
                title: "Song Library",
                items: workspace.songs.map((song) => song.title),
              },
              ...module.lanes.slice(1),
            ],
          };
        }

        return module;
      }).filter((module) => (module.id === "admin" ? canManageUsers : true)),
    [canManageUsers, workspace],
  );

  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) ?? modules[0],
    [activeModuleId, modules],
  );
  const compactWorkspace = true;

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
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <img alt="" src="/images/xs-cspot.png" />
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
          <div className="topbar-actions">
            <div className="church-mark">
              <img alt="" src="/images/churchLogo.png" />
              <span>Church Service Planning</span>
            </div>
            <button className="user-pill" onClick={() => void signOut()} type="button">
              <strong>{sessionUser.name}</strong>
              <span>Sign out</span>
            </button>
            <div className={`status-pill ${statusTone[activeModule.status]}`}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {activeModule.status}
            </div>
          </div>
        </header>

        {activeModuleId === "planning" ? (
          <PlanManager
            canCreate={canCreatePlans}
            canEdit={canEditPlans}
            onDataChange={() => void loadWorkspace()}
          />
        ) : activeModuleId === "music" ? (
          <SongManager
            canCreate={canCreateSongs}
            canEdit={canEditSongs}
            onDataChange={() => void loadWorkspace()}
          />
        ) : activeModuleId === "people" ? (
          <TeamManager />
        ) : activeModuleId === "presentation" ? (
          <PresentationView />
        ) : activeModuleId === "imports" ? (
          <ImportManager onDataChange={() => void loadWorkspace()} />
        ) : activeModuleId === "admin" ? (
          <UserManager />
        ) : (
          <PresentationView />
        )}
      </section>
    </main>
  );
}

export default App;
