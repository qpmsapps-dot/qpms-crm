import { Clipboard, Download, QrCode, RefreshCw, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { generateHospitalFeedbackQr, getHospitalFeedbackQrLocations } from '../services/api.js';
import { usePageTitle } from '../hooks/usePageTitle.js';

function uniqueOptions(rows, key, labelKey) {
  const seen = new Map();
  rows.forEach((row) => {
    const value = row[key] || '';
    const label = row[labelKey] || '';
    if (value && label && !seen.has(value)) seen.set(value, label);
  });
  return Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 disabled:bg-slate-100 disabled:text-slate-400"
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function HospitalFeedbackQrGenerator() {
  usePageTitle('Hospital Feedback QR Generator');
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState('');
  const [selection, setSelection] = useState({ hospitalId: '', blockId: '', floorId: '', locationId: '' });
  const [generating, setGenerating] = useState(false);
  const [qr, setQr] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    getHospitalFeedbackQrLocations()
      .then((rows) => {
        if (!active) return;
        setLocations(rows);
        setLoadingError('');
      })
      .catch((loadError) => {
        if (!active) return;
        setLoadingError(loadError.message || 'Unable to load hospital locations.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const hospitals = useMemo(() => uniqueOptions(locations, 'hospitalId', 'hospitalName'), [locations]);
  const hospitalLocations = useMemo(
    () => locations.filter((row) => !selection.hospitalId || row.hospitalId === selection.hospitalId),
    [locations, selection.hospitalId],
  );
  const blocks = useMemo(() => uniqueOptions(hospitalLocations, 'blockId', 'blockName'), [hospitalLocations]);
  const blockLocations = useMemo(
    () => hospitalLocations.filter((row) => !selection.blockId || row.blockId === selection.blockId),
    [hospitalLocations, selection.blockId],
  );
  const floors = useMemo(() => uniqueOptions(blockLocations, 'floorId', 'floorName'), [blockLocations]);
  const floorLocations = useMemo(
    () => blockLocations.filter((row) => !selection.floorId || row.floorId === selection.floorId),
    [blockLocations, selection.floorId],
  );
  const locationOptions = useMemo(
    () => floorLocations
      .map((row) => ({ value: row.id, label: [row.locationName, row.locationType].filter(Boolean).join(' - ') }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [floorLocations],
  );
  const selectedLocation = locations.find((row) => row.id === selection.locationId);

  function updateSelection(key, value) {
    setQr(null);
    setMessage('');
    setError('');
    setSelection((current) => {
      const next = { ...current, [key]: value };
      if (key === 'hospitalId') {
        next.blockId = '';
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'blockId') {
        next.floorId = '';
        next.locationId = '';
      }
      if (key === 'floorId') next.locationId = '';
      return next;
    });
  }

  async function onGenerate() {
    if (!selection.locationId) return;
    setGenerating(true);
    setError('');
    setMessage('');
    setCopied(false);
    try {
      const result = await generateHospitalFeedbackQr(selection.locationId);
      setQr(result);
      setMessage(result.message || 'QR is ready.');
    } catch (generateError) {
      setError(generateError.message || 'Unable to generate QR.');
    } finally {
      setGenerating(false);
    }
  }

  async function onCopy() {
    if (!qr?.public_url || !navigator.clipboard) return;
    await navigator.clipboard.writeText(qr.public_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function onDownload() {
    if (!qr?.qr_png_data_url) return;
    const link = document.createElement('a');
    link.href = qr.qr_png_data_url;
    link.download = `hospital-feedback-qr-${selection.locationId}.png`;
    link.click();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Hospital Feedback QR Generator" />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="enterprise-card-compact overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
            <h2 className="text-base font-bold text-slate-950">Select feedback location</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Generate the secure public QR for one active hospital location.</p>
          </div>
          <div className="space-y-5 p-5">
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500">
                <span className="button-spinner" />
                Loading hospital locations...
              </div>
            ) : loadingError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {loadingError}
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField label="Hospital" value={selection.hospitalId} onChange={(value) => updateSelection('hospitalId', value)} options={hospitals} />
                  <SelectField label="Block" value={selection.blockId} onChange={(value) => updateSelection('blockId', value)} options={blocks} disabled={!selection.hospitalId} />
                  <SelectField label="Floor" value={selection.floorId} onChange={(value) => updateSelection('floorId', value)} options={floors} disabled={!selection.blockId} />
                  <SelectField label="Location" value={selection.locationId} onChange={(value) => updateSelection('locationId', value)} options={locationOptions} disabled={!selection.blockId} />
                </div>

                {selectedLocation ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                      <div className="min-w-0">
                        <div className="font-bold text-slate-950">{selectedLocation.hospitalName}</div>
                        <div className="mt-1 leading-6">{[selectedLocation.blockName, selectedLocation.floorName, selectedLocation.departmentName, selectedLocation.locationName].filter(Boolean).join(' / ')}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={!selection.locationId || generating}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-qpms-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-qpms-800 disabled:bg-slate-400 md:w-auto"
                >
                  {generating ? <span className="button-spinner" /> : <QrCode className="h-4 w-4" />}
                  Generate QR
                </button>
              </>
            )}

            {message ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="enterprise-card-compact overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-slate-950">QR Preview</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">Preview and PNG download use the same image.</p>
            </div>
            {qr?.active ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">Active</span> : null}
          </div>

          <div className="p-5">
            <div className="grid aspect-square place-items-center rounded-2xl border border-slate-200 bg-white p-4 shadow-inner">
              {qr?.qr_png_data_url ? (
                <img src={qr.qr_png_data_url} alt="Hospital Feedback QR" className="h-full w-full object-contain" />
              ) : (
                <div className="grid justify-items-center text-center text-sm font-semibold text-slate-400">
                  <QrCode className="mb-3 h-12 w-12 text-slate-300" />
                  Select a location and generate a QR.
                </div>
              )}
            </div>

            {qr?.public_url ? (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Public URL</span>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <LinkIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      readOnly
                      value={qr.public_url}
                      className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                    />
                  </div>
                </label>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button type="button" onClick={onCopy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                    <Clipboard className="h-4 w-4" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button type="button" onClick={onDownload} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">
                    <Download className="h-4 w-4" />
                    Download PNG
                  </button>
                  <button type="button" onClick={onGenerate} disabled={generating} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:text-slate-400">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </div>
  );
}
