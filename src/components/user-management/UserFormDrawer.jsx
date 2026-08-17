import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAccessFoundation, getAccessScopeOptions, getHierarchyOptions, lookupAdminUserByEmail } from '../../services/api.js';

const emptyForm = {
  user_type: 'internal',
  employee_code: '',
  full_name: '',
  display_name: '',
  mobile: '',
  email: '',
  state: '',
  role: 'FO',
  designation: '',
  department: '',
  business: '',
  create_profile_only: false,
  requires_password_change: true,
  mobile_access_enabled: true,
  web_access_enabled: true,
  status: 'Active',
  is_active: true,
  manager_employee_code: '',
  managers_manager_employee_code: '',
  business_head_employee_code: '',
  gm_employee_code: '',
  coo_employee_code: '',
  access_business_vertical_id: '',
  access_client_id: '',
  access_module_id: '',
  access_role_id: '',
  access_scope_type: '',
  access_scope_id: '',
  access_scope_code: '',
  access_scope_text: '',
  access_verification_status: 'verified',
  client_id: '',
  hospital_access_enabled: false,
  hospital_role_code: 'housekeeping_supervisor',
  temporary_password: '',
};

const roleOptions = [
  'MD', 'COO', 'GM', 'South Head', 'Business Head', 'Branch Head', 'Operations Manager', 'KAM', 'FO', 'Admin',
];
const stateOptions = ['TN', 'AP', 'KA', 'KL', 'TG'];
const businessOptions = [
  'Standalone',
  'Reliance Retail',
  'IFMS',
  'Reliance',
  'Private Clients',
  'DME',
  'AP DSH',
  'TN Government',
  'Osmania Hospitals',
  'Hospitals',
  'Airport',
  'Retail',
  'Government',
  'Private Hospital',
];
const reportingRequiredRoles = new Set(['FO', 'KAM', 'Operations Manager', 'Branch Head']);
const userTypeOptions = [
  { value: 'internal', label: 'QPMS Employee' },
  { value: 'nims_contact', label: 'NIMS Client Person' },
];
const nimsHospitalRoleOptions = [
  { value: 'housekeeping_supervisor', label: 'Hospital Supervisor' },
  { value: 'operations_executive', label: 'Operations Executive' },
  { value: 'facility_manager', label: 'Facility Manager' },
  { value: 'project_head', label: 'Project Head' },
];
const fallbackScopeTypes = [
  'global',
  'business_vertical',
  'client',
  'all_client',
  'state',
  'branch',
  'site',
  'store',
  'hospital_block',
  'floor',
  'location',
  'department',
  'assigned_ticket',
  'employee_self',
];

function isIfmsBusiness(value) {
  return ['IFMS', 'RELIANCE RETAIL', 'RELIANCE'].includes(String(value || '').trim().toUpperCase());
}

function normalizeInitial(initialUser) {
  if (!initialUser) return emptyForm;
  return {
    ...emptyForm,
    ...initialUser.raw,
    ...(initialUser.hierarchy || {}),
    employee_code: initialUser.employeeCode || '',
    full_name: initialUser.fullName || '',
    display_name: initialUser.displayName || '',
    mobile: initialUser.mobile || '',
    email: initialUser.email || '',
    state: initialUser.state || '',
    role: initialUser.role || 'FO',
    designation: initialUser.designation || '',
    department: initialUser.department || '',
    business: initialUser.business || '',
    status: initialUser.status || 'Active',
    is_active: initialUser.isActive,
    mobile_access_enabled: initialUser.mobileAccess,
    web_access_enabled: initialUser.webAccess,
    hospital_access_enabled: Boolean(initialUser.hospitalTicketingAccess?.id),
    hospital_role_code: initialUser.hospitalTicketingAccess?.role_code || 'housekeeping_supervisor',
    client_id: initialUser.hospitalTicketingAccess?.access_client_id || '',
  };
}

function TextField({
  name,
  label,
  value,
  onChange,
  onBlur,
  required = false,
  type = 'text',
  readOnly = false,
  error,
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}{required ? ' *' : ''}
      </span>
      <input
        type={type}
        value={value ?? ''}
        readOnly={readOnly}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        onChange={(event) => onChange(name, event.target.value)}
        onBlur={onBlur}
        className={`mt-1 h-10 w-full rounded-xl border px-3 text-sm font-semibold outline-none ${
          readOnly
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
            : 'border-slate-200 bg-white text-slate-800 focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100'
        } ${error ? 'border-rose-300' : ''}`}
      />
      {error ? <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p> : null}
    </label>
  );
}

function optionValue(option) {
  return typeof option === 'object' && option !== null ? option.value : option;
}

function optionLabel(option) {
  return typeof option === 'object' && option !== null ? option.label : option;
}

function SelectField({ name, label, value, onChange, options, required = false, error, disabled = false }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}{required ? ' *' : ''}
      </span>
      <select
        value={value || ''}
        disabled={disabled}
        onChange={(event) => onChange(name, event.target.value)}
        className={`mt-1 h-10 w-full rounded-xl border px-3 text-sm font-semibold outline-none ${
          disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
            : 'border-slate-200 bg-white text-slate-800 focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100'
        } ${error ? 'border-rose-300' : ''}`}
      >
        <option value="">Select {label}</option>
        {options.map((option) => (
          <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>
        ))}
      </select>
      {error ? <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p> : null}
    </label>
  );
}

function HierarchySelect({ label, value, options, onChange, required = false, error }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}{required ? ' *' : ''}
      </span>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 ${error ? 'border-rose-300' : ''}`}
      >
        <option value="">Search / select reporting user</option>
        {options.map((option) => (
          <option key={option.employee_code} value={option.employee_code}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p> : null}
    </label>
  );
}

function employeeLabel(option) {
  return option?.label || (option?.employee_code ? `${option.full_name || 'User'} - ${option.employee_code}` : 'Not found');
}

function businessOptionsWithCurrent(currentBusiness) {
  const current = String(currentBusiness || '').trim();
  if (!current) return businessOptions;
  const exists = businessOptions.some((option) => option.toLowerCase() === current.toLowerCase());
  return exists ? businessOptions : [current, ...businessOptions];
}

function scopeTypeLabel(scopeType) {
  const labels = {
    client: 'Entire Client',
    hospital_block: 'Specific Block',
    location: 'Specific Location',
    global: 'Global',
    business_vertical: 'Business Vertical',
    all_client: 'All Client',
    employee_self: 'Employee Self',
  };
  return labels[scopeType] || scopeType.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function UserFormDrawer({
  open,
  mode,
  initialUser,
  busy,
  serverError,
  onClose,
  onSave,
}) {
  const [values, setValues] = useState(() => normalizeInitial(initialUser));
  const [errors, setErrors] = useState({});
  const [hierarchyOptions, setHierarchyOptions] = useState({
    operationsManagers: [],
    branchHeads: [],
    businessHeads: [],
    gms: [],
    southHeads: [],
    kams: [],
    coo: null,
    md: null,
    warnings: [],
  });
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState('');
  const [foundation, setFoundation] = useState({
    available: false,
    business_verticals: [],
    clients: [],
    modules: [],
    business_vertical_modules: [],
    client_modules: [],
    roles: [],
    permissions: [],
    scope_types: fallbackScopeTypes,
  });
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationError, setFoundationError] = useState('');
  const [scopeOptions, setScopeOptions] = useState([]);
  const [scopeOptionsLoading, setScopeOptionsLoading] = useState(false);
  const [scopeOptionsError, setScopeOptionsError] = useState('');
  const [existingLookup, setExistingLookup] = useState(null);
  const [existingLookupLoading, setExistingLookupLoading] = useState(false);
  const [existingLookupError, setExistingLookupError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setFoundationLoading(true);
    setFoundationError('');
    getAccessFoundation()
      .then((result) => {
        if (!active) return;
        setFoundation({
          available: result.available !== false,
          business_verticals: result.business_verticals || [],
          clients: result.clients || [],
          modules: result.modules || [],
          business_vertical_modules: result.business_vertical_modules || [],
          client_modules: result.client_modules || [],
          roles: result.roles || [],
          permissions: result.permissions || [],
          scope_types: result.scope_types || fallbackScopeTypes,
        });
      })
      .catch((error) => {
        if (!active) return;
        setFoundationError(error.message || 'Unable to load unified access options.');
      })
      .finally(() => {
        if (active) setFoundationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, open]);

  useEffect(() => {
    if (!open || mode !== 'add' || values.user_type === 'client') return undefined;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setHierarchyLoading(true);
      setHierarchyError('');
    });
    getHierarchyOptions({
      role: values.role || undefined,
      state: values.state || undefined,
      business: values.business || undefined,
    })
      .then((result) => {
        if (!active) return;
        setHierarchyOptions({
          operationsManagers: result.operationsManagers || [],
          branchHeads: result.branchHeads || [],
          businessHeads: result.businessHeads || [],
          gms: result.gms || [],
          southHeads: result.southHeads || [],
          kams: result.kams || [],
          coo: result.coo || null,
          md: result.md || null,
          warnings: result.warnings || [],
        });
      })
      .catch((error) => {
        if (!active) return;
        setHierarchyError(error.message || 'Unable to load hierarchy options.');
      })
      .finally(() => {
        if (active) setHierarchyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, open, values.business, values.role, values.state, values.user_type]);

  useEffect(() => {
    if (!open || mode !== 'add' || !values.access_scope_type) {
      setScopeOptions([]);
      setScopeOptionsError('');
      return undefined;
    }
    if (['global', 'business_vertical', 'client', 'all_client', 'employee_self'].includes(values.access_scope_type)) {
      setScopeOptions([]);
      setScopeOptionsError('');
      return undefined;
    }
    let active = true;
    setScopeOptionsLoading(true);
    setScopeOptionsError('');
    getAccessScopeOptions({
      scope_type: values.access_scope_type,
      client_id: values.access_client_id || undefined,
      module_id: values.access_module_id || undefined,
    })
      .then((result) => {
        if (!active) return;
        setScopeOptions(result.options || []);
      })
      .catch((error) => {
        if (!active) return;
        setScopeOptions([]);
        setScopeOptionsError(error.message || 'Unable to load scope values.');
      })
      .finally(() => {
        if (active) setScopeOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, open, values.access_client_id, values.access_module_id, values.access_scope_type]);

  const gmLevelOptions = useMemo(
    () => (isIfmsBusiness(values.business) ? hierarchyOptions.southHeads : hierarchyOptions.gms),
    [hierarchyOptions.gms, hierarchyOptions.southHeads, values.business],
  );

  const reportingOptions = useMemo(() => {
    if (values.role === 'FO') return hierarchyOptions.operationsManagers;
    if (values.role === 'KAM') return gmLevelOptions;
    if (values.role === 'Operations Manager') return hierarchyOptions.branchHeads;
    if (values.role === 'Branch Head') return gmLevelOptions;
    return [];
  }, [gmLevelOptions, hierarchyOptions.branchHeads, hierarchyOptions.operationsManagers, values.role]);

  const selectedReportingUser = useMemo(
    () => reportingOptions.find((option) => option.employee_code === values.manager_employee_code) || null,
    [reportingOptions, values.manager_employee_code],
  );

  const hierarchyPreview = useMemo(() => {
    const branchHead = values.role === 'Operations Manager'
      ? selectedReportingUser
      : values.role === 'FO'
        ? hierarchyOptions.branchHeads.find((option) => option.employee_code === selectedReportingUser?.branch_head_employee_code) || hierarchyOptions.branchHeads[0] || null
        : null;
    const operationsManager =
      values.role === 'FO' && selectedReportingUser?.role === 'Operations Manager'
        ? selectedReportingUser
        : null;
    const gmLevel =
      ['Branch Head', 'KAM'].includes(values.role)
        ? selectedReportingUser
        : branchHead?.south_head_employee_code
          ? hierarchyOptions.southHeads.find((option) => option.employee_code === branchHead.south_head_employee_code)
          : hierarchyOptions.gms.find((option) => option.employee_code === branchHead?.gm_employee_code) || null;
    return {
      operationsManager,
      branchHead,
      gmLevel,
      coo: values.role === 'COO' ? null : hierarchyOptions.coo,
      md: hierarchyOptions.md,
    };
  }, [hierarchyOptions.branchHeads, hierarchyOptions.coo, hierarchyOptions.gms, hierarchyOptions.md, hierarchyOptions.southHeads, selectedReportingUser, values.role]);
  const profileOnlyMd = mode === 'add' && values.role === 'MD' && values.create_profile_only;
  const resolvedBusinessOptions = useMemo(
    () => businessOptionsWithCurrent(values.business),
    [values.business],
  );
  const filteredClients = useMemo(
    () => foundation.clients
      .filter((client) => !values.access_business_vertical_id || client.business_vertical_id === values.access_business_vertical_id)
      .map((client) => ({ value: client.id, label: client.name || client.code })),
    [foundation.clients, values.access_business_vertical_id],
  );
  const nimsClientOptions = useMemo(
    () => foundation.clients
      .filter((client) => {
        const text = `${client.code || ''} ${client.name || ''}`.toLowerCase();
        return client.active !== false && text.includes('nims');
      })
      .map((client) => ({ value: client.id, label: client.name || client.code })),
    [foundation.clients],
  );
  const selectedEmployeeClient = useMemo(
    () => foundation.clients.find((client) => client.id === values.client_id) || null,
    [foundation.clients, values.client_id],
  );
  const defaultNimsClientId = nimsClientOptions[0]?.value || '';
  const filteredModules = useMemo(
    () => foundation.modules
      .filter((module) => module.active !== false)
      .filter((module) => {
        if (!values.access_business_vertical_id) return false;
        return foundation.business_vertical_modules.some((mapping) =>
          mapping.business_vertical_id === values.access_business_vertical_id &&
          mapping.module_id === module.id &&
          mapping.enabled !== false);
      })
      .filter((module) => {
        if (!values.access_client_id) return true;
        return foundation.client_modules.some((mapping) =>
          mapping.client_id === values.access_client_id &&
          mapping.module_id === module.id &&
          mapping.enabled !== false);
      })
      .map((module) => ({ value: module.id, label: module.name || module.code })),
    [foundation.business_vertical_modules, foundation.client_modules, foundation.modules, values.access_business_vertical_id, values.access_client_id],
  );
  const filteredAccessRoles = useMemo(
    () => foundation.roles
      .filter((role) => role.active !== false)
      .filter((role) => !values.access_module_id || !role.module_id || role.module_id === values.access_module_id)
      .filter((role) => String(role.user_type || '').toLowerCase() === values.user_type)
      .map((role) => ({ value: role.id, label: role.name || role.code })),
    [foundation.roles, values.access_module_id, values.user_type],
  );
  const scopeTypeOptions = useMemo(
    () => (foundation.scope_types || fallbackScopeTypes).map((scopeType) => ({
      value: scopeType,
      label: scopeTypeLabel(scopeType),
    })),
    [foundation.scope_types],
  );
  const scopeValueOptions = useMemo(
    () => scopeOptions.map((option) => ({
      value: option.id || option.code || option.label,
      label: option.label || option.code || option.id,
      raw: option,
    })),
    [scopeOptions],
  );
  const selectedAccessClient = useMemo(
    () => foundation.clients.find((client) => client.id === values.access_client_id) || null,
    [foundation.clients, values.access_client_id],
  );
  const selectedAccessModule = useMemo(
    () => foundation.modules.find((module) => module.id === values.access_module_id) || null,
    [foundation.modules, values.access_module_id],
  );
  const selectedAccessRole = useMemo(
    () => foundation.roles.find((role) => role.id === values.access_role_id) || null,
    [foundation.roles, values.access_role_id],
  );
  const accessPreview = useMemo(() => {
    if (!values.access_scope_type || !selectedAccessModule) return '';
    const clientName = selectedAccessClient?.name || selectedAccessClient?.code || 'the selected client';
    if (values.access_scope_type === 'client') {
      return `This user can raise and view tickets across all active ${clientName} blocks.`;
    }
    if (values.access_scope_type === 'hospital_block') {
      return `This user can access ${selectedAccessModule.name || selectedAccessModule.code} only for ${values.access_scope_text || 'the selected block'}.`;
    }
    if (values.access_scope_type === 'location') {
      return `This user can access ${selectedAccessModule.name || selectedAccessModule.code} only for ${values.access_scope_text || 'the selected location'}.`;
    }
    return `This user gets ${selectedAccessModule.name || selectedAccessModule.code} access for ${scopeTypeLabel(values.access_scope_type)}.`;
  }, [selectedAccessClient, selectedAccessModule, values.access_scope_text, values.access_scope_type]);

  if (!open) return null;

  function update(key, value) {
    if (key === 'email') {
      setExistingLookup(null);
      setExistingLookupError('');
    }
    const selectedAccessRole = key === 'access_role_id'
      ? foundation.roles.find((role) => role.id === value)
      : null;
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(key === 'user_type'
        ? {
          role: value === 'nims_contact' ? '' : 'FO',
          state: '',
          business: '',
          client_id: '',
          hospital_access_enabled: false,
          hospital_role_code: 'housekeeping_supervisor',
          manager_employee_code: '',
          access_business_vertical_id: '',
          access_client_id: '',
          access_module_id: '',
          access_role_id: '',
          access_scope_type: '',
          access_scope_id: '',
          access_scope_code: '',
          access_scope_text: '',
        }
        : {}),
      ...(key === 'hospital_access_enabled'
        ? {
          client_id: value ? (current.client_id || defaultNimsClientId) : '',
          hospital_role_code: value ? (current.hospital_role_code || 'housekeeping_supervisor') : 'housekeeping_supervisor',
        }
        : {}),
      ...(key === 'access_business_vertical_id'
        ? {
          access_client_id: '',
          access_module_id: '',
          access_role_id: '',
          access_scope_type: '',
          access_scope_id: '',
          access_scope_code: '',
          access_scope_text: '',
        }
        : {}),
      ...(key === 'access_client_id'
        ? {
          access_module_id: '',
          access_role_id: '',
          access_scope_type: '',
          access_scope_id: '',
          access_scope_code: '',
          access_scope_text: '',
        }
        : {}),
      ...(key === 'access_module_id'
        ? {
          access_role_id: '',
          access_scope_type: '',
          access_scope_id: '',
          access_scope_code: '',
          access_scope_text: '',
        }
        : {}),
      ...(key === 'access_role_id' && selectedAccessRole
        ? { role: selectedAccessRole.code === 'hospital_management' ? 'Hospital Management' : selectedAccessRole.name || selectedAccessRole.code }
        : {}),
      ...(key === 'access_scope_type'
        ? { access_scope_id: '', access_scope_code: '', access_scope_text: '' }
        : {}),
      ...(key === 'role'
        ? { create_profile_only: value === 'MD' }
        : {}),
      ...(mode === 'add' && ['role', 'state', 'business'].includes(key)
        ? { manager_employee_code: '' }
        : {}),
    }));
  }

  function updateScopeValue(value) {
    const selected = scopeValueOptions.find((option) => option.value === value)?.raw || null;
    setValues((current) => ({
      ...current,
      access_scope_id: selected?.id || '',
      access_scope_code: selected?.code || (!selected?.id ? value : ''),
      access_scope_text: selected?.label || '',
    }));
  }

  async function checkExistingEmail() {
    const email = values.email.trim().toLowerCase();
    if (mode !== 'add' || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setExistingLookupLoading(true);
    setExistingLookupError('');
    try {
      const result = await lookupAdminUserByEmail(email);
      setExistingLookup(result.exists ? result : null);
    } catch (error) {
      setExistingLookupError(error.message || 'Could not check existing account.');
    } finally {
      setExistingLookupLoading(false);
    }
  }

  function needsState(role) {
    void role;
    return values.user_type === 'internal';
  }

  function needsBusiness(role) {
    void role;
    return values.user_type === 'internal';
  }

  function reportingLabel(role) {
    if (role === 'FO') return 'Reporting Operations Manager';
    if (role === 'KAM') return isIfmsBusiness(values.business) ? 'South Head' : 'GM';
    if (role === 'Operations Manager') return 'Branch Head';
    if (role === 'Branch Head') return isIfmsBusiness(values.business) ? 'South Head' : 'GM';
    if (role === 'Business Head' || role === 'GM' || role === 'South Head') return 'COO';
    if (role === 'COO') return 'Reporting To';
    return 'Reporting To';
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    const fullName = values.full_name.trim();
    const email = values.email.trim().toLowerCase();
    const existingProfile = existingLookup?.profile || null;
    const employeeCode = values.user_type === 'nims_contact'
      ? ''
      : values.employee_code.trim().toUpperCase();
    const profileOnlyMd = mode === 'add' && values.role === 'MD' && values.create_profile_only;
    const accessStarted = Boolean(
      values.access_business_vertical_id ||
      values.access_client_id ||
      values.access_module_id ||
      values.access_role_id ||
      values.access_scope_type,
    );
    if (values.user_type !== 'nims_contact' && !employeeCode) nextErrors.employee_code = 'Employee code is required.';
    if (!existingProfile && !fullName) nextErrors.full_name = 'Full name is required.';
    if (!profileOnlyMd && values.user_type !== 'nims_contact' && !email) nextErrors.email = 'Email is required for Supabase Auth.';
    if (!profileOnlyMd && !values.mobile.trim()) nextErrors.mobile = 'Mobile number is required.';
    if (values.user_type !== 'nims_contact' && !values.role) nextErrors.role = 'Role is required.';
    if (mode === 'add' && values.user_type !== 'nims_contact' && needsState(values.role) && !values.state) nextErrors.state = 'State is required.';
    if (mode === 'add' && values.user_type !== 'nims_contact' && needsBusiness(values.role) && !values.business) nextErrors.business = 'Business is required.';
    if (mode === 'add' && values.user_type === 'internal' && values.hospital_access_enabled && !values.client_id) nextErrors.client_id = 'NIMS Hospital client is required.';
    if (mode === 'add' && values.user_type === 'internal' && values.hospital_access_enabled && !values.hospital_role_code) nextErrors.hospital_role_code = 'Hospital role is required.';
    if (mode === 'add' && values.user_type !== 'nims_contact' && !values.hospital_access_enabled && reportingRequiredRoles.has(values.role) && !values.manager_employee_code) {
      nextErrors.manager_employee_code = `${reportingLabel(values.role)} is required.`;
    }
    if (mode === 'add' && values.user_type !== 'nims_contact' && !values.hospital_access_enabled) {
      const accessRequired = values.user_type === 'client' || accessStarted;
      if (accessRequired && !values.access_business_vertical_id) nextErrors.access_business_vertical_id = 'Business Vertical is required.';
      if (values.user_type === 'client' && !values.access_client_id) nextErrors.access_client_id = 'Client is required.';
      if (accessRequired && !values.access_module_id) nextErrors.access_module_id = 'Module is required.';
      if (accessRequired && !values.access_role_id) nextErrors.access_role_id = 'Module Role is required.';
      if (accessRequired && !values.access_scope_type) nextErrors.access_scope_type = 'Scope is required.';
      if (values.access_scope_type === 'client' && !values.access_client_id) {
        nextErrors.access_client_id = 'Client is required for client scope.';
      }
      if (
        accessRequired &&
        values.access_scope_type &&
        !['global', 'business_vertical', 'client', 'all_client', 'employee_self'].includes(values.access_scope_type) &&
        !values.access_scope_id &&
        !values.access_scope_code &&
        !values.access_scope_text
      ) {
        nextErrors.access_scope_value = 'Scope Value is required.';
      }
      if (accessRequired && foundationError) nextErrors.access_business_vertical_id = 'Module access options are unavailable.';
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = 'Enter a valid email.';
    }
    if (
      values.manager_employee_code &&
      values.manager_employee_code.trim().toUpperCase() === employeeCode
    ) {
      nextErrors.manager_employee_code = 'Manager cannot be the same employee.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    if (mode === 'add' && values.user_type === 'nims_contact') {
      await onSave({
        user_type: 'nims_contact',
        full_name: fullName,
        mobile: values.mobile.trim(),
        designation: values.designation.trim() || null,
        department: values.department.trim() || null,
        email: email || null,
      });
      return;
    }

    const payload = {
      user_type: values.user_type,
      employee_code: employeeCode,
      full_name: fullName,
      display_name: values.display_name.trim() || fullName,
      mobile: values.mobile.trim() || null,
      email,
      state: values.state.trim() || null,
      role: values.role,
      designation: values.designation.trim() || null,
      department: values.department.trim() || null,
      business: values.business.trim() || null,
      requires_password_change: values.requires_password_change,
      mobile_access_enabled: values.mobile_access_enabled,
      web_access_enabled: values.web_access_enabled,
      manager_employee_code: values.manager_employee_code.trim().toUpperCase() || null,
      managers_manager_employee_code:
        values.managers_manager_employee_code.trim().toUpperCase() || null,
      business_head_employee_code:
        values.business_head_employee_code.trim().toUpperCase() || null,
      gm_employee_code: values.gm_employee_code.trim().toUpperCase() || null,
      coo_employee_code: values.coo_employee_code.trim().toUpperCase() || null,
    };
    if (mode === 'add') {
      const selectedAccessRole = foundation.roles.find((role) => role.id === values.access_role_id);
      const selectedAccessModule = foundation.modules.find((module) => module.id === values.access_module_id);
      const selectedAccessClient = foundation.clients.find((client) => client.id === values.access_client_id);
      const selectedAccessVertical = foundation.business_verticals.find((vertical) => vertical.id === values.access_business_vertical_id);
      payload.requires_password_change = false;
      payload.display_name = fullName;
      payload.role = values.user_type === 'client'
        ? (selectedAccessRole?.code === 'hospital_management' ? 'Hospital Management' : selectedAccessRole?.name || values.role)
        : values.role;
      if (values.temporary_password.trim()) {
        payload.temporary_password = values.temporary_password;
      }
      if (values.hospital_access_enabled && values.client_id) {
        payload.client_id = values.client_id;
        payload.access_client_id = values.client_id;
        payload.hospital_role_code = values.hospital_role_code;
      }
      payload.business = values.business.trim() || selectedAccessVertical?.name || null;
      payload.department = values.user_type === 'client' ? null : null;
      payload.designation = values.user_type === 'client' ? selectedAccessRole?.name || null : null;
      payload.reporting_manager_employee_code = values.user_type === 'client'
        ? null
        : values.manager_employee_code.trim().toUpperCase() || null;
      payload.create_profile_only = profileOnlyMd;
      payload.metadata = {
        user_type: values.user_type,
        access_client_name: selectedAccessClient?.name || null,
        access_module_code: selectedAccessModule?.code || null,
      };
      if (!values.hospital_access_enabled) {
        payload.access_assignment = {
          user_type: values.user_type,
          business_vertical_id: values.access_business_vertical_id,
          client_id: values.access_client_id || null,
          module_id: values.access_module_id,
          role_id: values.access_role_id,
          verification_status: values.access_verification_status,
          source: 'web_invite',
          scope: {
            scope_type: values.access_scope_type,
            scope_id: values.access_scope_type === 'business_vertical'
              ? values.access_business_vertical_id
              : values.access_scope_type === 'client'
                ? values.access_client_id
                : values.access_scope_id || null,
            scope_code: values.access_scope_code || null,
            scope_text: values.access_scope_text || null,
          },
        };
      }
      if (existingProfile?.id) {
        payload.existing_profile_id = existingProfile.id;
        payload.full_name = existingProfile.full_name || existingProfile.display_name || fullName || existingProfile.email;
        payload.employee_code = existingProfile.employee_code || employeeCode;
        payload.role = existingProfile.role || payload.role;
        payload.business = existingProfile.business || payload.business;
        payload.state = existingProfile.state || payload.state;
      }
    } else {
      delete payload.employee_code;
      payload.status = values.status;
      payload.is_active = values.is_active;
      payload.hospital_access = {
        enabled: Boolean(values.hospital_access_enabled),
        client_id: values.client_id || defaultNimsClientId || null,
        role_code: values.hospital_role_code,
      };
    }
    await onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              {mode === 'edit' ? 'Edit User' : 'Invite User'}
            </h2>
            <p className="text-sm font-semibold text-slate-500">
              {mode === 'edit'
                ? 'Updates the profile and linked Supabase Auth metadata.'
                : values.user_type === 'nims_contact'
                  ? 'Registers a NIMS client-side person by mobile number. No Supabase login is created.'
                  : 'Creates the profile and sends a Supabase password setup invite.'}
            </p>
          </div>
          <button type="button" aria-label="Close user form" onClick={onClose} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5">
          {serverError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
              {serverError}
            </div>
          ) : null}

          {mode === 'add' ? (
            <>
              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-950">Who are you creating?</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {userTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => update('user_type', option.value)}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-black ${
                        values.user_type === option.value
                          ? 'border-qpms-500 bg-qpms-50 text-qpms-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <h3 className="mt-5 text-sm font-bold text-slate-950">Basic Details</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {values.user_type !== 'nims_contact' ? (
                    <TextField name="employee_code" label="Employee Code" required value={values.employee_code} error={errors.employee_code} onChange={update} />
                  ) : null}
                  <TextField name="full_name" label="Full Name" required={!existingLookup?.profile} value={values.full_name} error={errors.full_name} onChange={update} />
                  <TextField name="email" label={values.user_type === 'nims_contact' ? 'Email' : 'Email'} required={!profileOnlyMd && values.user_type !== 'nims_contact'} type="email" value={values.email} error={errors.email} onChange={update} onBlur={values.user_type === 'nims_contact' ? undefined : checkExistingEmail} />
                  <TextField name="mobile" label="Mobile Number" required value={values.mobile} error={errors.mobile} onChange={update} />
                  {values.user_type === 'nims_contact' ? (
                    <>
                      <TextField name="designation" label="Designation" value={values.designation} error={errors.designation} onChange={update} />
                      <TextField name="department" label="Department" value={values.department} error={errors.department} onChange={update} />
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                        Client: NIMS Hyderabad
                      </div>
                    </>
                  ) : null}
                </div>
                {existingLookupLoading ? <p className="mt-2 text-xs font-bold text-slate-400">Checking for existing account...</p> : null}
                {existingLookupError ? <p className="mt-2 text-xs font-bold text-rose-600">{existingLookupError}</p> : null}
                {existingLookup?.profile ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold leading-5 text-emerald-800">
                    Existing account found: {existingLookup.profile.full_name || existingLookup.profile.email}. This submit will add module access only and will not change the employee profile.
                  </div>
                ) : null}
              </section>

              {values.user_type !== 'nims_contact' ? <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-950">Work Mapping</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <SelectField name="state" label="State" required={needsState(values.role)} value={values.state} options={stateOptions} error={errors.state} onChange={update} />
                  <SelectField name="business" label="Business" required={needsBusiness(values.role)} value={values.business} options={resolvedBusinessOptions} error={errors.business} onChange={update} />
                  <SelectField name="role" label="Base/Application Role" required value={values.role} options={roleOptions} error={errors.role} onChange={update} />
                </div>
                {values.role === 'MD' ? (
                  <label className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                    <input
                      type="checkbox"
                      checked={Boolean(values.create_profile_only)}
                      onChange={(event) => update('create_profile_only', event.target.checked)}
                    />
                    Create profile only, no login access now
                  </label>
                ) : null}
              </section> : null}

              {values.user_type === 'internal' ? (
                <section className="rounded-xl border border-slate-200 p-4">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <input
                      type="checkbox"
                      checked={Boolean(values.hospital_access_enabled)}
                      onChange={(event) => update('hospital_access_enabled', event.target.checked)}
                    />
                    Enable Hospital Ticketing
                  </label>
                  {values.hospital_access_enabled ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <SelectField name="client_id" label="Hospital Client" required value={values.client_id} options={nimsClientOptions} error={errors.client_id} disabled={foundationLoading} onChange={update} />
                      <SelectField name="hospital_role_code" label="Hospital Role" required value={values.hospital_role_code} options={nimsHospitalRoleOptions} error={errors.hospital_role_code} onChange={update} />
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                        Scope: NIMS client-wide
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {values.user_type === 'client' ? <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-slate-950">
                    {values.user_type === 'client' ? 'Client Access' : 'Additional Module Access'}
                  </h3>
                  {foundationLoading ? <span className="text-xs font-bold text-slate-400">Loading...</span> : null}
                </div>
                {values.user_type !== 'client' ? (
                  <p className="mt-1 text-xs font-semibold text-slate-500">Optional. Add this only when the employee needs a specific operational module.</p>
                ) : null}
                {foundationError ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                    {foundationError}
                    <button type="button" className="ml-2 underline" onClick={() => setFoundationError('')}>Dismiss</button>
                  </div>
                ) : null}
                {foundation.available === false ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    Unified access foundation is not available yet. Apply and validate the access foundation before creating unified assignments.
                  </p>
                ) : null}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SelectField
                    name="access_business_vertical_id"
                    label="Business Vertical"
                    required={values.user_type === 'client'}
                    value={values.access_business_vertical_id}
                    options={foundation.business_verticals.filter((item) => item.active !== false).map((item) => ({ value: item.id, label: item.name || item.code }))}
                    error={errors.access_business_vertical_id}
                    disabled={foundationLoading}
                    onChange={update}
                  />
                  <SelectField
                    name="access_client_id"
                    label="Client"
                    required={values.user_type === 'client'}
                    value={values.access_client_id}
                    options={filteredClients}
                    error={errors.access_client_id}
                    disabled={!values.access_business_vertical_id || foundationLoading}
                    onChange={update}
                  />
                  <SelectField
                    name="access_module_id"
                    label="Module"
                    required={values.user_type === 'client'}
                    value={values.access_module_id}
                    options={filteredModules}
                    error={errors.access_module_id}
                    disabled={!values.access_business_vertical_id || foundationLoading}
                    onChange={update}
                  />
                  <SelectField
                    name="access_role_id"
                    label={values.user_type === 'client' ? 'Client Role' : 'Module Role'}
                    required={values.user_type === 'client'}
                    value={values.access_role_id}
                    options={filteredAccessRoles}
                    error={errors.access_role_id}
                    disabled={!values.access_module_id || foundationLoading}
                    onChange={update}
                  />
                  <SelectField
                    name="access_scope_type"
                    label="Scope"
                    required={values.user_type === 'client'}
                    value={values.access_scope_type}
                    options={scopeTypeOptions}
                    error={errors.access_scope_type}
                    disabled={!values.access_role_id || foundationLoading}
                    onChange={update}
                  />
                  {['global', 'business_vertical', 'client', 'all_client', 'employee_self'].includes(values.access_scope_type) ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                      {values.access_scope_type === 'client'
                        ? 'Entire Client uses the selected client automatically.'
                        : 'Scope value is derived from the selected access context.'}
                    </div>
                  ) : (
                    <SelectField
                      name="access_scope_value"
                      label="Scope Value"
                      required
                      value={values.access_scope_id || values.access_scope_code}
                      options={scopeValueOptions}
                      error={errors.access_scope_value}
                      disabled={!values.access_scope_type || scopeOptionsLoading}
                      onChange={(_, value) => updateScopeValue(value)}
                    />
                  )}
                </div>
                {scopeOptionsLoading ? <p className="mt-2 text-xs font-bold text-slate-400">Loading scope values...</p> : null}
                {scopeOptionsError ? <p className="mt-2 text-xs font-bold text-rose-600">{scopeOptionsError}</p> : null}
                {values.access_scope_type && !scopeOptionsLoading && !scopeOptionsError && !['global', 'business_vertical', 'client', 'all_client', 'employee_self'].includes(values.access_scope_type) && scopeValueOptions.length === 0 ? (
                  <p className="mt-2 text-xs font-bold text-amber-700">No scope values are available for this selection.</p>
                ) : null}
                {accessPreview ? (
                  <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold leading-5 text-sky-800">
                    {accessPreview}
                  </p>
                ) : null}
              </section> : null}

              {!profileOnlyMd && values.user_type !== 'client' && values.user_type !== 'nims_contact' && !values.client_id ? <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-slate-950">Reporting Hierarchy</h3>
                  {hierarchyLoading ? <span className="text-xs font-bold text-slate-400">Loading...</span> : null}
                </div>

                {reportingRequiredRoles.has(values.role) ? (
                  <div className="mt-3">
                    <HierarchySelect
                      label={reportingLabel(values.role)}
                      value={values.manager_employee_code}
                      options={reportingOptions}
                      required
                      error={errors.manager_employee_code}
                      onChange={(value) => update('manager_employee_code', value)}
                    />
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                    {values.role === 'MD'
                      ? 'MD has no reporting manager.'
                      : `${reportingLabel(values.role)}: ${values.role === 'COO' ? employeeLabel(hierarchyOptions.md) : employeeLabel(hierarchyOptions.coo)}`}
                  </div>
                )}

                {hierarchyError ? (
                  <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{hierarchyError}</p>
                ) : null}
                {hierarchyOptions.warnings?.length ? (
                  <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    {hierarchyOptions.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Hierarchy Preview</p>
                  <div className="mt-2 space-y-1 text-sm font-semibold text-slate-700">
                    {values.role === 'FO' ? <p>Operations Manager: {employeeLabel(hierarchyPreview.operationsManager)}</p> : null}
                    {['FO', 'Operations Manager'].includes(values.role) ? <p>Branch Head: {employeeLabel(hierarchyPreview.branchHead)}</p> : null}
                    {['FO', 'KAM', 'Operations Manager', 'Branch Head'].includes(values.role) ? <p>{isIfmsBusiness(values.business) ? 'South Head' : 'GM'}: {employeeLabel(hierarchyPreview.gmLevel)}</p> : null}
                    {values.role !== 'MD' ? <p>COO: {employeeLabel(hierarchyPreview.coo || hierarchyOptions.coo)}</p> : null}
                    <p>MD: {values.role === 'MD' ? 'This user' : employeeLabel(hierarchyPreview.md)}</p>
                  </div>
                </div>
              </section> : null}
            </>
          ) : (
            <section className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-950">Employee Details</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextField name="employee_code" label="Employee Code" required value={values.employee_code} readOnly error={errors.employee_code} onChange={update} />
                <TextField name="full_name" label="Full Name" required value={values.full_name} error={errors.full_name} onChange={update} />
                <p className="sm:col-span-2 -mt-1 text-xs font-semibold text-amber-700">
                  Employee code repair must use the dedicated repair flow.
                </p>
                <TextField name="email" label="Email" required type="email" value={values.email} error={errors.email} onChange={update} />
                <TextField name="mobile" label="Mobile" required value={values.mobile} error={errors.mobile} onChange={update} />
                <SelectField name="state" label="State" value={values.state} options={stateOptions} onChange={update} />
                <SelectField name="business" label="Business" value={values.business} options={resolvedBusinessOptions} onChange={update} />
                <SelectField name="role" label="Role" required value={values.role} options={roleOptions} error={errors.role} onChange={update} />
              </div>
            </section>
          )}

          {mode === 'edit' ? (
            <section className="rounded-xl border border-slate-200 p-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={Boolean(values.hospital_access_enabled)}
                  onChange={(event) => update('hospital_access_enabled', event.target.checked)}
                />
                Hospital Ticketing Access
              </label>
              {values.hospital_access_enabled ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SelectField name="client_id" label="Hospital Client" required value={values.client_id || defaultNimsClientId} options={nimsClientOptions} error={errors.client_id} disabled={foundationLoading} onChange={update} />
                  <SelectField name="hospital_role_code" label="Hospital Role" required value={values.hospital_role_code} options={nimsHospitalRoleOptions} error={errors.hospital_role_code} onChange={update} />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                    Scope: NIMS client-wide
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {mode === 'add' && values.user_type !== 'nims_contact' ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <h3 className="text-sm font-bold text-slate-950">Password Setup Invite</h3>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                Leave temporary password blank for the normal invite email. Enter it only for controlled same-day UAT accounts.
              </p>
              <div className="mt-3 max-w-sm">
                <TextField
                  name="temporary_password"
                  label="Temporary Password"
                  type="password"
                  value={values.temporary_password}
                  error={errors.temporary_password}
                  onChange={update}
                />
              </div>
            </section>
          ) : null}

          {mode === 'edit' ? <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Hierarchy</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField name="manager_employee_code" label="Manager Employee Code" value={values.manager_employee_code} error={errors.manager_employee_code} onChange={update} />
              <TextField name="managers_manager_employee_code" label="Manager's Manager Code" value={values.managers_manager_employee_code} onChange={update} />
              <TextField name="business_head_employee_code" label="Business Head Code" value={values.business_head_employee_code} onChange={update} />
              <TextField name="gm_employee_code" label="GM Code" value={values.gm_employee_code} onChange={update} />
              <TextField name="coo_employee_code" label="COO Code" value={values.coo_employee_code} onChange={update} />
            </div>
          </section> : null}

          {mode === 'add' ? (
            <section className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-950">Review & Invite</h3>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-[11px] font-bold uppercase text-slate-400">Type</dt><dd className="font-semibold text-slate-800">{values.user_type === 'nims_contact' ? 'NIMS Client Person' : 'QPMS Employee'}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase text-slate-400">Name</dt><dd className="font-semibold text-slate-800">{existingLookup?.profile?.full_name || values.full_name || 'Not set'}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase text-slate-400">Email</dt><dd className="font-semibold text-slate-800">{values.email || (values.user_type === 'nims_contact' ? 'Optional' : 'Not set')}</dd></div>
                {values.user_type !== 'nims_contact' ? <div><dt className="text-[11px] font-bold uppercase text-slate-400">Primary Role</dt><dd className="font-semibold text-slate-800">{values.role || 'Not set'}</dd></div> : null}
                <div><dt className="text-[11px] font-bold uppercase text-slate-400">Client</dt><dd className="font-semibold text-slate-800">{values.user_type === 'nims_contact' ? 'NIMS Hyderabad' : selectedEmployeeClient?.name || selectedEmployeeClient?.code || 'Optional'}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase text-slate-400">{values.user_type === 'nims_contact' ? 'Designation' : 'Hospital Role'}</dt><dd className="font-semibold text-slate-800">{values.user_type === 'nims_contact' ? values.designation || 'Optional' : values.hospital_access_enabled ? optionLabel(nimsHospitalRoleOptions.find((option) => option.value === values.hospital_role_code)) : selectedAccessRole?.name || selectedAccessRole?.code || 'Optional'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-[11px] font-bold uppercase text-slate-400">Scope</dt><dd className="font-semibold text-slate-800">{values.hospital_access_enabled ? 'NIMS client-wide' : values.user_type === 'nims_contact' ? 'Registered mobile only' : values.access_scope_type ? scopeTypeLabel(values.access_scope_type) : 'Optional'}</dd></div>
              </dl>
            </section>
          ) : null}

          {mode === 'edit' || (values.user_type !== 'client' && values.user_type !== 'nims_contact') ? <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Access</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                ['mobile_access_enabled', 'Mobile Access Enabled'],
                ['web_access_enabled', 'Web Access Enabled'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                  <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => update(key, event.target.checked)} />
                  {label}
                </label>
              ))}
              {mode === 'edit' ? (
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                  <input type="checkbox" checked={Boolean(values.is_active)} onChange={(event) => update('is_active', event.target.checked)} />
                  Active Profile
                </label>
              ) : null}
            </div>
          </section> : null}

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
            <button type="button" disabled={busy} onClick={onClose} className="focus-ring rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className="focus-ring rounded-xl bg-qpms-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Saving...' : mode === 'edit' ? 'Save Changes' : values.user_type === 'nims_contact' ? 'Register Person' : profileOnlyMd ? 'Create MD Profile' : 'Invite User'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
