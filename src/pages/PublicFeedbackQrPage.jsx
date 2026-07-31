import { AlertTriangle, CheckCircle2, Languages, RefreshCw, Send, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import qpmsLogo from '../assets/qpms-logo.png';
import { resolvePublicHospitalFeedbackQr, verifyPublicHospitalFeedbackSession } from '../services/api.js';

const TEXT = {
  en: {
    languageName: 'English',
    welcomeTitle: 'Welcome!',
    welcomeBody: 'Your feedback helps us improve patient care.',
    languageLabel: 'English',
    poweredBy: 'Powered by myQPMS',
    loadingTitle: 'Identifying location...',
    loadingBody: 'Please wait while myQPMS validates this QR code.',
    scanTitle: 'Please scan the QR code displayed at the hospital location.',
    scanBody: 'This page opens only with a valid secure QR token.',
    invalidTitle: 'Invalid QR Code',
    invalidBody: 'This QR code is invalid or no longer active.',
    expiredTitle: 'Session expired',
    expiredBody: 'Please scan the QR code again.',
    networkTitle: 'Validation failed',
    networkBody: 'Unable to validate this QR right now. Please retry.',
    retry: 'Retry',
    locationTitle: 'Location identified successfully.',
    hospital: 'Hospital',
    block: 'Block',
    floor: 'Floor',
    department: 'Department',
    location: 'Location',
    continue: 'Continue',
    ratingTitle: 'How was your experience?',
    ratingBody: 'Please rate your experience.',
    ratingHelper: 'Your feedback is valuable to us.',
    submit: 'Submit Feedback',
    selectRating: 'Please select one rating to continue.',
    thankTitle: 'Thank you!',
    thankBody: 'Your feedback has been submitted successfully.',
    thankSubtext: 'We appreciate your time.',
    done: 'Done',
    complete: 'You may now close this page.',
    ratings: [
      { icon: '😊', label: 'Excellent', value: 5 },
      { icon: '🙂', label: 'Good', value: 4 },
      { icon: '😐', label: 'Average', value: 3 },
      { icon: '😞', label: 'Poor', value: 2 },
      { icon: '😡', label: 'Very Poor', value: 1 },
    ],
  },
  ta: {
    languageName: 'தமிழ்',
    welcomeTitle: 'வரவேற்கிறோம்!',
    welcomeBody: 'உங்கள் கருத்து நோயாளி சேவையை மேம்படுத்த எங்களுக்கு உதவுகிறது.',
    languageLabel: 'தமிழ்',
    poweredBy: 'Powered by myQPMS',
    loadingTitle: 'இடம் கண்டறியப்படுகிறது...',
    loadingBody: 'myQPMS இந்த QR குறியீட்டை சரிபார்க்கும் வரை காத்திருக்கவும்.',
    scanTitle: 'மருத்துவமனை இடத்தில் காட்டப்பட்டுள்ள QR குறியீட்டை ஸ்கேன் செய்யவும்.',
    scanBody: 'இந்தப் பக்கம் செல்லுபடியாகும் பாதுகாப்பான QR டோக்கனுடன் மட்டுமே திறக்கும்.',
    invalidTitle: 'தவறான QR குறியீடு',
    invalidBody: 'இந்த QR குறியீடு தவறானது அல்லது இனி செயல்பாட்டில் இல்லை.',
    expiredTitle: 'அமர்வு காலாவதியானது',
    expiredBody: 'QR குறியீட்டை மீண்டும் ஸ்கேன் செய்யவும்.',
    networkTitle: 'சரிபார்ப்பு தோல்வியடைந்தது',
    networkBody: 'இந்த QR குறியீட்டை இப்போது சரிபார்க்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    retry: 'மீண்டும் முயற்சி',
    locationTitle: 'இடம் வெற்றிகரமாக கண்டறியப்பட்டது.',
    hospital: 'மருத்துவமனை',
    block: 'பிளாக்',
    floor: 'தளம்',
    department: 'துறை',
    location: 'இடம்',
    continue: 'தொடரவும்',
    ratingTitle: 'உங்கள் அனுபவம் எப்படி இருந்தது?',
    ratingBody: 'உங்கள் அனுபவத்தை மதிப்பிடவும்.',
    ratingHelper: 'உங்கள் கருத்து எங்களுக்கு மிகவும் முக்கியமானது.',
    submit: 'கருத்தை சமர்ப்பிக்கவும்',
    selectRating: 'தொடர ஒரு மதிப்பீட்டைத் தேர்வு செய்யவும்.',
    thankTitle: 'நன்றி!',
    thankBody: 'உங்கள் கருத்து வெற்றிகரமாக பதிவு செய்யப்பட்டது.',
    thankSubtext: 'உங்கள் நேரத்திற்கு நன்றி.',
    done: 'முடிக்கவும்',
    complete: 'இப்போது இந்தப் பக்கத்தை மூடலாம்.',
    ratings: [
      { icon: '😊', label: 'மிகவும் சிறப்பு', value: 5 },
      { icon: '🙂', label: 'நல்லது', value: 4 },
      { icon: '😐', label: 'சராசரி', value: 3 },
      { icon: '😞', label: 'மோசம்', value: 2 },
      { icon: '😡', label: 'மிகவும் மோசம்', value: 1 },
    ],
  },
};

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
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-950 antialiased [font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif]">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col justify-center">
        {children}
      </div>
    </main>
  );
}

function QpmsLogo({ className = 'h-16 w-16' }) {
  return <img src={qpmsLogo} alt="QPMS logo" className={`${className} rounded-2xl object-contain shadow-sm`} />;
}

function LanguageSwitch({ language, onChange }) {
  return (
    <div className="mb-4 flex justify-end">
      <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm font-bold text-slate-600 shadow-sm">
        <Languages className="ml-2 h-4 w-4 text-qpms-700" />
        {['en', 'ta'].map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onChange(code)}
            className={`min-h-9 rounded-full px-3 ${language === code ? 'bg-qpms-700 text-white' : 'text-slate-600'}`}
          >
            {TEXT[code].languageName}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedbackCard({ children, tone = 'slate' }) {
  const border = tone === 'success' ? 'border-emerald-200' : tone === 'warning' ? 'border-amber-200' : tone === 'danger' ? 'border-rose-200' : 'border-slate-200';
  return <section className={`rounded-2xl border ${border} bg-white p-6 shadow-sm`}>{children}</section>;
}

function StatusIcon({ tone = 'success' }) {
  const classes = {
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-rose-50 text-rose-700',
    brand: 'bg-qpms-50 text-qpms-700',
  };
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${classes[tone]}`}>
      <Icon className="h-7 w-7" />
    </div>
  );
}

function ErrorView({ title, body, tone = 'danger', onRetry, retryText = 'Retry' }) {
  return (
    <PublicShell>
      <FeedbackCard tone={tone}>
        <div className="text-center">
          <StatusIcon tone={tone} />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-slate-950">{title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{body}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-base font-bold text-white"
            >
              <RefreshCw className="h-4 w-4" />
              {retryText}
            </button>
          ) : null}
        </div>
      </FeedbackCard>
    </PublicShell>
  );
}

export function PublicFeedbackScanInstruction() {
  useNoIndex();
  return (
    <PublicShell>
      <FeedbackCard>
        <div className="text-center">
          <StatusIcon tone="brand" />
          <h1 className="mt-5 text-xl font-bold leading-tight">{TEXT.en.scanTitle}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{TEXT.en.scanBody}</p>
        </div>
      </FeedbackCard>
    </PublicShell>
  );
}

function LanguageSelection({ onSelect }) {
  return (
    <PublicShell>
      <FeedbackCard>
        <div className="text-center">
          <QpmsLogo className="mx-auto h-16 w-16" />
          <h1 className="mt-5 text-3xl font-bold leading-tight text-slate-950">{TEXT.en.welcomeTitle}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{TEXT.en.welcomeBody}</p>
          <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4">
            <h2 className="text-2xl font-bold leading-snug text-slate-950">{TEXT.ta.welcomeTitle}</h2>
            <p className="mt-2 text-base leading-8 text-slate-600">{TEXT.ta.welcomeBody}</p>
          </div>
          <div className="mt-6 grid gap-3">
            <button type="button" onClick={() => onSelect('en')} className="min-h-14 rounded-xl bg-qpms-700 px-4 py-3 text-lg font-bold text-white shadow-sm">
              {TEXT.en.languageLabel}
            </button>
            <button type="button" onClick={() => onSelect('ta')} className="min-h-14 rounded-xl border border-qpms-200 bg-qpms-50 px-4 py-3 text-lg font-bold text-qpms-800">
              {TEXT.ta.languageLabel}
            </button>
          </div>
          <p className="mt-6 text-xs font-semibold text-slate-400">{TEXT.en.poweredBy}</p>
        </div>
      </FeedbackCard>
    </PublicShell>
  );
}

function LocationPage({ language, location, onLanguageChange, onContinue }) {
  const t = TEXT[language];
  const rows = [
    [t.hospital, location.hospitalName],
    [t.block, location.blockName],
    [t.floor, location.floorName],
    [t.department, location.departmentName],
    [t.location, location.locationName],
  ].filter(([, value]) => Boolean(value));

  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard tone="success">
        <div className="grid justify-items-center text-center">
          <StatusIcon tone="success" />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-slate-950">{t.locationTitle}</h1>
        </div>
        <div className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50">
          {rows.map(([label, value]) => (
            <div key={label} className="px-4 py-3">
              <div className="text-sm font-bold text-slate-500">{label}</div>
              <div className="mt-1 text-lg font-bold leading-7 text-slate-950">{value}</div>
            </div>
          ))}
        </div>
        <button type="button" onClick={onContinue} className="mt-6 min-h-14 w-full rounded-xl bg-qpms-700 px-4 py-3 text-lg font-bold text-white shadow-sm">
          {t.continue}
        </button>
      </FeedbackCard>
    </PublicShell>
  );
}

function RatingPage({ language, selectedRating, onSelectRating, onLanguageChange, onSubmit, submitAttempted }) {
  const t = TEXT[language];
  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard>
        <div className="text-center">
          <QpmsLogo className="mx-auto h-14 w-14" />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-slate-950">{t.ratingTitle}</h1>
          <p className="mt-2 text-base leading-7 text-slate-600">{t.ratingBody}</p>
        </div>
        <div className="mt-6 grid gap-3">
          {t.ratings.map((rating) => {
            const active = selectedRating === rating.value;
            return (
              <button
                key={rating.value}
                type="button"
                onClick={() => onSelectRating(rating.value)}
                className={`flex min-h-16 items-center justify-between rounded-xl border px-4 py-3 text-left shadow-sm transition ${active ? 'border-qpms-500 bg-qpms-50 ring-2 ring-qpms-100' : 'border-slate-200 bg-white'}`}
                aria-pressed={active}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-3xl leading-none" aria-hidden="true">{rating.icon}</span>
                  <span className="text-base font-bold leading-6 text-slate-950">{rating.label}</span>
                </span>
                <span className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${active ? 'bg-qpms-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{rating.value}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-center text-sm font-semibold leading-6 text-slate-500">{t.ratingHelper}</p>
        {submitAttempted && !selectedRating ? <p className="mt-3 text-center text-sm font-bold text-rose-600">{t.selectRating}</p> : null}
        {selectedRating ? (
          <button type="button" onClick={onSubmit} className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-qpms-700 px-4 py-3 text-lg font-bold text-white shadow-sm">
            <Send className="h-5 w-5" />
            {t.submit}
          </button>
        ) : null}
      </FeedbackCard>
    </PublicShell>
  );
}

function ThankYouPage({ language, onLanguageChange, onDone }) {
  const t = TEXT[language];
  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard tone="success">
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Star className="h-8 w-8 fill-current" />
          </div>
          <h1 className="mt-5 text-3xl font-bold leading-tight text-slate-950">{t.thankTitle}</h1>
          <p className="mt-3 text-lg font-semibold leading-8 text-slate-700">{t.thankBody}</p>
          <p className="mt-2 text-base leading-7 text-slate-500">{t.thankSubtext}</p>
          <button type="button" onClick={onDone} className="mt-7 min-h-14 w-full rounded-xl bg-slate-900 px-4 py-3 text-lg font-bold text-white">
            {t.done}
          </button>
        </div>
      </FeedbackCard>
    </PublicShell>
  );
}

function CompletePage({ language, onLanguageChange }) {
  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard tone="success">
        <div className="text-center">
          <StatusIcon tone="success" />
          <h1 className="mt-5 text-xl font-bold leading-8 text-slate-950">{TEXT[language].complete}</h1>
        </div>
      </FeedbackCard>
    </PublicShell>
  );
}

export default function PublicFeedbackQrPage() {
  useNoIndex();
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });
  const [language, setLanguage] = useState('');
  const [currentStep, setCurrentStep] = useState('language');
  const [selectedRating, setSelectedRating] = useState(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const languageStorageKey = useMemo(() => `hospital-feedback-qr:${token || 'missing'}:language`, [token]);

  const loadQr = useCallback(async () => {
    setState({ status: 'loading', data: null, message: '' });
    setLanguage('');
    setSelectedRating(null);
    setSubmitAttempted(false);
    setCurrentStep('language');
    try {
      const data = await resolvePublicHospitalFeedbackQr(token);
      if (!data.valid) {
        setState({ status: 'invalid', data: null, message: data.message || TEXT.en.invalidBody });
        return;
      }
      setState({ status: 'valid', data, message: '' });
    } catch (error) {
      const status = error.response?.status;
      const payload = error.response?.data;
      if (status === 404 && payload?.message) {
        setState({ status: 'invalid', data: null, message: TEXT.en.invalidBody });
        return;
      }
      setState({ status: 'network', data: null, message: TEXT.en.networkBody });
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(loadQr);
  }, [loadQr]);

  function updateLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    try {
      window.sessionStorage.setItem(languageStorageKey, nextLanguage);
    } catch {
      // Session storage is best-effort for this public demo flow.
    }
  }

  async function ensureSessionActive() {
    const sessionToken = state.data?.session?.token;
    if (!sessionToken) {
      setState((current) => ({ ...current, status: 'expired', message: TEXT[language || 'en'].expiredBody }));
      return false;
    }
    try {
      await verifyPublicHospitalFeedbackSession(sessionToken);
      return true;
    } catch {
      setState((current) => ({ ...current, status: 'expired', message: TEXT[language || 'en'].expiredBody }));
      return false;
    }
  }

  async function goToRating() {
    if (await ensureSessionActive()) setCurrentStep('rating');
  }

  async function submitDemoFeedback() {
    setSubmitAttempted(true);
    if (!selectedRating) return;
    if (await ensureSessionActive()) setCurrentStep('thankYou');
  }

  if (state.status === 'loading') {
    return (
      <PublicShell>
        <FeedbackCard>
          <div className="text-center">
            <div className="mx-auto button-spinner text-qpms-700" />
            <h1 className="mt-5 text-xl font-bold">{TEXT.en.loadingTitle}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{TEXT.en.loadingBody}</p>
          </div>
        </FeedbackCard>
      </PublicShell>
    );
  }

  if (state.status === 'invalid') {
    return <ErrorView title={TEXT.en.invalidTitle} body={TEXT.en.invalidBody} tone="danger" />;
  }

  if (state.status === 'expired') {
    const t = TEXT[language || 'en'];
    return <ErrorView title={t.expiredTitle} body={t.expiredBody} tone="warning" />;
  }

  if (state.status === 'network') {
    return <ErrorView title={TEXT.en.networkTitle} body={state.message || TEXT.en.networkBody} tone="warning" onRetry={loadQr} retryText={TEXT.en.retry} />;
  }

  const location = state.data?.location || {};

  if (currentStep === 'language' || !language) {
    return <LanguageSelection onSelect={(nextLanguage) => { updateLanguage(nextLanguage); setCurrentStep('location'); }} />;
  }

  if (currentStep === 'location') {
    return <LocationPage language={language} location={location} onLanguageChange={updateLanguage} onContinue={goToRating} />;
  }

  if (currentStep === 'rating') {
    return (
      <RatingPage
        language={language}
        selectedRating={selectedRating}
        onSelectRating={(value) => { setSelectedRating(value); setSubmitAttempted(false); }}
        onLanguageChange={updateLanguage}
        onSubmit={submitDemoFeedback}
        submitAttempted={submitAttempted}
      />
    );
  }

  if (currentStep === 'thankYou') {
    return <ThankYouPage language={language} onLanguageChange={updateLanguage} onDone={() => setCurrentStep('complete')} />;
  }

  return <CompletePage language={language} onLanguageChange={updateLanguage} />;
}
