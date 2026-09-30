import { lazy, Suspense, useEffect } from 'react';
import { ContextMenu, Dialogs, Toasts } from '../components/Overlays';
import { DimensionPopover } from '../components/DimensionPopover';
import { Home } from '../components/Home';
import { RightPanel } from '../components/RightPanel';
import { Stage } from '../components/Stage';
import { StatusBar } from '../components/StatusBar';
import { ToolRail } from '../components/ToolRail';
import { TopBar } from '../components/TopBar';
import { startAutosave } from '../persistence/autosave';
import { useDocument } from '../state/documentStore';
import { useUi } from '../state/uiStore';
import { installShortcuts } from './shortcuts';

const ImportWorkspace = lazy(() => import('../components/ImportWorkspace'));

function useThemeAttribute() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    meta?.setAttribute('content', dark ? '#15171b' : '#ffffff');
  }, [theme]);
}

export function App() {
  const screen = useUi((s) => s.screen);
  const hasDoc = useDocument((s) => !!s.doc);
  useThemeAttribute();
  useEffect(() => {
    const a = startAutosave();
    const b = installShortcuts();
    return () => {
      a();
      b();
    };
  }, []);

  if (!hasDoc || screen === 'home') {
    return (
      <>
        <Home />
        <Toasts />
      </>
    );
  }
  if (screen === 'import') {
    return (
      <Suspense fallback={null}>
        <ImportWorkspace />
        <Toasts />
        <ContextMenu />
      </Suspense>
    );
  }
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <ToolRail />
        <Stage />
        <RightPanel />
      </div>
      <StatusBar />
      <ContextMenu />
      <DimensionPopover />
      <Dialogs />
      <Toasts />
    </div>
  );
}
