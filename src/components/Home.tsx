import { useEffect, useState } from 'react';
import { deleteProject, importProjectFile, newProject, openProject, openSampleProject, pickFile } from '../app/projectActions';
import { getRepository, type ProjectMeta } from '../persistence/repository';
import { setTheme, useUi } from '../state/uiStore';
import { Icon, type IconName } from './Icon';

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(t).toLocaleDateString();
}

export function Home() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const theme = useUi((s) => s.theme);
  const refresh = () =>
    void getRepository()
      .list()
      .then(setProjects)
      .catch(() => setProjects([]));
  useEffect(refresh, []);

  const cards: Array<{ icon: IconName; title: string; desc: string; run: () => void; testId: string }> = [
    { icon: 'scan', title: 'Import measurement sketches', desc: 'Upload photos of your hand-drawn measurements and review them into an exact plan.', run: () => void newProject({ name: 'My House', screen: 'import' }), testId: 'start-import' },
    { icon: 'wall', title: 'Start from an empty plan', desc: 'Draw rooms and walls yourself with exact dimensions.', run: () => void newProject({ name: 'My House' }), testId: 'start-empty' },
    { icon: 'home', title: 'Explore a sample house', desc: 'A furnished bungalow to try every tool — nothing to lose.', run: () => void openSampleProject(), testId: 'start-sample' },
    {
      icon: 'folder',
      title: 'Open a project file',
      desc: 'Continue from a .json project exported on another device.',
      run: () =>
        void pickFile('.json,application/json').then((files) => {
          if (files[0]) void importProjectFile(files[0]);
        }),
      testId: 'start-open-file',
    },
  ];

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-hero">
          <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
            <Icon name="home" size={24} stroke={1.8} />
          </span>
          <div style={{ flex: 1 }}>
            <h1>Home Planner</h1>
            <p>Measure once. Plan your renovation in exact 2D and 3D.</p>
          </div>
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')} aria-label="Theme">
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
          </button>
        </div>

        <div className="start-grid">
          {cards.map((c, i) => (
            <button key={c.title} className="start-card" onClick={c.run} style={{ animationDelay: `${80 + i * 60}ms` }} data-testid={c.testId}>
              <span className="ic">
                <Icon name={c.icon} size={20} />
              </span>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </button>
          ))}
        </div>

        <h2 className="recent-title">Recent projects</h2>
        {projects === null ? (
          <div className="recent-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 210, borderRadius: 12 }} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet. Your work saves automatically on this device.</p>
        ) : (
          <div className="recent-grid">
            {projects.map((p, i) => (
              <div key={p.id} className="project-card" role="button" tabIndex={0} style={{ animationDelay: `${200 + i * 50}ms` }} onClick={() => void openProject(p.id)} onKeyDown={(e) => e.key === 'Enter' && void openProject(p.id)} data-testid="project-card">
                <div className="thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Icon name="plan" size={32} />}</div>
                <div className="info">
                  <b>{p.name}</b>
                  <span>
                    {p.floors === 1 ? 'Main floor' : `${p.floors} floors`} · {p.variants} {p.variants === 1 ? 'plan' : 'plans'} · modified {ago(p.updatedAt)}
                  </span>
                </div>
                <button
                  className="icon-btn del"
                  aria-label="Delete project"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete “${p.name}”? This can’t be undone.`)) void deleteProject(p.id).then(refresh);
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 36, fontSize: 12 }}>
          Projects are stored privately in this browser. Use Export → Project file to back up or move a project to another device.
        </p>
      </div>
    </div>
  );
}
