import { Folder, PlayCircle } from 'lucide-react';
// Note: In real implementation, this would fetch from a useProjects query
const MOCK_DATA = [
  { id: '1', name: 'agentctl', sessions: [{ id: 's1', slug: 'auth-refactor' }] }
];

export function Sidebar() {
  return (
    <div className="w-64 bg-surface border-r border-border h-full flex flex-col p-4">
      <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">Explorer</div>
      {MOCK_DATA.length === 0 ? (
        <div className="text-sm text-text-muted">No projects found. Add one via CLI.</div>
      ) : (
        MOCK_DATA.map(proj => (
          <div key={proj.id} className="mb-4">
            <div className="flex items-center text-accent font-semibold mb-2">
              <Folder className="w-4 h-4 mr-2" /> {proj.name}
            </div>
            <div className="pl-6 flex flex-col gap-2">
              {proj.sessions.map(s => (
                <div key={s.id} className="flex items-center text-sm cursor-pointer hover:text-white">
                  <PlayCircle className="w-3 h-3 mr-2 text-success" /> {s.slug}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}