import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { resolvePublicHospitalFeedbackQr } from '../services/api.js';

function useNoIndex() {
  useEffect(() => {
    document.title = 'Hospital Feedback';
    let meta = document.querySelector('meta[name="robots"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', 'noindex, nofollow');
    return () => {
      if (created) meta.remove();
      else meta.setAttribute('content', previous || '');
    };
  }, []);
}

function PublicShell({ children }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col justify-center">
        {children}
      </div>
    </main>
  );
}

export function PublicFeedbackScanInstruction() {
  useNoIndex();
  return (
    <PublicShell>
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-qpms-50 text-qpms-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-xl font-bold">Please scan the QR code displayed at the hospital location.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This page opens only with a valid secure QR token.
        </p>
      </section>
    </PublicShell>
  );
}

export default function PublicFeedbackQrPage() {
  useNoIndex();
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });
  const [phaseTwoMessage, setPhaseTwoMessage] = useState('');

  const loadQr = useCallback(async () => {
    setState({ status: 'loading', data: null, message: '' });
    setPhaseTwoMessage('');
    try {
      const data = await resolvePublicHospitalFeedbackQr(token);
      if (!data.valid) {
        setState({ status: 'invalid', data: null, message: data.message || 'This QR code is invalid or no longer active.' });
        return;
      }
      setState({ status: 'valid', data, message: '' });
    } catch (error) {
      const status = error.response?.status;
      const payload = error.response?.data;
      if (status === 404 && payload?.message) {
        setState({ status: 'invalid', data: null, message: payload.message });
        return;
      }
      setState({ status: 'network', data: null, message: 'Unable to validate this QR right now. Please retry.' });
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(loadQr);
  }, [loadQr]);

  if (state.status === 'loading') {
    return (
      <PublicShell>
        <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto button-spinner text-qpms-700" />
          <h1 className="mt-5 text-xl font-bold">Identifying location...</h1>
          <p className="mt-3 text-sm text-slate-600">Please wait while myQPMS validates this QR code.</p>
        </section>
      </PublicShell>
    );
  }

  if (state.status === 'invalid') {
    return (
      <PublicShell>
        <section className="rounded-lg border border-rose-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-xl font-bold">QR unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{state.message}</p>
        </section>
      </PublicShell>
    );
  }

  if (state.status === 'network') {
    return (
      <PublicShell>
        <section className="rounded-lg border border-amber-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-xl font-bold">Validation failed</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{state.message}</p>
          <button
            type="button"
            onClick={loadQr}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </section>
      </PublicShell>
    );
  }

  const location = state.data?.location || {};

  return (
    <PublicShell>
      <section className="rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
        <div className="grid justify-items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-bold">Location identified successfully.</h1>
        </div>

        <div className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Hospital</div>
            <div className="mt-1 text-lg font-bold text-slate-950">{location.hospitalName || 'Hospital'}</div>
          </div>
          {[['Block', location.blockName], ['Floor', location.floorName], ['Location', location.locationName], ['Type', location.locationType]].map(([label, value]) => (
            value ? (
              <div key={label}>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1 text-base font-semibold text-slate-800">{value}</div>
              </div>
            ) : null
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPhaseTwoMessage('Survey will be added in Phase 2.')}
          className="mt-6 min-h-12 w-full rounded-lg bg-qpms-700 px-4 py-3 text-base font-bold text-white"
        >
          Continue to Feedback
        </button>
        {phaseTwoMessage ? (
          <p className="mt-3 text-center text-sm font-semibold text-slate-600">{phaseTwoMessage}</p>
        ) : null}
      </section>
    </PublicShell>
  );
}
