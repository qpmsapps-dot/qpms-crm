import { useEffect, useMemo, useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Camera,
  ClipboardCheck,
  Download,
  Edit3,
  Eye,
  FileText,
  Layers3,
  Lock,
  MapPin,
  Paperclip,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  UploadCloud,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Toast from '../components/Toast.jsx';
import { useAuth } from '../context/auth-context.js';
import { useWorkflow } from '../context/workflow-context.js';
import { canViewBdTeam, isAdmin, isApprovalReviewer, isCommercialTeam, isCoordinator, isFinanceTeam, isHrReviewer, isOperationsTeam } from '../data/mockUsers.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { sendProposalEmail, sendSiteVisitMomEmail } from '../services/mailService.js';
import { logAssessmentAuditRemote } from '../services/workflowRepository.js';
import { calculateManpowerCost } from '../services/costingEngine.js';
import { buildProposalRows, exportProposalToExcel, exportProposalToPdf, getProposalTemplateMetadata } from '../services/proposalService.js';
import { downloadSiteAssessmentWorkbook } from '../services/siteAssessmentWorkbookService.js';
import {
  SURVEY_SECTION_LABELS,
  createV2Survey,
  emptyEquipment,
  emptyManpower,
  updateV2Survey,
} from '../services/siteAssessmentV2.js';
import { validateAssessmentSection } from '../components/site-assessment/assessmentValidation.js';
import {
  ClientSiteSection,
  CommercialReviewSection,
  EquipmentManpowerSection,
  FacilityRequirementsSection,
} from '../components/site-assessment/AssessmentSections.jsx';

const surveySections = [
  'Basic Site Information',
  'Scope of IFM Services',
  'Hard Services',
  'Soft Services',
  'Landscaping & Pest Control',
  'HSE Compliance',
  'Manpower Requirement',
  'Tools / Equipment / Consumables',
  'Client KYC',
  'Risk Assessment',
  'Penalty Clauses',
  'Commercial Statement',
  'Approval Mechanism',
  'Final Remarks & Sign-Off',
];

const workflowStages = [
  'Site Visit Started',
  'Operations Review',
  'Coordinator Review',
  'HR Validation',
  'Commercial Review',
  'Finance Review',
  'Returned to BD',
  'Proposal Sent',
];

const photoSlots = [
  'Entrance',
  'Service Area',
  'Equipment Scope',
  'HK Area',
  'Washroom',
  'Electrical Room',
  'Fire Panel',
  'Pump Room',
  'DG Area',
  'Basement / Parking',
  'Waste Disposal Area',
];

const hardServiceGroups = [
  {
    key: 'mechanical',
    title: '3.1 Mechanical Services',
    items: ['HVAC Systems', 'Chillers', 'AHU', 'FCU', 'Ventilation Systems', 'Pumps', 'Fire Fighting System', 'STP / WTP', 'RO Plant', 'Air Compressors', 'Exhaust Systems'],
    fields: ['quantity', 'capacity', 'existingCondition', 'vendorSupportAvailable', 'remarks'],
  },
  {
    key: 'electrical',
    title: '3.2 Electrical Services',
    items: ['Main Panels / MDB', 'SMDB / DB', 'Generators', 'UPS Systems', 'Lighting Systems', 'Transformers', 'LT Panels', 'Solar Systems', 'Battery Banks'],
    fields: ['capacity', 'existingLoad', 'backupAvailability', 'amcExisting', 'remarks'],
  },
  {
    key: 'plumbing',
    title: '3.3 Plumbing Services',
    items: ['Water Supply', 'Drainage', 'Sewage', 'Water Tanks', 'Transfer Pumps', 'Pressure Pumps', 'Borewell Systems'],
    fields: ['quantity', 'existingCondition', 'operationalIssues', 'remarks'],
  },
  {
    key: 'technical',
    title: '3.4 Technical Services',
    items: ['BMS', 'CCTV', 'Access Control', 'Fire Alarm', 'PA Systems', 'Networking', 'Server Rooms', 'Data Center Cooling'],
    fields: ['quantity', 'existingCondition', 'vendorSupportAvailable', 'remarks'],
  },
];

const softServiceGroups = [
  {
    key: 'housekeeping',
    title: 'Housekeeping',
    items: ['Lobby', 'Common Areas', 'Washrooms', 'Cafeteria', 'Parking', 'External Areas', 'Glass Cleaning', 'Facade Cleaning', 'Pantry', 'Waste Collection Points'],
    fields: ['frequency', 'areaSize', 'manpowerRequired', 'shiftRequirement', 'remarks'],
  },
  {
    key: 'security',
    title: 'Security Services',
    items: ['CCTV Monitoring', 'Access Control', 'Visitor Management', 'Emergency Response', 'Parking Security', 'Night Patrol', 'Baggage Screening'],
    fields: ['numberOfGuards', 'shiftPattern', 'criticalAreas', 'risks', 'remarks'],
  },
  {
    key: 'wasteManagement',
    title: 'Waste Management',
    items: ['General Waste', 'Dry Waste', 'Wet Waste', 'Biomedical Waste', 'Hazardous Waste', 'E-Waste'],
    fields: ['disposalFrequency', 'vendorAvailable', 'segregationSystem', 'remarks'],
  },
];

const hseItems = ['Fire Safety', 'Emergency Exit', 'PPE', 'Chemical Storage', 'Safety Signage', 'Electrical Safety', 'Work at Height Safety', 'First Aid', 'Emergency Response Plan'];
const manpowerDepartments = ['Housekeeping', 'Security', 'Technical', 'Waste Management', 'Landscaping', 'Pantry', 'Helpdesk'];
const riskTypes = ['Financial Risk', 'Operational Risk', 'Compliance Risk', 'Workforce Risk', 'Safety Risk', 'Client Reputation Risk'];
const ifmScopeItems = ['Hard Services MEP', 'Soft Services Housekeeping', 'Security Services', 'Waste Management', 'Landscaping Irrigation', 'Pest Control', 'Helpdesk CAFM', 'Energy Management', 'Sustainability ESG', 'Other Services'];
const landscapeItems = ['Gardens', 'Indoor Plants', 'External Green Areas', 'Pest Control', 'Rodent Control', 'Mosquito Control'];

const defaultSurvey = {
  siteAddress: '',
  siteType: '',
  operatingHours: '',
  clientOccupancy: '',
  buildingAge: '',
  siteSurveyDate: '',
  assessedBy: '',
  siteContactPerson: '',
  contactNumber: '',
  contactEmail: '',
  totalSiteArea: '',
  contractPeriod: '',
  marginAgreed: '',
  marginType: 'Percentage',
  paymentTerms: '',
  groupOrSisterConcernBusiness: 'No',
  is247Operation: 'No',
  takeoverComplexity: 'Medium',
  ifmScope: {},
  hardServices: {},
  softServices: {},
  landscaping: {},
  hseCompliance: hseItems.map((item) => ({ item, status: 'Partial', severity: 'Medium', remarks: '' })),
  manpowerPlan: manpowerDepartments.map((department) => ({
    id: `${department}-1`,
    department,
    designation: department === 'Security' ? 'Security Guard' : department === 'Technical' ? 'Technician' : 'Associate',
    shiftType: 'General',
    gender: 'Any',
    count: 0,
    relieverRequired: 'No',
    otRequired: 'No',
    wageCategory: 'Skilled',
    remarks: '',
  })),
  allowances: {
    transport: { applicable: 'No', providedBy: 'Client', monthlyCost: 0, vehicleType: '', remarks: '' },
    food: { applicable: 'No', providedBy: 'Client', perDayCost: 0 },
    accommodation: { applicable: 'No', providedBy: 'Client', monthlyCost: 0 },
  },
  equipment: [{ id: 'equipment-1', name: 'Ride-on Scrubber', scopeResponsibility: 'QPMS Scope', brand: '', capacity: '', quantity: 1, purchaseType: 'Rental', vendor: '', monthlyCost: 0, clientResponsibility: '', qpmsResponsibility: '', remarks: '' }],
  chemicals: [{ id: 'chemical-1', name: 'Floor Cleaner', scopeResponsibility: 'QPMS Scope', brand: '', usageArea: 'Common Areas', quantity: 1, monthlyConsumption: '', unitCost: 0, monthlyCost: 0, vendor: '', clientResponsibility: '', qpmsResponsibility: '', remarks: '' }],
  tools: [{ id: 'tool-1', name: 'Mop Set', scopeResponsibility: 'QPMS Scope', quantity: 1, unitCost: 0, monthlyCost: 0, department: 'Housekeeping', vendor: '', clientResponsibility: '', qpmsResponsibility: '', remarks: '' }],
  ppeUniforms: [{ id: 'ppe-1', name: 'Uniform Set', scopeResponsibility: 'QPMS Scope', quantity: 1, unitCost: 0, monthlyCost: 0, vendor: '', clientResponsibility: '', qpmsResponsibility: '', remarks: '' }],
  machinery: [{ id: 'machine-1', name: 'Scrubbing Machine', scopeResponsibility: 'QPMS Scope', quantity: 1, unitCost: 0, monthlyCost: 0, vendor: '', clientResponsibility: '', qpmsResponsibility: '', remarks: '' }],
  clientKyc: { gstRegistration: '', pan: '', aadhaar: '', tan: '', kycRemarks: '', documentUploadPlaceholders: '', billingAddress: '', complianceDocs: '' },
  penaltyClauses: [{ id: 'penalty-1', penaltyClauseAvailable: 'No', penaltyDetails: '', riskImpact: 'Medium', remarks: '' }],
  risks: riskTypes.map((name) => ({ name, level: 'Medium', notes: '', mitigation: '' })),
  commercial: {
    billingComponents: [
      { id: 'bill-1', name: 'Manpower Billing', amount: 0 },
      { id: 'bill-2', name: 'Equipment Billing', amount: 0 },
    ],
    expenseComponents: [
      { id: 'expense-1', name: 'Wages', amount: 0 },
      { id: 'expense-2', name: 'Consumables', amount: 0 },
    ],
    nonBillableCost: 0,
    applicableZone: 'Z1',
  },
  approvalWorkflow: '',
  operationsTeamApproval: 'Pending',
  hrWageVetting: 'Pending',
  procurementEquipmentTccCosting: 'Pending',
  commercialVetting: 'Pending',
  financeViabilityReview: 'Pending',
  commercialGreenSignal: 'Pending',
  finalRemarks: '',
  signOffName: '',
};

function mergeSurvey(survey = {}) {
  return {
    ...defaultSurvey,
    ...survey,
    ifmScope: { ...defaultSurvey.ifmScope, ...(survey.ifmScope || {}) },
    hardServices: { ...defaultSurvey.hardServices, ...(survey.hardServices || {}) },
    softServices: { ...defaultSurvey.softServices, ...(survey.softServices || {}) },
    landscaping: { ...defaultSurvey.landscaping, ...(survey.landscaping || {}) },
    clientKyc: { ...defaultSurvey.clientKyc, ...(survey.clientKyc || {}) },
    commercial: {
      ...defaultSurvey.commercial,
      ...(survey.commercial || {}),
      billingComponents: survey.commercial?.billingComponents || defaultSurvey.commercial.billingComponents,
      expenseComponents: survey.commercial?.expenseComponents || defaultSurvey.commercial.expenseComponents,
    },
    allowances: { ...defaultSurvey.allowances, ...(survey.allowances || {}) },
    hseCompliance: survey.hseCompliance || defaultSurvey.hseCompliance,
    manpowerPlan: survey.manpowerPlan || defaultSurvey.manpowerPlan,
    equipment: survey.equipment || defaultSurvey.equipment,
    chemicals: survey.chemicals || defaultSurvey.chemicals,
    tools: survey.tools || defaultSurvey.tools,
    ppeUniforms: survey.ppeUniforms || defaultSurvey.ppeUniforms,
    machinery: survey.machinery || defaultSurvey.machinery,
    penaltyClauses: Array.isArray(survey.penaltyClauses) ? survey.penaltyClauses : survey.penaltyClauses ? [{ id: 'penalty-legacy', ...survey.penaltyClauses }] : defaultSurvey.penaltyClauses,
    risks: survey.risks || defaultSurvey.risks,
  };
}

function TextField({ label, value, onChange, multiline = false, type = 'text' }) {
  const fieldClass =
    'mt-2.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium leading-5 text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.14)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200';


  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-normal text-slate-500 dark:text-slate-400">{label}</span>
      {multiline ? (
        <textarea className={`${fieldClass} min-h-24 resize-none leading-6`} value={value || ''} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={fieldClass} type={type} value={value ?? ''} onChange={(event) => onChange(type === 'number' ? Number(event.target.value) : event.target.value)} />
      )}
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-normal text-slate-500 dark:text-slate-400">{label}</span>
      <select
        className="mt-2.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm outline-none transition focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.14)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function currency(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function fieldLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (text) => text.toUpperCase());
}

function buildSiteVisitMom(visit, survey) {
  const selectedHard = hardServiceGroups.flatMap((group) => Object.keys(survey.hardServices?.[group.key] || {}));
  const selectedSoft = softServiceGroups.flatMap((group) => Object.keys(survey.softServices?.[group.key] || {}));
  return {
    to: visit.email || '',
    cc: 'bdhead@qpms.in, commercial@qpms.in, operations@qpms.in',
    subject: `Site Visit Minutes of Meeting - ${visit.company} - myQPMS`,
    summary: `Pre-operational facility assessment completed for ${visit.company} at ${visit.location || visit.city}.`,
    scope: [...Object.keys(survey.ifmScope || {}).filter((key) => survey.ifmScope[key]?.selected), ...selectedHard, ...selectedSoft].join(', ') || 'IFM service scope to be finalized from survey inputs.',
    requirements: `Manpower rows: ${survey.manpowerPlan.length}. Equipment items: ${survey.equipment.length}. Tools: ${survey.tools.length}. Chemicals: ${survey.chemicals.length}.`,
    commercialNotes: `Estimated revenue ${currency(getCommercialTotals(survey).revenue)} with expected margin ${getCommercialTotals(survey).marginPercent.toFixed(1)}%.`,
    nextAction: 'Submit for Review Workflow',
    sent: false,
  };
}

function isProposalReady(visit) {
  const statuses = visit?.reviewStatus || {};
  return ['Returned to BD', 'Ready for Proposal', 'Proposal Generated'].includes(visit?.status)
    || ['Returned to BD', 'Ready for Proposal'].includes(visit?.currentStage)
    || ['Operations Review', 'Coordinator Costing Review', 'HR Validation', 'Commercial Review', 'Finance Review'].every((stage) => statuses[stage] === 'Approved');
}

function getCommercialTotals(survey) {
  const revenue = (survey.commercial.billingComponents || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenses = (survey.commercial.expenseComponents || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const nonBillable = Number(survey.commercial.nonBillableCost || 0);
  const monthlyCost = expenses + nonBillable;
  const margin = revenue - monthlyCost;
  const marginPercent = revenue ? (margin / revenue) * 100 : 0;
  return { revenue, expenses, nonBillable, monthlyCost, margin, marginPercent };
}

function getScopeLabels(scope = {}) {
  if (Array.isArray(scope)) return scope.filter(Boolean);
  return Object.entries(scope)
    .filter(([, value]) => value === true || value?.selected)
    .map(([key, value]) => value?.label || key)
    .filter(Boolean);
}

function buildProposalPayload(visit, survey, metadata) {
  const safeSurvey = mergeSurvey(survey);
  const rows = buildProposalRows({ survey: safeSurvey });
  const totals = getCommercialTotals(safeSurvey);
  const monthlyBilling = Number(safeSurvey.commercial?.estimated_monthly_billing || safeSurvey.commercial?.monthlyValue || safeSurvey.commercial?.monthly_value || 0);
  const proposalValue = Number(safeSurvey.commercial?.proposalValue || safeSurvey.commercial?.proposal_value || 0);
  const scopeOfWork = getScopeLabels(safeSurvey.ifmScope);
  const lineItems = rows.length
    ? rows
    : [{
        designation: 'IFM Services',
        quantity: 1,
        shift: safeSurvey.operatingHours || 'General',
        ratePerHead: monthlyBilling || totals.revenue,
        monthlyTotal: monthlyBilling || totals.revenue,
        managementFee: Number(safeSurvey.commercial?.managementFee || 0),
        contractValue: proposalValue || (monthlyBilling || totals.revenue) * 12,
        wageCategory: safeSurvey.commercial?.wageCategory || '',
        gender: 'Any',
      }];
  const monthlyValue = lineItems.reduce((sum, row) => sum + Number(row.monthlyTotal || 0), 0) || monthlyBilling;
  const annualValue = lineItems.reduce((sum, row) => sum + Number(row.contractValue || 0), 0) || proposalValue || monthlyValue * 12;

  return {
    proposalNumber: `myQPMS-PROP-${String(Date.now()).slice(-6)}`,
    clientName: visit?.company || '',
    siteDetails: [visit?.siteName || visit?.location, visit?.city, visit?.state].filter(Boolean).join(', '),
    scopeOfWork,
    manpowerRequirement: safeSurvey.manpowerPlan || [],
    costingSummary: {
      monthlyValue,
      annualValue,
      monthlyCost: totals.monthlyCost,
      margin: totals.margin,
      marginPercent: totals.marginPercent,
      managementFee: Number(safeSurvey.commercial?.managementFee || safeSurvey.commercial?.management_fee || 0),
    },
    commercialNotes: safeSurvey.commercial?.notes || safeSurvey.commercial?.commercial_notes || safeSurvey.finalRemarks || 'Commercial terms prepared from approved site assessment.',
    approvalStatus: visit?.approvalStatus || visit?.status || 'Approved',
    to: visit?.email || '',
    cc: [visit?.assigned_bd_email, 'bdhead@qpms.in'].filter(Boolean).join(', '),
    subject: `Business Proposal - ${visit?.company || 'Client'} - myQPMS`,
    templateName: 'New Business Proposal Format.xlsx',
    templatePath: metadata.templatePath,
    supportedExports: metadata.supportedExports,
    proposalValue: annualValue,
    monthlyValue,
    projectedRevenue: monthlyValue,
    monthlyCost: totals.monthlyCost,
    margin: totals.margin,
    marginPercent: totals.marginPercent,
    lineItems,
    body: [
      `Dear ${visit?.contact || 'Client'},`,
      '',
      `Please find the myQPMS facility management proposal for ${visit?.company || 'your site'}.`,
      `Scope of work: ${scopeOfWork.join(', ') || 'IFM services as per approved assessment'}`,
      `Monthly value: ${currency(monthlyValue)}`,
      `Annual contract value: ${currency(annualValue)}`,
      `Approval status: ${visit?.approvalStatus || visit?.status || 'Approved'}`,
      '',
      'Regards,',
      'myQPMS Business Development Team',
    ].join('\n'),
  };
}

function sectionSnapshot(section, survey) {
  const map = {
    'Basic Site Information': ['siteAddress', 'siteType', 'operatingHours', 'clientOccupancy', 'buildingAge', 'takeoverComplexity', 'siteSurveyDate', 'assessedBy', 'siteContactPerson', 'contactNumber', 'contactEmail', 'totalSiteArea', 'contractPeriod', 'marginAgreed', 'marginType', 'paymentTerms'],
    'Scope of IFM Services': ['ifmScope'],
    'Hard Services': ['hardServices'],
    'Soft Services': ['softServices'],
    'Landscaping & Pest Control': ['landscaping', 'pestControl'],
    'HSE & Statutory Compliance': ['hseCompliance'],
    'Manpower Deployment': ['manpower'],
    'Tools, Equipment & Consumables': ['tools', 'equipment', 'consumables'],
    'Client KYC & Commercial Inputs': ['clientKyc', 'commercial'],
    'Risk Assessment': ['riskAssessment'],
    'Commercial Statement': ['commercialStatement', 'commercial'],
    'Approval Workflow': ['approvalWorkflow'],
    'Final Remarks': ['finalRemarks'],
  };
  return (map[section] || []).reduce((snapshot, key) => ({ ...snapshot, [key]: survey?.[key] }), {});
}

function normalizeStage(stage) {
  return stage === 'Site Survey / Assessment' ? 'Pre-Operational Assessment' : stage;
}

function SummaryPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-950/55">
      <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-5 text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function CompactStatusBadge({ label, value, tone = 'slate' }) {
  const toneClass = {
    slate: 'border-slate-200 bg-white/80 text-slate-700 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200',
    blue: 'border-qpms-200 bg-qpms-50 text-qpms-700 dark:border-qpms-500/30 dark:bg-qpms-500/10 dark:text-qpms-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm ${toneClass}`}>
      <span className="text-slate-500 dark:text-slate-400">{label}:</span>
      <span className="text-current">{value}</span>
    </span>
  );
}

function ButtonContent({ loading, icon: Icon, children }) {
  return (
    <>
      {loading ? <span className="button-spinner" aria-hidden="true" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{children}</span>
    </>
  );
}

function VisitMeta({ icon, label, value }) {
  const IconComponent = icon;
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900/70">
      <IconComponent className="mt-0.5 h-4 w-4 shrink-0 text-qpms-600 dark:text-qpms-300" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">{label}</p>
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{value || 'Not available'}</p>
      </div>
    </div>
  );
}

function AssessmentQueueCard({ visit, onOpenAssessment, onOpenMom, onGenerateProposal, proposalLoading }) {
  const readyForProposal = isProposalReady(visit);
  const sections = [
    { label: 'Site Details', icon: MapPin, value: [visit.city, visit.state].filter(Boolean).join(', ') || 'Captured' },
    { label: 'Manpower', icon: UserRound, value: `${visit.survey?.manpowerPlan?.length || 0} rows` },
    { label: 'Costing', icon: WalletCards, value: visit.survey?.commercialStatement ? 'Ready' : 'Draft' },
    { label: 'MOM', icon: FileText, value: visit.siteMom ? 'Available' : visit.momStatus || 'Pending' },
    { label: 'Attachments', icon: Paperclip, value: `${visit.photos?.length || 0} files` },
    { label: 'Approval', icon: BadgeCheck, value: visit.approvalStatus || visit.currentStage || 'Draft' },
  ];
  return (
    <Motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={onOpenAssessment}
      className={[
        'group cursor-pointer overflow-hidden rounded-3xl border bg-white shadow-sm transition dark:bg-slate-950/70',
        'border-slate-200 hover:border-qpms-200 hover:shadow-xl dark:border-slate-800 dark:hover:border-qpms-500/35',
      ].join(' ')}
    >
      <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white p-5 dark:border-slate-800 dark:from-slate-900/70 dark:to-slate-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold leading-6 text-slate-950 dark:text-white">{visit.company}</h3>
              {visit.priority ? (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25">{visit.priority}</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{visit.leadId || `Lead ${visit.leadId || visit.lead_id || visit.id}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={visit.status || 'Scheduled'} />
            <CompactStatusBadge label="Stage" value={normalizeStage(visit.currentStage || 'Assessment')} tone="blue" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <VisitMeta icon={UserRound} label="Primary contact" value={visit.contact} />
        <VisitMeta icon={MapPin} label="Location" value={[visit.location, visit.city, visit.state].filter(Boolean).join(', ')} />
        <VisitMeta icon={CalendarClock} label="Visit schedule" value={`${formatDate(visit.scheduledVisitDate)}${visit.scheduledVisitTime ? `, ${visit.scheduledVisitTime}` : ''}`} />
        <VisitMeta icon={ClipboardCheck} label="Assigned BD" value={visit.assigned_bd_executive || visit.executive} />
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/55">
          <div className="mb-3 flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-qpms-600 dark:text-qpms-300" />
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assessment workspace</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.label} className="rounded-xl border border-white bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-qpms-600 dark:text-qpms-300" />
                    <span className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{section.label}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{section.value}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <CompactStatusBadge label="MOM" value={visit.momStatus || 'Pending'} tone="amber" />
          {readyForProposal ? <CompactStatusBadge label="Proposal" value={visit.status === 'Proposal Sent' ? 'Sent' : 'Ready'} tone="blue" /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenAssessment(); }} className="focus-ring rounded-xl bg-gradient-to-r from-qpms-700 to-qpms-500 px-3.5 py-2 text-xs font-bold text-white shadow-lg shadow-qpms-600/20 hover:from-qpms-800 hover:to-qpms-600">
            Open Assessment
          </button>
          {readyForProposal ? (
            <button type="button" disabled={proposalLoading} onClick={(event) => { event.stopPropagation(); onGenerateProposal(); }} className="focus-ring rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              Generate Proposal
            </button>
          ) : null}
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenMom(); }} className="focus-ring rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            {visit.siteMom ? 'View Site Visit MOM' : 'Create Site Visit MOM'}
          </button>
        </div>
      </div>
    </Motion.article>
  );
}

function ServiceScopeGrid({ items, values, onChange }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const selected = Boolean(values[item]?.selected);
        return (
          <button
            type="button"
            key={item}
            onClick={() => onChange(item, { ...values[item], selected: !selected })}
            className={[
              'rounded-2xl border p-5 text-left transition hover:-translate-y-0.5',
              selected
                ? 'border-qpms-300 bg-qpms-50 shadow-[0_16px_40px_rgba(36,68,164,0.12)] dark:border-qpms-500/40 dark:bg-qpms-500/10'
                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/55',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{item}</span>
              <span className={`h-3 w-3 rounded-full ${selected ? 'bg-qpms-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ExpandableServiceGroup({ group, values, onChange }) {
  const groupValues = values[group.key] || {};

  function updateItem(item, patch) {
    onChange(group.key, {
      ...groupValues,
      [item]: {
        ...(groupValues[item] || {}),
        ...patch,
      },
    });
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
      <h4 className="text-[15px] font-bold text-slate-950 dark:text-white">{group.title}</h4>
      <div className="mt-4 grid gap-3">
        {group.items.map((item) => {
          const selected = Boolean(groupValues[item]?.selected);
          return (
            <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70">
              <button type="button" onClick={() => updateItem(item, { selected: !selected })} className="flex w-full items-center justify-between gap-3 text-left">
                <span className="font-semibold text-slate-900 dark:text-white">{item}</span>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${selected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {selected ? 'Selected' : 'Select'}
                </span>
              </button>
              {selected ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {group.fields.map((field) =>
                    field.includes('Available') || field.includes('Existing') || field === 'backupAvailability' || field === 'amcExisting' ? (
                      <SelectField key={field} label={fieldLabel(field)} value={groupValues[item]?.[field] || 'No'} onChange={(value) => updateItem(item, { [field]: value })} options={['Yes', 'No', 'Partial', 'NA']} />
                    ) : (
                      <TextField key={field} label={fieldLabel(field)} value={groupValues[item]?.[field] || ''} onChange={(value) => updateItem(item, { [field]: value })} multiline={field === 'remarks' || field === 'risks' || field === 'operationalIssues'} />
                    ),
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PhotoEvidenceSection({ photos, onAdd, onRemove, onPreview }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-[17px] font-bold text-slate-950 dark:text-white">Site Photos & Evidence</h4>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Upload evidence only from Basic Site Information. Other sections stay structured and audit-focused.</p>
        </div>
        <span className="rounded-full bg-qpms-50 px-3 py-1 text-xs font-bold text-qpms-700 dark:bg-qpms-500/15 dark:text-qpms-200">
          {Object.values(photos).reduce((sum, items) => sum + items.length, 0)} images
        </span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {photoSlots.map((slot) => {
          const slotPhotos = photos[slot] || [];
          return (
            <div key={slot} className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-800 dark:text-white">{slot}</p>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-950">{slotPhotos.length}</span>
              </div>
              <label className="mt-3 flex h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-slate-200 bg-white text-center text-slate-400 transition hover:border-qpms-300 hover:text-qpms-600 dark:border-slate-800 dark:bg-slate-950">
                <UploadCloud className="h-6 w-6" />
                <span className="mt-2 text-xs font-bold">Drop or browse image</span>
                <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => onAdd(slot, Array.from(event.target.files || []))} />
              </label>
              {slotPhotos.length ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {slotPhotos.map((photo) => (
                    <div key={photo.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800">
                      <img src={photo.url} alt={photo.name} className="h-20 w-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-slate-950/0 opacity-0 transition group-hover:bg-slate-950/45 group-hover:opacity-100">
                        <button type="button" onClick={() => onPreview(photo)} className="rounded-lg bg-white p-1.5 text-slate-700">
                          <Eye className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => onRemove(slot, photo.id)} className="rounded-lg bg-white p-1.5 text-rose-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AuditTable({ rows, onChange }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-950">
            <tr>
              {['Compliance Item', 'Status', 'Risk Severity', 'Remarks'].map((heading) => (
                <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {rows.map((row, index) => (
              <tr key={row.item}>
                <td className="px-4 py-3 text-sm font-bold text-slate-900 dark:text-white">{row.item}</td>
                <td className="px-4 py-3"><SelectField label="" value={row.status} onChange={(value) => onChange(index, { status: value })} options={['Compliant', 'Partial', 'Non-Compliant']} /></td>
                <td className="px-4 py-3"><SelectField label="" value={row.severity} onChange={(value) => onChange(index, { severity: value })} options={['Low', 'Medium', 'High', 'Critical']} /></td>
                <td className="px-4 py-3 min-w-64"><TextField label="" value={row.remarks} onChange={(value) => onChange(index, { remarks: value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableTable({ columns, rows, onChange, onAdd, onRemove, onDuplicate, addLabel }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-3 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{column.label}</th>
              ))}
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key} className="min-w-36 px-3 py-3">
                    {column.type === 'select' ? (
                      <SelectField label="" value={row[column.key]} onChange={(value) => onChange(rowIndex, { [column.key]: value })} options={column.options} />
                    ) : (
                      <TextField label="" type={column.type || 'text'} value={row[column.key]} onChange={(value) => onChange(rowIndex, { [column.key]: value })} />
                    )}
                  </td>
                ))}
                <td className="px-3 py-3">
                  <div className="flex gap-2">
                    {onDuplicate ? (
                      <button type="button" onClick={() => onDuplicate(rowIndex)} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Duplicate row">
                        <Plus className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button type="button" onClick={() => onRemove(rowIndex)} className="rounded-xl border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={onAdd} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </section>
  );
}

function RiskCards({ risks, onChange }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {risks.map((risk, index) => (
        <section key={risk.name} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/15">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-950 dark:text-white">{risk.name}</h4>
          </div>
          <div className="mt-4 grid gap-4">
            <SelectField label="Risk Level" value={risk.level} onChange={(value) => onChange(index, { level: value })} options={['Low', 'Medium', 'High', 'Critical']} />
            <TextField label="Notes" value={risk.notes} onChange={(value) => onChange(index, { notes: value })} multiline />
            <TextField label="Mitigation Plan" value={risk.mitigation} onChange={(value) => onChange(index, { mitigation: value })} multiline />
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Sites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: routeVisitId } = useParams();
  const {
    siteVisits,
    saveSiteSurvey,
    saveSiteVisitMom,
    sendSiteVisitMom,
    submitCommercialReview,
    generateProposal,
    markProposalSent,
    uploadSiteImage,
  } = useWorkflow();
  const [query, setQuery] = useState('');
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [surveyDraft, setSurveyDraft] = useState(null);
  const [photoEvidence, setPhotoEvidence] = useState({});
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [siteMomDraft, setSiteMomDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [autoSaveLabel, setAutoSaveLabel] = useState('Draft saved');
  const [draftVisitId, setDraftVisitId] = useState(null);
  const [pendingAction, setPendingAction] = useState('');
  const [sectionAudit, setSectionAudit] = useState({});
  const [editingSection, setEditingSection] = useState('');
  const [pendingEditSection, setPendingEditSection] = useState('');
  const [momComposerVisit, setMomComposerVisit] = useState(null);
  const [proposalPreviewVisit, setProposalPreviewVisit] = useState(null);
  const [proposalDraft, setProposalDraft] = useState(null);
  const [workbookExporting, setWorkbookExporting] = useState(false);
  const [showWorkflowTimeline, setShowWorkflowTimeline] = useState(false);
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const adminDemoAccess = isAdmin(user);
  usePageTitle('Site Visit & Estimation');

  const visibleSiteVisits = useMemo(() => {
    if (canViewBdTeam(user) || isApprovalReviewer(user)) return siteVisits;
    return siteVisits.filter((visit) => visit.assigned_bd_email === user?.email || visit.created_by_user_id === user?.id);
  }, [siteVisits, user]);

  const selectedVisit = visibleSiteVisits.find((visit) => String(visit.id) === String(routeVisitId));
  const selectedStage = normalizeStage(selectedVisit?.currentStage || 'Pre-Operational Assessment');
  const roleVisibleSections = useMemo(() => {
    return SURVEY_SECTION_LABELS;
  }, [user]);
  const activeSection = roleVisibleSections[activeSectionIndex] || roleVisibleSections[0];
  const roleCanEditActiveSection = !isApprovalReviewer(user)
    || ((isCommercialTeam(user) || isFinanceTeam(user)) && activeSection === 'Commercial Inputs & Review')
    || ((isOperationsTeam(user) || isCoordinator(user) || isHrReviewer(user)) && activeSection === 'Equipment, Manpower & MPD');
  const activeSectionAudit = sectionAudit[activeSection];
  const isSectionSaved = Boolean(activeSectionAudit);
  const isEditingActiveSection = editingSection === activeSection;
  const isActiveSectionLocked = !roleCanEditActiveSection;
  const isFirstStep = activeSectionIndex === 0;
  const isFinalStep = activeSectionIndex === roleVisibleSections.length - 1;
  const proposalMetadata = getProposalTemplateMetadata();
  const selectedVisitReadyForProposal = isProposalReady(selectedVisit);

  const filteredVisits = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return visibleSiteVisits;
    return visibleSiteVisits.filter((visit) =>
      [visit.company, visit.contact, visit.state, visit.city, visit.location, visit.status].some((item) =>
        String(item || '').toLowerCase().includes(value),
      ),
    );
  }, [query, visibleSiteVisits]);

  const queueKpis = useMemo(
    () => [
      {
        label: 'Scheduled Visits',
        value: visibleSiteVisits.filter((visit) => visit.status === 'Scheduled' || visit.currentStage === 'Pre-Operational Assessment').length,
        tone: 'border-qpms-100 bg-qpms-50/80 text-qpms-700 dark:border-qpms-500/20 dark:bg-qpms-500/10 dark:text-qpms-200',
      },
      {
        label: 'Assessments Drafted',
        value: visibleSiteVisits.filter((visit) => visit.assessmentId || visit.assessmentStatus === 'Draft').length,
        tone: 'border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
      },
      {
        label: 'MOM Pending',
        value: visibleSiteVisits.filter((visit) => !['Created', 'Sent'].includes(visit.momStatus)).length,
        tone: 'border-amber-100 bg-amber-50/80 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200',
      },
      {
        label: 'Commercial Review Ready',
        value: visibleSiteVisits.filter((visit) => ['Commercial Review', 'Parallel Review'].includes(visit.currentStage) || ['Commercial Review', 'Pending Review'].includes(visit.status)).length,
        tone: 'border-violet-100 bg-violet-50/80 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200',
      },
    ],
    [visibleSiteVisits],
  );

  function showToast(message, type = 'success') {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3000);
  }

  function markChanged() {
    setAutoSaveLabel('Unsaved changes');
  }

  function rememberSectionAudit(actionType) {
    setSectionAudit((current) => ({
      ...current,
      [activeSection]: {
        actionType,
        savedAt: new Date().toISOString(),
        savedBy: user?.name || user?.email || 'Current user',
        savedByRole: user?.role || '',
      },
    }));
  }

  function handleBackToQueue() {
    if (autoSaveLabel === 'Unsaved changes' && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate('/sites');
  }

  function beginEditSection() {
    setPendingEditSection(activeSection);
  }

  function confirmEditSection() {
    setEditingSection(pendingEditSection);
    logAssessmentAuditRemote({
      visit: selectedVisit,
      sectionName: pendingEditSection,
      actionType: 'Section Edited',
      user,
      oldValue: sectionSnapshot(pendingEditSection, selectedVisit?.survey),
      newValue: sectionSnapshot(pendingEditSection, surveyDraft),
      remarks: 'User unlocked saved section for editing.',
    });
    setPendingEditSection('');
    setAutoSaveLabel('Editing saved section');
  }

  function cancelEditSection() {
    setEditingSection('');
    setAutoSaveLabel('Draft saved');
  }

  function selectedScopeCount(scope = {}) {
    return Object.values(scope || {}).filter((item) => item?.selected || item === true).length;
  }

  function validateSection(section = activeSection) {
    if (SURVEY_SECTION_LABELS.includes(section)) {
      const errors = validateAssessmentSection(section, surveyDraft, {
        role: user?.role || '',
        isSubmission: section === 'Commercial Inputs & Review',
      });
      setValidationErrors(errors);
      return errors.length === 0;
    }
    if (adminDemoAccess) {
      setValidationErrors([]);
      return true;
    }
    const errors = [];
    if (section === 'Basic Site Information') {
      if (!surveyDraft?.siteAddress?.trim()) errors.push('Site Address is required.');
      if (!surveyDraft?.siteType?.trim()) errors.push('Site Type is required.');
      if (!surveyDraft?.siteSurveyDate?.trim()) errors.push('Site Survey Date is required.');
      if (!surveyDraft?.assessedBy?.trim()) errors.push('Assessed By is required.');
    }
    if (section === 'Scope of IFM Services' && !selectedScopeCount(surveyDraft?.ifmScope)) {
      errors.push('Select at least one IFM service scope.');
    }
    if (section === 'Manpower Requirement' && !(surveyDraft?.manpowerPlan || []).length) {
      errors.push('Add at least one manpower requirement row.');
    }
    if (section === 'Commercial Statement' && !(surveyDraft?.commercial?.billingComponents || []).length) {
      errors.push('Add at least one billing component.');
    }
    if (section === 'Final Remarks & Sign-Off') {
      if (!surveyDraft?.finalRemarks?.trim()) errors.push('Final Remarks are required.');
      if (!surveyDraft?.signOffName?.trim()) errors.push('Assessor / Sign-Off Name is required.');
    }
    setValidationErrors(errors);
    return errors.length === 0;
  }

  function handlePreviousStep() {
    setValidationErrors([]);
    setActiveSectionIndex((index) => Math.max(0, index - 1));
  }

  function handleNextStep() {
    if (!validateSection()) return;
    setActiveSectionIndex((index) => Math.min(roleVisibleSections.length - 1, index + 1));
    setValidationErrors([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function surveySavePayload() {
    if (!surveyDraft || !SURVEY_SECTION_LABELS.includes(activeSection)) return surveyDraft;
    const sectionKey = {
      'Client & Site': 'client_site',
      'Facility & Service Requirements': 'facility_requirements',
      'Equipment, Manpower & MPD': 'equipment_manpower',
      'Commercial Inputs & Review': 'commercial_inputs',
    }[activeSection];
    return {
      ...surveyDraft,
      __sectionCode: sectionKey,
      __sectionName: activeSection,
      __sectionData: surveyDraft[sectionKey] || {},
    };
  }

  useEffect(() => {
    if (!routeVisitId || !selectedVisit || !surveyDraft || autoSaveLabel !== 'Unsaved changes') return undefined;
    const timer = window.setInterval(() => {
      saveSiteSurvey(selectedVisit.id, surveySavePayload(), 'Draft', user);
      setAutoSaveLabel('Saved just now');
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoSaveLabel, routeVisitId, saveSiteSurvey, selectedVisit, surveyDraft, user]);

  function openVisitPage(visit) {
    navigate(`/site-visit/${visit.id}`);
  }

  function openQueueMomWorkspace(visit) {
    setSiteMomDraft(visit.siteMom || buildSiteVisitMom(visit, mergeSurvey(visit.survey)));
    setMomComposerVisit(visit);
  }

  function updateSurveyDraft(key, value) {
    markChanged();
    setSurveyDraft((current) => ({ ...current, [key]: value }));
  }

  function updateV2Field(section, key, value) {
    markChanged();
    setSurveyDraft((current) => updateV2Survey(current, section, key, value));
  }

  function updateV2Contact(index, patch) {
    markChanged();
    setSurveyDraft((current) => {
      const contacts = [...(current.client_site?.contacts || [])];
      if (patch?.add) contacts.push({ name: '', designation: '', phone: '', mobile: '', fax: '', email: '', isPrimary: false });
      else contacts[index] = { ...contacts[index], ...patch };
      return updateV2Survey(current, 'client_site', 'contacts', contacts.map((contact, contactIndex) => ({ ...contact, isPrimary: contactIndex === 0 ? true : Boolean(contact.isPrimary) })));
    });
  }

  function updateV2Array(group, index, patch) {
    markChanged();
    setSurveyDraft((current) => {
      const rows = [...(current.equipment_manpower?.[group] || [])];
      rows[index] = { ...rows[index], ...patch };
      return updateV2Survey(current, 'equipment_manpower', group, rows);
    });
  }

  function addV2Row(group) {
    markChanged();
    setSurveyDraft((current) => updateV2Survey(current, 'equipment_manpower', group, [...(current.equipment_manpower?.[group] || []), group.includes('equipment') ? emptyEquipment() : emptyManpower()]));
  }

  function removeV2Row(group, index) {
    markChanged();
    setSurveyDraft((current) => updateV2Survey(current, 'equipment_manpower', group, (current.equipment_manpower?.[group] || []).filter((_, rowIndex) => rowIndex !== index)));
  }

  function duplicateV2Row(group, index) {
    markChanged();
    setSurveyDraft((current) => {
      const rows = current.equipment_manpower?.[group] || [];
      const copy = { ...rows[index], id: `${group}-${Date.now()}` };
      return updateV2Survey(current, 'equipment_manpower', group, [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
    });
  }

  function copyV2Rows(kind) {
    markChanged();
    setSurveyDraft((current) => {
      const data = current.equipment_manpower || {};
      const source = kind === 'equipment' ? data.current_equipment : data.current_manpower;
      const target = kind === 'equipment' ? 'suggested_equipment' : 'suggested_manpower';
      return updateV2Survey(current, 'equipment_manpower', target, source.map((row) => ({ ...row, id: `${target}-${Date.now()}-${Math.random().toString(16).slice(2)}` })));
    });
  }

  function updateNested(section, value) {
    markChanged();
    setSurveyDraft((current) => ({ ...current, [section]: value }));
  }

  function updateArray(section, index, patch) {
    markChanged();
    setSurveyDraft((current) => ({
      ...current,
      [section]: current[section].map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  }

  function addRow(section, row) {
    markChanged();
    setSurveyDraft((current) => ({ ...current, [section]: [...current[section], { ...row, id: `${section}-${Date.now()}` }] }));
  }

function removeRow(section, index) {
  markChanged();
  setSurveyDraft((current) => ({ ...current, [section]: current[section].filter((_, itemIndex) => itemIndex !== index) }));
}

function duplicateRow(section, index) {
  markChanged();
  setSurveyDraft((current) => ({
    ...current,
    [section]: [
      ...current[section].slice(0, index + 1),
      { ...current[section][index], id: `${section}-${Date.now()}` },
      ...current[section].slice(index + 1),
    ],
  }));
}

  async function addPhotos(slot, files) {
    const nextPhotos = files.map((file) => ({ id: `${slot}-${file.name}-${Date.now()}-${Math.random()}`, name: file.name, url: URL.createObjectURL(file) }));
    setPhotoEvidence((current) => ({ ...current, [slot]: [...(current[slot] || []), ...nextPhotos] }));
    if (selectedVisit) {
      const uploaded = await Promise.all(
        files.map((file) =>
          uploadSiteImage({
            visit: selectedVisit,
            assessmentId: selectedVisit.assessmentId,
            category: slot,
            file,
            uploadedBy: user?.email,
          }),
        ),
      );
      const uploadedPhotos = uploaded.filter(Boolean);
      if (uploadedPhotos.length) {
        setPhotoEvidence((current) => ({ ...current, [slot]: [...(current[slot] || []), ...uploadedPhotos] }));
        showToast('Site images uploaded to Supabase', 'success');
      }
    }
  }

  function removePhoto(slot, id) {
    setPhotoEvidence((current) => ({ ...current, [slot]: (current[slot] || []).filter((photo) => photo.id !== id) }));
  }

  function updateMomDraft(key, value) {
    setSiteMomDraft((current) => ({ ...current, [key]: value }));
  }

  async function handleSaveDraft() {
    setPendingAction('saveSiteDraft');
    setAutoSaveLabel('Saving...');
    showToast('Saving...', 'info');
    try {
      await Promise.resolve(saveSiteSurvey(selectedVisit.id, surveySavePayload(), 'Draft', user));
      const actionType = isSectionSaved ? 'Section Resaved' : 'Section Saved';
      await logAssessmentAuditRemote({
        visit: selectedVisit,
        sectionName: activeSection,
        actionType,
        user,
        oldValue: sectionSnapshot(activeSection, selectedVisit.survey),
        newValue: sectionSnapshot(activeSection, surveyDraft),
        remarks: isSectionSaved ? 'Saved section edited and resaved.' : 'Section saved.',
      });
      rememberSectionAudit(actionType);
      setEditingSection('');
      setAutoSaveLabel('Saved successfully');
      showToast('Saved successfully', 'success');
    } catch (error) {
      setAutoSaveLabel('Failed to save');
      showToast(`Failed to save: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleGenerateMom() {
    setPendingAction('generateSiteMom');
    setAutoSaveLabel('Saving...');
    showToast('Saving...', 'info');
    try {
      await Promise.resolve(saveSiteSurvey(selectedVisit.id, surveySavePayload(), 'Draft', user));
      const nextMom = buildSiteVisitMom(selectedVisit, surveyDraft);
      setSiteMomDraft(nextMom);
      await Promise.resolve(saveSiteVisitMom(selectedVisit.id, nextMom));
      setMomComposerVisit(selectedVisit);
      setAutoSaveLabel('Saved successfully');
      showToast('Site Visit MOM generated', 'success');
    } catch (error) {
      setAutoSaveLabel('Failed to save');
      showToast(`Failed to save: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleExportSurveyWorkbook() {
    if (!selectedVisit || !surveyDraft || workbookExporting) return;
    setWorkbookExporting(true);
    try {
      await downloadSiteAssessmentWorkbook({
        assessment: { id: selectedVisit.assessmentId, ...selectedVisit },
        normalizedSurvey: surveyDraft,
        lead: selectedVisit,
        contacts: selectedVisit.contacts || [],
        profile: user || {},
        workflow: selectedVisit,
        proposal: selectedVisit.proposal || null,
      });
      showToast('Survey workbook downloaded', 'success');
    } catch (error) {
      console.error('[myQPMS Survey Workbook] Export failed', error);
      showToast('Unable to generate the survey workbook. Please retry.', 'error');
    } finally {
      setWorkbookExporting(false);
    }
  }

  async function handleSendMom() {
    const targetVisit = momComposerVisit || selectedVisit;
    const nextMom = siteMomDraft || buildSiteVisitMom(targetVisit, surveyDraft || mergeSurvey(targetVisit?.survey));
    if (!targetVisit) return;
    try {
      setPendingAction('sendSiteMom');
      const result = await sendSiteVisitMomEmail(nextMom, targetVisit);
      sendSiteVisitMom(targetVisit.id, nextMom);
      setSiteMomDraft({ ...nextMom, sent: true });
      setMomComposerVisit(null);
      showToast(
        result?.simulated ? 'MOM recorded. Email simulation used because SMTP is unavailable.' : 'Site Visit MOM sent successfully',
        result?.simulated ? 'warning' : 'success',
      );
    } catch (error) {
      showToast(`Email failed: ${error.response?.data?.message || error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleSubmitCommercialReview() {
    if (SURVEY_SECTION_LABELS.includes(activeSection)) {
      const requiredSections = ['Client & Site', 'Facility & Service Requirements', 'Equipment, Manpower & MPD'];
      const sectionErrors = requiredSections.flatMap((section) => validateAssessmentSection(section, surveyDraft, { role: user?.role || '', isSubmission: true }).map((message) => ({ section, message })));
      if (sectionErrors.length) {
        setValidationErrors(sectionErrors.map(({ section, message }) => `${section}: ${message}`));
        setActiveSectionIndex(Math.max(0, roleVisibleSections.findIndex((section) => section === sectionErrors[0].section)));
        showToast('Complete the required survey fields before submitting.', 'error');
        return;
      }
    } else if (!validateSection('Final Remarks & Sign-Off')) {
      setActiveSectionIndex(roleVisibleSections.findIndex((section) => section === 'Final Remarks & Sign-Off'));
      showToast('Complete required final step fields before submitting.', 'error');
      return;
    }
    setPendingAction('submitReview');
    setAutoSaveLabel('Saving...');
    showToast('Saving...', 'info');
    try {
      await Promise.resolve(saveSiteSurvey(selectedVisit.id, surveySavePayload(), 'Submitted', user));
      await Promise.resolve(submitCommercialReview(selectedVisit.id, adminDemoAccess
        ? { adminDemo: true, actorRole: user.role, targetStage: 'HR Validation' }
        : undefined));
      await logAssessmentAuditRemote({
        visit: selectedVisit,
        sectionName: activeSection,
        actionType: 'Submitted for Review Workflow',
        user,
        oldValue: sectionSnapshot(activeSection, selectedVisit.survey),
        newValue: sectionSnapshot(activeSection, surveyDraft),
        remarks: 'Assessment submitted to approval matrix workflow.',
      });
      rememberSectionAudit('Submitted for Review Workflow');
      setEditingSection('');
      setAutoSaveLabel('Submitted for Review');
      showToast(adminDemoAccess ? 'Submitted for Admin Demo Review. Pending HR Review.' : 'Submitted for Review. Approval matrix updated.', 'success');
    } catch (error) {
      setAutoSaveLabel('Failed to save');
      showToast(`Failed to submit: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleGenerateProposal(targetVisit = selectedVisit) {
    if (!targetVisit) return;
    const sourceSurvey = targetVisit.id === selectedVisit?.id ? surveyDraft : mergeSurvey(targetVisit.survey);
    const nextProposal = buildProposalPayload(targetVisit, sourceSurvey, proposalMetadata);
    setPendingAction('generateProposal');
    try {
      if (targetVisit.id === selectedVisit?.id && surveyDraft) {
        await Promise.resolve(saveSiteSurvey(targetVisit.id, surveySavePayload(), 'Proposal Ready', user));
      }
      await Promise.resolve(generateProposal(targetVisit.id, nextProposal, user));
      setProposalDraft(nextProposal);
      setProposalPreviewVisit(targetVisit);
      showToast('Proposal generated for preview', 'success');
    } catch (error) {
      showToast(`Proposal generation failed: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleSendProposal() {
    const targetVisit = proposalPreviewVisit || selectedVisit;
    const nextProposal = proposalDraft || buildProposalPayload(targetVisit, surveyDraft || mergeSurvey(targetVisit?.survey), proposalMetadata);
    if (!targetVisit) return;
    setPendingAction('sendProposal');
    let mailSimulated = false;
    try {
      try {
        const mailResult = await sendProposalEmail(nextProposal, targetVisit);
        mailSimulated = Boolean(mailResult?.simulated);
      } catch (mailError) {
        mailSimulated = true;
        console.warn('[myQPMS Proposal Mail] SMTP/API unavailable; continuing proposal workflow', mailError.message);
      }
      await Promise.resolve(markProposalSent(targetVisit.id, nextProposal));
      setProposalPreviewVisit(null);
      setProposalDraft(null);
      showToast(mailSimulated ? 'Proposal recorded. Mail simulation used because SMTP is unavailable.' : 'Proposal mail sent. Record moved to Existing Business Pipeline.', mailSimulated ? 'warning' : 'success');
    } catch (error) {
      showToast(`Proposal workflow failed: ${error.response?.data?.message || error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  function handleExportProposal(format) {
    const targetVisit = proposalPreviewVisit || selectedVisit;
    const nextProposal = proposalDraft || buildProposalPayload(targetVisit, surveyDraft || mergeSurvey(targetVisit?.survey), proposalMetadata);
    if (!targetVisit || !nextProposal) return;
    try {
      if (format === 'excel') {
        exportProposalToExcel(nextProposal, targetVisit);
        showToast('Proposal Excel export prepared', 'success');
        return;
      }
      exportProposalToPdf(nextProposal, targetVisit);
      showToast('Proposal PDF export opened', 'success');
    } catch (error) {
      showToast(`Proposal export failed: ${error.message}`, 'error');
    }
  }

  function renderProposalPreviewModal() {
    if (!proposalPreviewVisit || !proposalDraft) return null;
    return (
      <div className="fixed inset-0 z-[67] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" onClick={() => setProposalPreviewVisit(null)}>
        <Motion.section initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/70 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <p className="text-xs font-bold uppercase text-qpms-600 dark:text-qpms-300">Proposal Preview</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{proposalDraft.subject}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{proposalPreviewVisit.company}</p>
            </div>
            <button type="button" onClick={() => setProposalPreviewVisit(null)} className="focus-ring rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <SummaryPill label="Proposal No." value={proposalDraft.proposalNumber} />
            <SummaryPill label="Monthly Value" value={currency(proposalDraft.monthlyValue)} />
            <SummaryPill label="Annual Value" value={currency(proposalDraft.proposalValue)} />
            <SummaryPill label="Approval Status" value={proposalDraft.approvalStatus || proposalPreviewVisit.approvalStatus || proposalPreviewVisit.status || 'Approved'} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <SummaryPill label="Client Name" value={proposalDraft.clientName || proposalPreviewVisit.company} />
            <SummaryPill label="Site Details" value={proposalDraft.siteDetails || [proposalPreviewVisit.location, proposalPreviewVisit.city, proposalPreviewVisit.state].filter(Boolean).join(', ')} />
            <SummaryPill label="Scope of Work" value={(proposalDraft.scopeOfWork || []).join(', ') || 'IFM service scope from assessment'} />
            <SummaryPill label="Commercial Notes" value={proposalDraft.commercialNotes || 'Commercial terms prepared from approved site assessment.'} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <SummaryPill label="Costing Summary" value={`Cost ${currency(proposalDraft.monthlyCost || 0)}`} />
            <SummaryPill label="Margin Value" value={currency(proposalDraft.margin || 0)} />
            <SummaryPill label="Margin %" value={`${Number(proposalDraft.marginPercent || 0).toFixed(1)}%`} />
            <SummaryPill label="Manpower Rows" value={proposalDraft.manpowerRequirement?.length || proposalDraft.lineItems?.length || 0} />
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-300">
            <p className="font-bold text-slate-950 dark:text-white">Email Preview</p>
            <p className="mt-3 font-semibold">To: {proposalDraft.to || 'Client email pending'}</p>
            <p className="font-semibold">CC: {proposalDraft.cc || 'Not configured'}</p>
            <p className="mt-3 whitespace-pre-line">{proposalDraft.body}</p>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Designation</th>
                  <th className="px-4 py-3 text-left">Qty</th>
                  <th className="px-4 py-3 text-left">Shift</th>
                  <th className="px-4 py-3 text-left">Rate / Head</th>
                  <th className="px-4 py-3 text-left">Monthly Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {proposalDraft.lineItems.map((row, index) => (
                  <tr key={`${row.designation}-${index}`}>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{row.designation || 'IFM Services'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.quantity}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.shift || 'General'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{currency(row.ratePerHead)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{currency(row.monthlyTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            Attachments prepared from {proposalDraft.templateName}. PDF/Excel export remains linked to the proposal engine template mapping.
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setProposalPreviewVisit(null)} className="focus-ring rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">Cancel</button>
            <button type="button" onClick={() => handleExportProposal('excel')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200">
              <Download className="h-4 w-4" />
              Export Excel
            </button>
            <button type="button" onClick={() => handleExportProposal('pdf')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-qpms-200 bg-qpms-50 px-4 py-2.5 text-sm font-semibold text-qpms-700 shadow-sm hover:bg-qpms-100 dark:border-qpms-500/25 dark:bg-qpms-500/10 dark:text-qpms-200">
              <FileText className="h-4 w-4" />
              Export PDF
            </button>
            <button type="button" onClick={handleSendProposal} disabled={pendingAction === 'sendProposal'} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
              <ButtonContent loading={pendingAction === 'sendProposal'} icon={Send}>Send Proposal Mail</ButtonContent>
            </button>
          </div>
        </Motion.section>
      </div>
    );
  }

  function renderActiveSection() {
    if (!surveyDraft) return null;

    if (SURVEY_SECTION_LABELS.includes(activeSection)) {
      const readOnly = isActiveSectionLocked;
      if (activeSection === 'Client & Site') {
        return <ClientSiteSection survey={surveyDraft} readOnly={readOnly} photoEvidence={photoEvidence} onAddPhotos={addPhotos} onFieldChange={(key, value) => updateV2Field('client_site', key, value)} onContactChange={updateV2Contact} />;
      }
      if (activeSection === 'Facility & Service Requirements') {
        return <FacilityRequirementsSection survey={surveyDraft} readOnly={readOnly} onFieldChange={(key, value) => updateV2Field('facility_requirements', key, value)} />;
      }
      if (activeSection === 'Equipment, Manpower & MPD') {
        return <EquipmentManpowerSection survey={surveyDraft} readOnly={readOnly} onArrayChange={updateV2Array} onAdd={addV2Row} onRemove={removeV2Row} onDuplicate={duplicateV2Row} onCopy={copyV2Rows} />;
      }
      return <CommercialReviewSection survey={surveyDraft} readOnly={readOnly} onFieldChange={(key, value) => updateV2Field('commercial_inputs', key, value)} />;
    }

    switch (activeSection) {
      case 'Basic Site Information':
        return (
          <div className="space-y-5">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <TextField label="Site Address" value={surveyDraft.siteAddress} onChange={(value) => updateSurveyDraft('siteAddress', value)} />
                <TextField label="Site Type" value={surveyDraft.siteType} onChange={(value) => updateSurveyDraft('siteType', value)} />
                <TextField label="Operating Hours" value={surveyDraft.operatingHours} onChange={(value) => updateSurveyDraft('operatingHours', value)} />
                <TextField label="Client Occupancy" value={surveyDraft.clientOccupancy} onChange={(value) => updateSurveyDraft('clientOccupancy', value)} />
                <TextField label="Building Age" value={surveyDraft.buildingAge} onChange={(value) => updateSurveyDraft('buildingAge', value)} />
                <SelectField label="Takeover Complexity" value={surveyDraft.takeoverComplexity} onChange={(value) => updateSurveyDraft('takeoverComplexity', value)} options={['Low', 'Medium', 'High', 'Critical']} />
                <TextField label="Site Survey Date" type="date" value={surveyDraft.siteSurveyDate} onChange={(value) => updateSurveyDraft('siteSurveyDate', value)} />
                <TextField label="Assessed By" value={surveyDraft.assessedBy} onChange={(value) => updateSurveyDraft('assessedBy', value)} />
                <TextField label="Site Contact Person" value={surveyDraft.siteContactPerson} onChange={(value) => updateSurveyDraft('siteContactPerson', value)} />
                <TextField label="Contact Number" value={surveyDraft.contactNumber} onChange={(value) => updateSurveyDraft('contactNumber', value)} />
                <TextField label="Contact Email" type="email" value={surveyDraft.contactEmail} onChange={(value) => updateSurveyDraft('contactEmail', value)} />
                <TextField label="Total Site Area" value={surveyDraft.totalSiteArea} onChange={(value) => updateSurveyDraft('totalSiteArea', value)} />
                <TextField label="Contract Period" value={surveyDraft.contractPeriod} onChange={(value) => updateSurveyDraft('contractPeriod', value)} />
                <TextField label="Margin Agreed" value={surveyDraft.marginAgreed} onChange={(value) => updateSurveyDraft('marginAgreed', value)} />
                <SelectField label="Margin Type" value={surveyDraft.marginType} onChange={(value) => updateSurveyDraft('marginType', value)} options={['Percentage', 'Fixed Value', 'Not Finalized']} />
                <TextField label="Payment Terms" value={surveyDraft.paymentTerms} onChange={(value) => updateSurveyDraft('paymentTerms', value)} />
                <SelectField label="Group / Sister Concern Business" value={surveyDraft.groupOrSisterConcernBusiness} onChange={(value) => updateSurveyDraft('groupOrSisterConcernBusiness', value)} options={['Yes', 'No']} />
                <SelectField label="24 / 7 Operation" value={surveyDraft.is247Operation} onChange={(value) => updateSurveyDraft('is247Operation', value)} options={['Yes', 'No']} />
              </div>
            </section>
            <PhotoEvidenceSection photos={photoEvidence} onAdd={addPhotos} onRemove={removePhoto} onPreview={setPreviewPhoto} />
          </div>
        );
      case 'Scope of IFM Services':
        return (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <ServiceScopeGrid
              items={ifmScopeItems}
              values={surveyDraft.ifmScope}
              onChange={(item, value) => updateNested('ifmScope', { ...surveyDraft.ifmScope, [item]: value })}
            />
          </section>
        );
      case 'Hard Services':
        return (
          <div className="space-y-5">
            {hardServiceGroups.map((group) => (
              <ExpandableServiceGroup key={group.key} group={group} values={surveyDraft.hardServices} onChange={(groupKey, value) => updateNested('hardServices', { ...surveyDraft.hardServices, [groupKey]: value })} />
            ))}
          </div>
        );
      case 'Soft Services':
        return (
          <div className="space-y-5">
            {softServiceGroups.map((group) => (
              <ExpandableServiceGroup key={group.key} group={group} values={surveyDraft.softServices} onChange={(groupKey, value) => updateNested('softServices', { ...surveyDraft.softServices, [groupKey]: value })} />
            ))}
          </div>
        );
      case 'Landscaping & Pest Control':
        return (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <ServiceScopeGrid
              items={landscapeItems}
              values={surveyDraft.landscaping}
              onChange={(item, value) => updateNested('landscaping', { ...surveyDraft.landscaping, [item]: value })}
            />
          </section>
        );
      case 'HSE Compliance':
        return <AuditTable rows={surveyDraft.hseCompliance} onChange={(index, patch) => updateArray('hseCompliance', index, patch)} />;
      case 'Manpower Requirement':
        return (
          <div className="space-y-5">
            <EditableTable
              columns={[
                { key: 'department', label: 'Department', type: 'select', options: manpowerDepartments },
                { key: 'designation', label: 'Designation' },
                { key: 'shiftType', label: 'Shift Type', type: 'select', options: ['General', 'Day', 'Night', 'A-Shift', 'B-Shift', 'C-Shift', 'Rotational'] },
                { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Any'] },
                { key: 'count', label: 'Count', type: 'number' },
                { key: 'relieverRequired', label: 'Reliever?', type: 'select', options: ['Yes', 'No'] },
                { key: 'otRequired', label: 'OT?', type: 'select', options: ['Yes', 'No'] },
                { key: 'wageCategory', label: 'Wage Category', type: 'select', options: ['Unskilled', 'Semi-skilled', 'Skilled', 'Highly Skilled'] },
                { key: 'remarks', label: 'Remarks' },
              ]}
              rows={surveyDraft.manpowerPlan}
              onChange={(index, patch) => updateArray('manpowerPlan', index, patch)}
              onAdd={() => addRow('manpowerPlan', defaultSurvey.manpowerPlan[0])}
              onDuplicate={(index) => duplicateRow('manpowerPlan', index)}
              onRemove={(index) => removeRow('manpowerPlan', index)}
              addLabel="Add manpower row"
            />
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Allowances / Client Support</h3>
              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <SelectField label="Transport Allowance Applicable?" value={surveyDraft.allowances.transport.applicable} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, transport: { ...surveyDraft.allowances.transport, applicable: value } })} options={['No', 'Yes']} />
                  {surveyDraft.allowances.transport.applicable === 'Yes' ? (
                    <div className="mt-4 grid gap-3">
                      <SelectField label="Provided By" value={surveyDraft.allowances.transport.providedBy} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, transport: { ...surveyDraft.allowances.transport, providedBy: value } })} options={['Client', 'Contract', 'Own']} />
                      <TextField label="Per Month Cost" type="number" value={surveyDraft.allowances.transport.monthlyCost} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, transport: { ...surveyDraft.allowances.transport, monthlyCost: value } })} />
                      <TextField label="Vehicle Type" value={surveyDraft.allowances.transport.vehicleType} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, transport: { ...surveyDraft.allowances.transport, vehicleType: value } })} />
                      <TextField label="Remarks" value={surveyDraft.allowances.transport.remarks} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, transport: { ...surveyDraft.allowances.transport, remarks: value } })} />
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <SelectField label="Food Allowance Applicable?" value={surveyDraft.allowances.food.applicable} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, food: { ...surveyDraft.allowances.food, applicable: value } })} options={['No', 'Yes']} />
                  {surveyDraft.allowances.food.applicable === 'Yes' ? (
                    <div className="mt-4 grid gap-3">
                      <TextField label="Per Day Cost" type="number" value={surveyDraft.allowances.food.perDayCost} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, food: { ...surveyDraft.allowances.food, perDayCost: value } })} />
                      <SelectField label="Provided By" value={surveyDraft.allowances.food.providedBy} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, food: { ...surveyDraft.allowances.food, providedBy: value } })} options={['Client', 'Contract', 'Own']} />
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <SelectField label="Accommodation Applicable?" value={surveyDraft.allowances.accommodation.applicable} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, accommodation: { ...surveyDraft.allowances.accommodation, applicable: value } })} options={['No', 'Yes']} />
                  {surveyDraft.allowances.accommodation.applicable === 'Yes' ? (
                    <div className="mt-4 grid gap-3">
                      <TextField label="Per Month Cost" type="number" value={surveyDraft.allowances.accommodation.monthlyCost} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, accommodation: { ...surveyDraft.allowances.accommodation, monthlyCost: value } })} />
                      <SelectField label="Provided By" value={surveyDraft.allowances.accommodation.providedBy} onChange={(value) => updateNested('allowances', { ...surveyDraft.allowances, accommodation: { ...surveyDraft.allowances.accommodation, providedBy: value } })} options={['Client', 'Contract', 'Own']} />
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {['minimumWagesType', 'applicableZone', 'wageComputationNotes', 'relieverCostRequired', 'budgetedTakeHomeFeasibility', 'localWorkforceAvailability', 'transportationImpact', 'bonusPaymentType', 'leaveWithWagesDays', 'nfhApplicable', 'travelAccommodationProvided'].map((key) => (
                  <TextField key={key} label={fieldLabel(key)} value={surveyDraft[key]} onChange={(value) => updateSurveyDraft(key, value)} multiline={key.includes('Notes')} />
                ))}
              </div>
            </section>
          </div>
        );
      case 'Tools / Equipment / Consumables':
        return (
          <div className="space-y-5">
            <EditableTable
              columns={[
                { key: 'name', label: 'Equipment Name' },
                { key: 'scopeResponsibility', label: 'Scope Responsibility', type: 'select', options: ['Client Scope', 'QPMS Scope', 'Shared Scope'] },
                { key: 'brand', label: 'Brand' },
                { key: 'capacity', label: 'Capacity' },
                { key: 'quantity', label: 'Quantity', type: 'number' },
                { key: 'unitCost', label: 'Unit Cost', type: 'number' },
                { key: 'monthlyCost', label: 'Monthly Cost', type: 'number' },
                { key: 'vendor', label: 'Vendor / Source' },
                { key: 'clientResponsibility', label: 'Client Responsibility' },
                { key: 'qpmsResponsibility', label: 'QPMS Responsibility' },
                { key: 'remarks', label: 'Remarks' },
              ]}
              rows={surveyDraft.equipment}
              onChange={(index, patch) => updateArray('equipment', index, patch)}
              onAdd={() => addRow('equipment', defaultSurvey.equipment[0])}
              onDuplicate={(index) => duplicateRow('equipment', index)}
              onRemove={(index) => removeRow('equipment', index)}
              addLabel="Add equipment item"
            />
            <EditableTable
              columns={[
                { key: 'name', label: 'Consumable Name' },
                { key: 'scopeResponsibility', label: 'Scope Responsibility', type: 'select', options: ['Client Scope', 'QPMS Scope', 'Shared Scope'] },
                { key: 'quantity', label: 'Quantity', type: 'number' },
                { key: 'unitCost', label: 'Unit Cost', type: 'number' },
                { key: 'monthlyCost', label: 'Monthly Cost', type: 'number' },
                { key: 'vendor', label: 'Vendor / Source' },
                { key: 'clientResponsibility', label: 'Client Responsibility' },
                { key: 'qpmsResponsibility', label: 'QPMS Responsibility' },
                { key: 'monthlyConsumption', label: 'Monthly Consumption' },
              ]}
              rows={surveyDraft.chemicals}
              onChange={(index, patch) => updateArray('chemicals', index, patch)}
              onAdd={() => addRow('chemicals', defaultSurvey.chemicals[0])}
              onDuplicate={(index) => duplicateRow('chemicals', index)}
              onRemove={(index) => removeRow('chemicals', index)}
              addLabel="Add consumable"
            />
            <EditableTable
              columns={[
                { key: 'name', label: 'Tool Name' },
                { key: 'scopeResponsibility', label: 'Scope Responsibility', type: 'select', options: ['Client Scope', 'QPMS Scope', 'Shared Scope'] },
                { key: 'quantity', label: 'Quantity', type: 'number' },
                { key: 'unitCost', label: 'Unit Cost', type: 'number' },
                { key: 'monthlyCost', label: 'Monthly Cost', type: 'number' },
                { key: 'vendor', label: 'Vendor / Source' },
                { key: 'department', label: 'Department', type: 'select', options: manpowerDepartments },
                { key: 'clientResponsibility', label: 'Client Responsibility' },
                { key: 'qpmsResponsibility', label: 'QPMS Responsibility' },
                { key: 'remarks', label: 'Remarks' },
              ]}
              rows={surveyDraft.tools}
              onChange={(index, patch) => updateArray('tools', index, patch)}
              onAdd={() => addRow('tools', defaultSurvey.tools[0])}
              onDuplicate={(index) => duplicateRow('tools', index)}
              onRemove={(index) => removeRow('tools', index)}
              addLabel="Add tool"
            />
            <EditableTable
              columns={[
                { key: 'name', label: 'PPE / Uniform Item' },
                { key: 'scopeResponsibility', label: 'Scope Responsibility', type: 'select', options: ['Client Scope', 'QPMS Scope', 'Shared Scope'] },
                { key: 'quantity', label: 'Quantity', type: 'number' },
                { key: 'unitCost', label: 'Unit Cost', type: 'number' },
                { key: 'monthlyCost', label: 'Monthly Cost', type: 'number' },
                { key: 'vendor', label: 'Vendor / Source' },
                { key: 'remarks', label: 'Remarks' },
              ]}
              rows={surveyDraft.ppeUniforms}
              onChange={(index, patch) => updateArray('ppeUniforms', index, patch)}
              onAdd={() => addRow('ppeUniforms', defaultSurvey.ppeUniforms[0])}
              onDuplicate={(index) => duplicateRow('ppeUniforms', index)}
              onRemove={(index) => removeRow('ppeUniforms', index)}
              addLabel="Add PPE / uniform"
            />
            <EditableTable
              columns={[
                { key: 'name', label: 'Machinery Item' },
                { key: 'scopeResponsibility', label: 'Scope Responsibility', type: 'select', options: ['Client Scope', 'QPMS Scope', 'Shared Scope'] },
                { key: 'quantity', label: 'Quantity', type: 'number' },
                { key: 'unitCost', label: 'Unit Cost', type: 'number' },
                { key: 'monthlyCost', label: 'Monthly Cost', type: 'number' },
                { key: 'vendor', label: 'Vendor / Source' },
                { key: 'remarks', label: 'Remarks' },
              ]}
              rows={surveyDraft.machinery}
              onChange={(index, patch) => updateArray('machinery', index, patch)}
              onAdd={() => addRow('machinery', defaultSurvey.machinery[0])}
              onDuplicate={(index) => duplicateRow('machinery', index)}
              onRemove={(index) => removeRow('machinery', index)}
              addLabel="Add machinery"
            />
          </div>
        );
      case 'Client KYC':
        return (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <div className="grid gap-4 md:grid-cols-2">
              {Object.entries(surveyDraft.clientKyc).map(([key, value]) => (
                <TextField key={key} label={fieldLabel(key)} value={value} onChange={(nextValue) => updateNested('clientKyc', { ...surveyDraft.clientKyc, [key]: nextValue })} multiline={key === 'billingAddress' || key === 'complianceDocs'} />
              ))}
            </div>
          </section>
        );
      case 'Risk Assessment':
        return (
          <div className="space-y-5">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {['clientCreditRating', 'marketAssessment', 'goodPaymaster', 'existingVendorChangeReason', 'mitigationPlan', 'riskRemarks'].map((key) => (
                  <TextField key={key} label={fieldLabel(key)} value={surveyDraft[key]} onChange={(value) => updateSurveyDraft(key, value)} multiline={key.includes('Reason') || key.includes('Plan') || key.includes('Remarks')} />
                ))}
              </div>
            </section>
            <RiskCards risks={surveyDraft.risks} onChange={(index, patch) => updateArray('risks', index, patch)} />
          </div>
        );
      case 'Penalty Clauses':
        return (
          <div className="space-y-4">
            {surveyDraft.penaltyClauses.map((clause, index) => (
              <section key={clause.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Penalty Clause {index + 1}</h3>
                  <button type="button" onClick={() => removeRow('penaltyClauses', index)} className="rounded-xl border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <SelectField label="Penalty Clause Available" value={clause.penaltyClauseAvailable} onChange={(value) => updateArray('penaltyClauses', index, { penaltyClauseAvailable: value })} options={['Yes', 'No']} />
                  <SelectField label="Risk Impact" value={clause.riskImpact} onChange={(value) => updateArray('penaltyClauses', index, { riskImpact: value })} options={['Low', 'Medium', 'High', 'Critical']} />
                  {clause.penaltyClauseAvailable === 'Yes' ? (
                    <>
                      <TextField label="Penalty Details" value={clause.penaltyDetails} onChange={(value) => updateArray('penaltyClauses', index, { penaltyDetails: value })} multiline />
                      <TextField label="Remarks" value={clause.remarks} onChange={(value) => updateArray('penaltyClauses', index, { remarks: value })} multiline />
                    </>
                  ) : null}
                </div>
              </section>
            ))}
            <button type="button" onClick={() => addRow('penaltyClauses', defaultSurvey.penaltyClauses[0])} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <Plus className="h-4 w-4" /> Add Penalty Clause
            </button>
          </div>
        );
      case 'Commercial Statement': {
        const totals = getCommercialTotals(surveyDraft);
        const proposalRows = buildProposalRows({ survey: surveyDraft });
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <SummaryPill label="Estimated Revenue" value={currency(totals.revenue)} />
              <SummaryPill label="Monthly Operational Cost" value={currency(totals.monthlyCost)} />
              <SummaryPill label="Expected Margin %" value={`${totals.marginPercent.toFixed(1)}%`} />
            </div>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Costing Engine Preview</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <SummaryPill label="Proposal Rows" value={proposalRows.length} />
                <SummaryPill label="Template" value={proposalMetadata.supportedExports.join(' / ')} />
                <SummaryPill label="Source Workbook" value="New Business Proposal Format.xlsx" />
              </div>
            </section>
            <EditableTable
              columns={[
                { key: 'name', label: 'Billing Component' },
                { key: 'amount', label: 'Amount', type: 'number' },
              ]}
              rows={surveyDraft.commercial.billingComponents}
              onChange={(index, patch) => updateNested('commercial', { ...surveyDraft.commercial, billingComponents: surveyDraft.commercial.billingComponents.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) })}
              onAdd={() => updateNested('commercial', { ...surveyDraft.commercial, billingComponents: [...surveyDraft.commercial.billingComponents, { id: `bill-${Date.now()}`, name: '', amount: 0 }] })}
              onRemove={(index) => updateNested('commercial', { ...surveyDraft.commercial, billingComponents: surveyDraft.commercial.billingComponents.filter((_, itemIndex) => itemIndex !== index) })}
              addLabel="Add billing component"
            />
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400">Manpower Costing Summary</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(surveyDraft.manpowerPlan || []).slice(0, 4).map((row) => {
                  const costing = calculateManpowerCost(row, surveyDraft);
                  return <SummaryPill key={row.id} label={row.designation || row.department} value={currency(costing.finalBillableValue)} />;
                })}
              </div>
            </section>
            <EditableTable
              columns={[
                { key: 'name', label: 'Expense Component' },
                { key: 'amount', label: 'Amount', type: 'number' },
              ]}
              rows={surveyDraft.commercial.expenseComponents}
              onChange={(index, patch) => updateNested('commercial', { ...surveyDraft.commercial, expenseComponents: surveyDraft.commercial.expenseComponents.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) })}
              onAdd={() => updateNested('commercial', { ...surveyDraft.commercial, expenseComponents: [...surveyDraft.commercial.expenseComponents, { id: `expense-${Date.now()}`, name: '', amount: 0 }] })}
              onRemove={(index) => updateNested('commercial', { ...surveyDraft.commercial, expenseComponents: surveyDraft.commercial.expenseComponents.filter((_, itemIndex) => itemIndex !== index) })}
              addLabel="Add expense component"
            />
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField label="Applicable Zone" value={surveyDraft.commercial.applicableZone} onChange={(value) => updateNested('commercial', { ...surveyDraft.commercial, applicableZone: value })} options={['Z1', 'Z2', 'Z3']} />
                <TextField label="Non-Billable Cost" type="number" value={surveyDraft.commercial.nonBillableCost} onChange={(value) => updateNested('commercial', { ...surveyDraft.commercial, nonBillableCost: value })} />
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <SummaryPill label="Expense Components" value={currency(totals.expenses)} />
                <SummaryPill label="Non-Billable Cost" value={currency(totals.nonBillable)} />
                <SummaryPill label="Margin Summary" value={currency(totals.margin)} />
              </div>
            </section>
          </div>
        );
      }
      case 'Approval Mechanism':
        return (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {['operationsTeamApproval', 'hrWageVetting', 'procurementEquipmentTccCosting', 'commercialVetting', 'financeViabilityReview', 'commercialGreenSignal'].map((key) => (
                <SelectField key={key} label={fieldLabel(key)} value={surveyDraft[key]} onChange={(value) => updateSurveyDraft(key, value)} options={['Pending', 'Approved', 'Rejected', 'Not Required']} />
              ))}
              <TextField label="Approval Workflow Notes" value={surveyDraft.approvalWorkflow} onChange={(value) => updateSurveyDraft('approvalWorkflow', value)} multiline />
            </div>
          </section>
        );
      case 'Final Remarks & Sign-Off':
        return (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Final Remarks" value={surveyDraft.finalRemarks} onChange={(value) => updateSurveyDraft('finalRemarks', value)} multiline />
              <TextField label="Assessor / Sign-Off Name" value={surveyDraft.signOffName} onChange={(value) => updateSurveyDraft('signOffName', value)} />
            </div>
          </section>
        );
      default:
        return null;
    }
  }

  if (routeVisitId && selectedVisit && draftVisitId !== selectedVisit.id) {
    setDraftVisitId(selectedVisit.id);
    setSurveyDraft(createV2Survey({ existing: selectedVisit.survey, visit: selectedVisit, user }));
    setPhotoEvidence({});
    setSiteMomDraft(selectedVisit.siteMom || null);
    setActiveSectionIndex(0);
    setAutoSaveLabel('Draft saved');
    setSectionAudit(selectedVisit.assessmentId || selectedVisit.assessmentStatus === 'Draft'
      ? Object.fromEntries(SURVEY_SECTION_LABELS.map((section) => [section, {
          actionType: 'Section Saved',
          savedAt: selectedVisit.lastApprovalAt || new Date().toISOString(),
          savedBy: selectedVisit.created_by_name || selectedVisit.assigned_bd_executive || 'myQPMS user',
          savedByRole: 'BD Executive',
        }]))
      : {});
    setEditingSection('');
    setPendingEditSection('');
    setShowWorkflowTimeline(false);
    setSectionsCollapsed(false);
    setProposalPreviewVisit(null);
    setProposalDraft(null);
  }

  if (routeVisitId) {
    if (!selectedVisit || !surveyDraft) {
      return (
        <div className="space-y-7">
          <PageHeader title="Site Visit Assessment" />
          <section className="enterprise-card p-8 text-center">
            <ClipboardCheck className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Assessment is not available</p>
            <button type="button" onClick={() => navigate('/sites')} className="focus-ring mt-5 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
              Back to Site Visits
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Toast message={toast?.message} type={toast?.type} />

        <section className="sticky top-20 z-30 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/70 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 dark:ring-white/5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <button type="button" onClick={handleBackToQueue} className="focus-ring mb-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Queue
              </button>
              <h2 className="truncate text-xl font-semibold text-slate-950 dark:text-white">{selectedVisit.company}</h2>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Step {activeSectionIndex + 1} of {roleVisibleSections.length}</p>
            </div>
            <div className="min-w-0 lg:w-96">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                <span>{activeSection}</span>
                <span>{autoSaveLabel}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-qpms-600 transition-all" style={{ width: `${((activeSectionIndex + 1) / roleVisibleSections.length) * 100}%` }} />
              </div>
            </div>
          </div>
        </section>

        <main className="mx-auto max-w-6xl space-y-4">
          <section className="enterprise-card-compact p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-qpms-600" />
                <h3 className="text-xl font-semibold leading-7 text-slate-950 dark:text-white">{activeSection}</h3>
              </div>
              <span className="rounded-full bg-qpms-50 px-3 py-1.5 text-xs font-bold text-qpms-700 ring-1 ring-qpms-200 dark:bg-qpms-500/15 dark:text-qpms-300 dark:ring-qpms-500/25">
                Step {activeSectionIndex + 1} / {roleVisibleSections.length}
              </span>
            </div>
          </section>

          {validationErrors.length ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
              <p>Missing required fields:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {validationErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </section>
          ) : null}

          <fieldset disabled={isActiveSectionLocked} className={isActiveSectionLocked ? 'opacity-80' : ''}>
            {renderActiveSection()}
          </fieldset>
        </main>

        <div className="sticky bottom-0 z-20 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_-14px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={handlePreviousStep} disabled={isFirstStep} className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              Previous
            </button>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={handleSaveDraft} disabled={pendingAction === 'saveSiteDraft'} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <ButtonContent loading={pendingAction === 'saveSiteDraft'} icon={Save}>Save Draft</ButtonContent>
              </button>
              <button type="button" onClick={handleExportSurveyWorkbook} disabled={workbookExporting} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-slate-950 dark:text-emerald-300">
                <ButtonContent loading={workbookExporting} icon={Download}>Export Survey Workbook</ButtonContent>
              </button>
              {isFinalStep ? (
                <button type="button" onClick={handleSubmitCommercialReview} disabled={pendingAction === 'submitReview'} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 hover:bg-slate-800 dark:bg-white dark:text-slate-950">
                  <ButtonContent loading={pendingAction === 'submitReview'}>Submit for Reviews</ButtonContent>
                </button>
              ) : (
                <button type="button" onClick={handleNextStep} className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-qpms-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
                  Next
                </button>
              )}
            </div>
          </div>
        </div>

        {momComposerVisit && siteMomDraft ? (
          <div className="fixed inset-0 z-[66] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" onClick={() => setMomComposerVisit(null)}>
            <Motion.section initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/70 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div>
                  <p className="text-xs font-bold uppercase text-qpms-600 dark:text-qpms-300">Enterprise Email Composer</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">Site Visit Minutes of Meeting</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{momComposerVisit.company}</p>
                </div>
                <button type="button" onClick={() => setMomComposerVisit(null)} className="focus-ring rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <TextField label="To" value={siteMomDraft.to} onChange={(value) => updateMomDraft('to', value)} />
                <TextField label="CC" value={siteMomDraft.cc} onChange={(value) => updateMomDraft('cc', value)} />
                <div className="md:col-span-2">
                  <TextField label="Subject" value={siteMomDraft.subject} onChange={(value) => updateMomDraft('subject', value)} />
                </div>
                <TextField label="Summary" value={siteMomDraft.summary} onChange={(value) => updateMomDraft('summary', value)} multiline />
                <TextField label="Scope" value={siteMomDraft.scope} onChange={(value) => updateMomDraft('scope', value)} multiline />
                <TextField label="Requirements" value={siteMomDraft.requirements} onChange={(value) => updateMomDraft('requirements', value)} multiline />
                <TextField label="Commercial Notes" value={siteMomDraft.commercialNotes} onChange={(value) => updateMomDraft('commercialNotes', value)} multiline />
              </div>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-300">
                <p className="font-bold text-slate-950 dark:text-white">MOM Preview</p>
                <p className="mt-3 font-semibold">{siteMomDraft.subject}</p>
                <p className="mt-3 whitespace-pre-line">{siteMomDraft.summary}</p>
                <p className="mt-3 whitespace-pre-line">{siteMomDraft.scope}</p>
                <p className="mt-3 whitespace-pre-line">{siteMomDraft.requirements}</p>
                <p className="mt-3 whitespace-pre-line">{siteMomDraft.commercialNotes}</p>
              </div>
              <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                Attachments: site visit MOM email only. Add files in backend mail workflow when required.
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button type="button" onClick={() => setMomComposerVisit(null)} className="focus-ring rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">Cancel</button>
                <button type="button" onClick={handleSendMom} disabled={pendingAction === 'sendSiteMom'} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
                  <ButtonContent loading={pendingAction === 'sendSiteMom'} icon={Send}>Send MOM</ButtonContent>
                </button>
              </div>
            </Motion.section>
          </div>
        ) : null}

        {renderProposalPreviewModal()}

        {pendingEditSection ? (
          <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">Edit Saved Section?</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">This section is already saved. Any changes will be tracked in the audit log.</p>
              <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setPendingEditSection('')} className="focus-ring rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  Cancel
                </button>
                <button type="button" onClick={confirmEditSection} className="focus-ring rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
                  Continue Editing
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {previewPhoto ? (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/75 p-5" onClick={() => setPreviewPhoto(null)}>
            <div className="max-h-[88vh] max-w-5xl overflow-hidden rounded-3xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-4 px-2">
                <p className="text-sm font-bold text-slate-900">{previewPhoto.name}</p>
                <button type="button" onClick={() => setPreviewPhoto(null)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <img src={previewPhoto.url} alt={previewPhoto.name} className="max-h-[78vh] w-full rounded-2xl object-contain" />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader
        title="Site Visit & Estimation"
      />

        <Toast message={toast?.message} type={toast?.type} />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {queueKpis.map((item) => (
          <div key={item.label} className={`rounded-2xl border p-4 shadow-sm ${item.tone}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide">{item.label}</p>
            <p className="mt-2 text-3xl font-bold leading-none text-slate-950 dark:text-white">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6">
        <div className="enterprise-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="section-kicker text-qpms-600 dark:text-qpms-300">Assessment Queue</p>
              <h2 className="mt-1 text-xl font-semibold leading-7 text-slate-950 dark:text-white">Scheduled Visits / Assessment List</h2>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search assessments..."
                className="focus-ring h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              />
            </div>
          </div>

          <div className="mt-5">
            {!visibleSiteVisits.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-950/55">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-qpms-50 text-qpms-600 dark:bg-qpms-500/10 dark:text-qpms-200">
                  <ClipboardCheck className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">No Site Visit Assessments Yet</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                  Leads with scheduled site visits will appear here after Lead MOM submission.
                </p>
                <button type="button" onClick={() => navigate('/crm')} className="focus-ring mt-6 rounded-xl bg-gradient-to-r from-qpms-700 to-qpms-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-qpms-600/20 hover:from-qpms-800 hover:to-qpms-600">
                  Go to Lead Management
                </button>
              </div>
            ) : filteredVisits.length ? (
              <div className="grid gap-4">
                <AnimatePresence initial={false}>
                  {filteredVisits.map((visit) => (
                    <AssessmentQueueCard
                      key={visit.id}
                      visit={visit}
                      onOpenAssessment={() => openVisitPage(visit)}
                      onOpenMom={() => openQueueMomWorkspace(visit)}
                      onGenerateProposal={() => handleGenerateProposal(visit)}
                      proposalLoading={pendingAction === 'generateProposal'}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-950/55">
                <Search className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">No matching assessments found</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Clear the search or try another client, city, status, or executive.</p>
              </div>
            )}
          </div>
        </div>

      </section>

      {momComposerVisit && siteMomDraft ? (
        <div className="fixed inset-0 z-[66] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" onClick={() => setMomComposerVisit(null)}>
          <Motion.section initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/70 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <p className="text-xs font-bold uppercase text-qpms-600 dark:text-qpms-300">Enterprise Email Composer</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">Site Visit Minutes of Meeting</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{momComposerVisit.company}</p>
              </div>
              <button type="button" onClick={() => setMomComposerVisit(null)} className="focus-ring rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextField label="To" value={siteMomDraft.to} onChange={(value) => updateMomDraft('to', value)} />
              <TextField label="CC" value={siteMomDraft.cc} onChange={(value) => updateMomDraft('cc', value)} />
              <div className="md:col-span-2">
                <TextField label="Subject" value={siteMomDraft.subject} onChange={(value) => updateMomDraft('subject', value)} />
              </div>
              <TextField label="Summary" value={siteMomDraft.summary} onChange={(value) => updateMomDraft('summary', value)} multiline />
              <TextField label="Scope" value={siteMomDraft.scope} onChange={(value) => updateMomDraft('scope', value)} multiline />
              <TextField label="Requirements" value={siteMomDraft.requirements} onChange={(value) => updateMomDraft('requirements', value)} multiline />
              <TextField label="Commercial Notes" value={siteMomDraft.commercialNotes} onChange={(value) => updateMomDraft('commercialNotes', value)} multiline />
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-300">
              <p className="font-bold text-slate-950 dark:text-white">MOM Preview</p>
              <p className="mt-3 font-semibold">{siteMomDraft.subject}</p>
              <p className="mt-3 whitespace-pre-line">{siteMomDraft.summary}</p>
              <p className="mt-3 whitespace-pre-line">{siteMomDraft.scope}</p>
              <p className="mt-3 whitespace-pre-line">{siteMomDraft.requirements}</p>
              <p className="mt-3 whitespace-pre-line">{siteMomDraft.commercialNotes}</p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setMomComposerVisit(null)} className="focus-ring rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">Cancel</button>
              <button type="button" onClick={handleSendMom} disabled={pendingAction === 'sendSiteMom'} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700">
                <ButtonContent loading={pendingAction === 'sendSiteMom'} icon={Send}>Send MOM</ButtonContent>
              </button>
            </div>
          </Motion.section>
        </div>
      ) : null}

      {renderProposalPreviewModal()}

      {previewPhoto ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/75 p-5" onClick={() => setPreviewPhoto(null)}>
          <div className="max-h-[88vh] max-w-5xl overflow-hidden rounded-3xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4 px-2">
              <p className="text-sm font-bold text-slate-900">{previewPhoto.name}</p>
              <button type="button" onClick={() => setPreviewPhoto(null)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <img src={previewPhoto.url} alt={previewPhoto.name} className="max-h-[78vh] w-full rounded-2xl object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
