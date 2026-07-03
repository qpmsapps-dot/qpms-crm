import {
  GitBranch,
  GripVertical,
  Maximize2,
  Minus,
  Move,
  Network,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { createElement, useEffect, useMemo, useState } from 'react';
import { getAdminUsersHierarchy } from '../../services/api.js';

function employeeInitials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'QP';
}

function normalizeCode(value = '') {
  return String(value || '').trim().toUpperCase();
}

function displayNameForProfile(profile) {
  return (
    profile?.full_name ||
    profile?.display_name ||
    profile?.username ||
    profile?.email ||
    'Unnamed user'
  );
}

function roleTextForProfile(profile) {
  return profile?.designation || profile?.role || profile?.department || 'Unassigned role';
}

function leadershipRank(profile) {
  const text = [
    profile?.role,
    profile?.designation,
    profile?.department,
    profile?.business,
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  if (/\bMD\b|MANAGING DIRECTOR/.test(text)) return 1;
  if (/\bCOO\b|CHIEF OPERATING OFFICER/.test(text)) return 2;
  if (/\bCEO\b|CHIEF EXECUTIVE/.test(text)) return 3;
  if (/\bCFO\b|CHIEF FINANCIAL/.test(text)) return 4;
  if (/\bGM\b|GENERAL MANAGER|BUSINESS HEAD|BRANCH HEAD|HEAD\s*-/.test(text)) return 5;
  return 99;
}

function isTopLeadership(profile) {
  return leadershipRank(profile) < 99;
}

function hierarchyManagerCode(profile, localManagerByCode) {
  const code = normalizeCode(profile.employee_code);
  if (Object.prototype.hasOwnProperty.call(localManagerByCode, code)) {
    return normalizeCode(localManagerByCode[code]);
  }
  return normalizeCode(profile?.hierarchy?.manager_employee_code);
}

function profileToNode(profile, localManagerByCode, level = 0, tone = 'staff') {
  return {
    id: normalizeCode(profile.employee_code) || profile.id,
    profileId: profile.id,
    code: profile.employee_code || 'Not assigned',
    name: displayNameForProfile(profile),
    role: roleTextForProfile(profile),
    department: profile.department || '',
    business: profile.business || '',
    state: profile.state || '',
    managerCode: hierarchyManagerCode(profile, localManagerByCode),
    level,
    tone,
  };
}

function sortProfiles(a, b) {
  const rankDiff = leadershipRank(a) - leadershipRank(b);
  if (rankDiff !== 0) return rankDiff;
  return displayNameForProfile(a).localeCompare(displayNameForProfile(b));
}

function buildHierarchyView(profiles, localManagerByCode) {
  const activeProfiles = (profiles || [])
    .filter((profile) => normalizeCode(profile.employee_code))
    .sort(sortProfiles);
  const profilesByCode = new Map(
    activeProfiles.map((profile) => [normalizeCode(profile.employee_code), profile]),
  );
  const childrenByManager = new Map();
  const managedCodes = new Set();

  for (const profile of activeProfiles) {
    const managerCode = hierarchyManagerCode(profile, localManagerByCode);
    if (!managerCode || !profilesByCode.has(managerCode)) continue;
    managedCodes.add(normalizeCode(profile.employee_code));
    if (!childrenByManager.has(managerCode)) childrenByManager.set(managerCode, []);
    childrenByManager.get(managerCode).push(profile);
  }

  for (const children of childrenByManager.values()) {
    children.sort(sortProfiles);
  }

  const rootProfiles = activeProfiles.filter((profile) => {
    const code = normalizeCode(profile.employee_code);
    const managerCode = hierarchyManagerCode(profile, localManagerByCode);
    if (managerCode && profilesByCode.has(managerCode)) return false;
    return isTopLeadership(profile) || childrenByManager.has(code);
  });
  const rootCodes = new Set(rootProfiles.map((profile) => normalizeCode(profile.employee_code)));
  const rows = [];
  const nodesById = new Map();
  const visited = new Set();
  let currentRow = rootProfiles;
  let level = 0;

  while (currentRow.length) {
    const rowCodes = [];
    const nextRow = [];
    for (const profile of currentRow) {
      const code = normalizeCode(profile.employee_code);
      if (!code || visited.has(code)) continue;
      visited.add(code);
      const tone = level <= 2 || isTopLeadership(profile) ? 'senior' : 'staff';
      nodesById.set(code, profileToNode(profile, localManagerByCode, level, tone));
      rowCodes.push(code);
      nextRow.push(...(childrenByManager.get(code) || []));
    }
    if (rowCodes.length) rows.push(rowCodes);
    currentRow = nextRow;
    level += 1;
  }

  const unassigned = activeProfiles
    .filter((profile) => {
      const code = normalizeCode(profile.employee_code);
      return !visited.has(code) && !managedCodes.has(code) && !rootCodes.has(code);
    })
    .map((profile) => profileToNode(profile, localManagerByCode, 0, 'unassigned'));

  const selectedCode =
    rows.flat().find((code) => (childrenByManager.get(code) || []).length > 0) || rows.flat()[0] || '';

  return { rows, nodesById, unassigned, selectedCode };
}

function toneClasses(tone, selected = false, isDropTarget = false) {
  if (tone === 'staff') {
    return isDropTarget
      ? 'border-rose-300 bg-rose-50 shadow-[0_0_0_3px_rgba(244,114,182,0.16)]'
      : 'border-rose-200 bg-white shadow-sm';
  }
  if (selected) {
    return 'border-qpms-400 bg-white shadow-[0_0_0_3px_rgba(37,99,235,0.16),0_12px_28px_rgba(37,99,235,0.14)]';
  }
  return isDropTarget
    ? 'border-cyan-300 bg-cyan-50 shadow-[0_0_0_3px_rgba(34,211,238,0.18)]'
    : 'border-cyan-200 bg-white shadow-sm';
}

function EmployeeNode({ node, selected = false, dropTarget = false, onDragStart, onDropOnNode }) {
  const handleDrop = (event) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    if (draggedId) onDropOnNode(node.id, draggedId);
  };

  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, node.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className={`group relative flex min-h-[86px] w-[210px] items-center gap-3 rounded-lg border px-3 py-2 transition ${toneClasses(node.tone, selected, dropTarget)}`}
    >
      <span className={`absolute inset-y-2 left-0 w-1 rounded-r-full ${node.tone === 'staff' ? 'bg-rose-400' : selected ? 'bg-qpms-500' : 'bg-cyan-400'}`} />
      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-[11px] font-black text-slate-700 ring-1 ring-slate-200">
        {employeeInitials(node.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-black uppercase text-slate-950">{node.name}</p>
        <p className="truncate text-[10px] font-bold uppercase text-slate-500">{node.role}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">Emp ID - {node.code}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
          {[node.department, node.business, node.state].filter(Boolean).join(' / ') || 'Profile data'}
        </p>
      </div>
      <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
      {selected ? (
        <div className="absolute -bottom-4 -right-4 grid h-8 w-8 place-items-center rounded-full bg-white text-qpms-700 shadow-lg ring-1 ring-qpms-100">
          <Move className="h-5 w-5" />
        </div>
      ) : null}
    </div>
  );
}

function UnassignedCard({ employee, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, employee.id)}
      className="group flex min-h-[78px] items-center gap-3 rounded-lg border border-violet-200 bg-white px-3 py-2 shadow-sm transition hover:-translate-y-0.5 hover:border-qpms-300 hover:shadow-md"
    >
      <span className="h-11 w-1 rounded-full bg-violet-400" />
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-black text-slate-700 ring-1 ring-slate-200">
        {employeeInitials(employee.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-black uppercase text-slate-950">{employee.name}</p>
        <p className="truncate text-[10px] font-bold uppercase text-slate-500">{employee.role}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">Emp ID - {employee.code}</p>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
          {[employee.department, employee.business, employee.state].filter(Boolean).join(' / ') || 'No manager mapped'}
        </p>
      </div>
      <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
    </div>
  );
}

function ConnectorRow({ width = 'w-[72%]' }) {
  return (
    <div className="flex h-7 justify-center">
      <div className={`relative ${width}`}>
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-300" />
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-300" />
      </div>
    </div>
  );
}

function apiErrorMessage(error) {
  return error?.response?.data?.message || error?.message || 'Failed to load hierarchy';
}

export default function HierarchyBuilder({ onMessage }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [localManagerByCode, setLocalManagerByCode] = useState({});
  const [dropTarget, setDropTarget] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadHierarchy() {
      setLoading(true);
      setError('');
      try {
        const result = await getAdminUsersHierarchy();
        if (cancelled) return;
        setProfiles(Array.isArray(result.users) ? result.users : []);
        setLocalManagerByCode({});
      } catch (loadError) {
        if (cancelled) return;
        setProfiles([]);
        setError(apiErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadHierarchy();
    return () => {
      cancelled = true;
    };
  }, []);

  const hierarchyView = useMemo(
    () => buildHierarchyView(profiles, localManagerByCode),
    [profiles, localManagerByCode],
  );

  function handleDragStart(event, id) {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDropOnNode(managerId, draggedId) {
    setDropTarget('');
    const managerCode = normalizeCode(managerId);
    const employeeCode = normalizeCode(draggedId);
    if (!managerCode || !employeeCode || managerCode === employeeCode) return;
    setLocalManagerByCode((current) => ({
      ...current,
      [employeeCode]: managerCode,
    }));
    onMessage('Employee placed locally. Hierarchy save API is not connected yet.');
  }

  function resetCanvas() {
    setLocalManagerByCode({});
    setDropTarget('');
    onMessage('Hierarchy layout reset locally. No backend changes were made.');
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-slate-950">Hierarchy Builder</h2>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">i</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">Drag and drop employees to define reporting structure.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onMessage('Hierarchy save API is not connected yet.')} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-qpms-600 px-4 text-sm font-bold text-white shadow-sm">
            <Save className="h-4 w-4" /> Save Hierarchy
          </button>
          <button type="button" onClick={resetCanvas} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
          <button type="button" onClick={() => onMessage('Auto Arrange is visual-only until hierarchy persistence is connected.')} className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">
            <Sparkles className="h-4 w-4" /> Auto Arrange
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center text-sm font-bold text-slate-500">
            Loading hierarchy...
          </div>
        </div>
      ) : error ? (
        <div className="p-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">
            Failed to load hierarchy
            <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="relative min-h-[560px] overflow-hidden rounded-xl border border-slate-200 bg-[radial-gradient(circle,#dbe4f0_1px,transparent_1px)] [background-size:18px_18px]">
            <div className="absolute right-4 top-4 z-20 space-y-2">
              {[
                ['Fit View', Maximize2],
                ['Auto Layout', Network],
                ['Zoom In', Plus],
                ['Zoom Out', Minus],
              ].map(([label, Icon]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onMessage(`${label} is visual-only in this frontend preview.`)}
                  className="focus-ring flex w-24 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white/95 px-2 py-2 text-[10px] font-bold text-slate-700 shadow-sm"
                >
                  {createElement(Icon, { className: 'h-4 w-4' })}
                  {label}
                </button>
              ))}
            </div>

            <div className="min-w-[1000px] px-8 py-6">
              {hierarchyView.rows.length ? (
                hierarchyView.rows.map((row, index) => (
                  <div key={row.join('-')}>
                    <div className="flex justify-center gap-7">
                      {row.map((id) => {
                        const node = hierarchyView.nodesById.get(id);
                        if (!node) return null;
                        return (
                          <div
                            key={id}
                            onDragEnter={() => setDropTarget(id)}
                            onDragLeave={() => setDropTarget((current) => (current === id ? '' : current))}
                          >
                            <EmployeeNode
                              node={node}
                              selected={id === hierarchyView.selectedCode}
                              dropTarget={dropTarget === id}
                              onDragStart={handleDragStart}
                              onDropOnNode={handleDropOnNode}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {index < hierarchyView.rows.length - 1 ? (
                      <ConnectorRow width={index < 1 ? 'w-[18%]' : index === 1 ? 'w-[68%]' : 'w-[58%]'} />
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="flex min-h-[420px] items-center justify-center">
                  <div className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white/90 p-6 text-center text-sm font-bold text-slate-500 shadow-sm">
                    No manager relationships are available yet. Top leadership will appear here when hierarchy rows are mapped.
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-950">Unassigned Employees</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">{hierarchyView.unassigned.length}</span>
            </div>
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Drag employees from here to add to the hierarchy.</p>
            <div className="mt-4 max-h-[470px] space-y-3 overflow-y-auto pr-1">
              {hierarchyView.unassigned.length ? (
                hierarchyView.unassigned.map((employee) => (
                  <UnassignedCard key={employee.id} employee={employee} onDragStart={handleDragStart} />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs font-bold text-slate-500">
                  No unassigned active profiles found.
                </div>
              )}
            </div>
            <button type="button" onClick={() => onMessage('Use Add User to create a new profile. Hierarchy assignment save is not connected yet.')} className="focus-ring mt-4 inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-black text-qpms-700">
              <Plus className="h-4 w-4" /> Add New Employee
            </button>
          </aside>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1"><GitBranch className="h-4 w-4 text-qpms-600" /> Real hierarchy data</span>
        <span className="inline-flex items-center gap-1"><UserRound className="h-4 w-4 text-cyan-600" /> Active profiles from User Management</span>
      </div>
    </section>
  );
}
