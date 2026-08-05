import { AlertTriangle, CheckCircle2, Languages, RefreshCw, Send, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import qpmsLogo from '../assets/qpms-logo.png';
import { resolvePublicHospitalFeedbackQr, submitPublicHospitalFeedback, verifyPublicHospitalFeedbackSession } from '../services/api.js';

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
    client: 'Client',
    hospital: 'Hospital',
    block: 'Block',
    floor: 'Floor',
    department: 'Department',
    location: 'Location',
    continue: 'Continue',
    cleanlinessTitle: 'Is the toilet clean?',
    cleanlinessBody: 'Please choose one option.',
    cleanOption: 'Yes, Clean',
    notCleanOption: 'No, Not Clean',
    detailsTitle: 'Tell us more',
    detailsBody: 'Your name is optional. You can also share a comment or suggestion.',
    complaintTitle: 'Tell us what is wrong',
    complaintBody: 'Please share the issue so the hospital team can resolve it quickly.',
    nameLabel: 'Your Name',
    namePlaceholder: 'Enter your name (optional)',
    mobileLabel: 'Mobile Number',
    mobilePlaceholder: 'Enter mobile number (optional)',
    commentLabel: 'Comment',
    commentPlaceholder: 'Share your feedback or suggestion (optional)',
    complaintPlaceholder: 'Clearly explain what is not clean',
    back: 'Back',
    edit: 'Edit',
    nameTooLong: 'Name must be 120 characters or fewer.',
    invalidMobile: 'Enter a valid 10-digit Indian mobile number.',
    complaintRequired: 'Complaint details are required.',
    commentTooLong: 'Comment must be 2000 characters or fewer.',
    nameNotProvided: 'Name not provided',
    noCommentProvided: 'No comment provided',
    ratingTitle: 'How was your experience?',
    ratingBody: 'Please rate your experience.',
    ratingHelper: 'Your feedback is valuable to us.',
    submit: 'Submit Feedback',
    submitting: 'Submitting...',
    submitFailed: 'Unable to submit feedback. Please retry.',
    selectRating: 'Please select one rating to continue.',
    thankTitle: 'Thank you!',
    thankBody: 'Your feedback has been submitted successfully.',
    complaintThankBody: 'Complaint submitted successfully',
    ticketNumber: 'Ticket number',
    notifiedMessage: 'The ticket has been shared with the hospital management team and will be resolved within 1 hour.',
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
    client: 'வாடிக்கையாளர்',
    hospital: 'மருத்துவமனை',
    block: 'பிளாக்',
    floor: 'தளம்',
    department: 'துறை',
    location: 'இடம்',
    continue: 'தொடரவும்',
    cleanlinessTitle: 'கழிப்பறை சுத்தமாக உள்ளதா?',
    cleanlinessBody: 'ஒரு விருப்பத்தைத் தேர்வு செய்யவும்.',
    cleanOption: 'சுத்தமாக உள்ளது',
    notCleanOption: 'சுத்தமாக இல்லை',
    detailsTitle: 'மேலும் தெரிவிக்கவும்',
    detailsBody: 'உங்கள் பெயர் விருப்பமானது. கருத்து அல்லது பரிந்துரையையும் பகிரலாம்.',
    complaintTitle: 'என்ன பிரச்சனை என்பதை தெரிவிக்கவும்',
    complaintBody: 'மருத்துவமனை குழு விரைவாக சரிசெய்ய பிரச்சனையை பகிரவும்.',
    nameLabel: 'உங்கள் பெயர்',
    namePlaceholder: 'உங்கள் பெயரை உள்ளிடவும் (விருப்பம்)',
    mobileLabel: 'மொபைல் எண்',
    mobilePlaceholder: 'மொபைல் எண்ணை உள்ளிடவும் (விருப்பம்)',
    commentLabel: 'கருத்து',
    commentPlaceholder: 'உங்கள் கருத்து அல்லது பரிந்துரையை பகிரவும் (விருப்பம்)',
    complaintPlaceholder: 'சுத்தமாக இல்லாததை தெளிவாக விளக்கவும்',
    back: 'பின்செல்',
    edit: 'திருத்து',
    nameTooLong: 'பெயர் 120 எழுத்துகளுக்குள் இருக்க வேண்டும்.',
    invalidMobile: 'சரியான 10 இலக்க இந்திய மொபைல் எண்ணை உள்ளிடவும்.',
    complaintRequired: 'புகார் விவரங்கள் அவசியம்.',
    commentTooLong: 'கருத்து 2000 எழுத்துகளுக்குள் இருக்க வேண்டும்.',
    nameNotProvided: 'பெயர் வழங்கப்படவில்லை',
    noCommentProvided: 'கருத்து வழங்கப்படவில்லை',
    ratingTitle: 'உங்கள் அனுபவம் எப்படி இருந்தது?',
    ratingBody: 'உங்கள் அனுபவத்தை மதிப்பிடவும்.',
    ratingHelper: 'உங்கள் கருத்து எங்களுக்கு மிகவும் முக்கியமானது.',
    submit: 'கருத்தை சமர்ப்பிக்கவும்',
    submitting: 'சமர்ப்பிக்கிறது...',
    submitFailed: 'கருத்தை சமர்ப்பிக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    selectRating: 'தொடர ஒரு மதிப்பீட்டைத் தேர்வு செய்யவும்.',
    thankTitle: 'நன்றி!',
    thankBody: 'உங்கள் கருத்து வெற்றிகரமாக பதிவு செய்யப்பட்டது.',
    complaintThankBody: 'புகார் வெற்றிகரமாக சமர்ப்பிக்கப்பட்டது',
    ticketNumber: 'டிக்கெட் எண்',
    notifiedMessage: 'இந்த டிக்கெட் மருத்துவமனை நிர்வாகக் குழுவுடன் பகிரப்பட்டுள்ளது. இது 1 மணி நேரத்திற்குள் தீர்க்கப்படும்.',
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
    [t.client, location.clientName],
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

function CleanlinessPage({ language, selected, onSelect, onBack, onContinue, onLanguageChange }) {
  const t = TEXT[language];
  const options = [
    { value: 'clean', label: t.cleanOption, tone: 'emerald' },
    { value: 'not_clean', label: t.notCleanOption, tone: 'rose' },
  ];
  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard>
        <div className="text-center">
          <QpmsLogo className="mx-auto h-14 w-14" />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-slate-950">{t.cleanlinessTitle}</h1>
          <p className="mt-2 text-base leading-7 text-slate-600">{t.cleanlinessBody}</p>
        </div>
        <div className="mt-6 grid gap-3">
          {options.map((option) => {
            const active = selected === option.value;
            const activeClass = option.tone === 'emerald'
              ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100'
              : 'border-rose-500 bg-rose-50 ring-2 ring-rose-100';
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                aria-pressed={active}
                className={`min-h-16 rounded-xl border px-4 py-3 text-lg font-black shadow-sm ${active ? activeClass : 'border-slate-200 bg-white text-slate-800'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onBack} className="min-h-14 rounded-xl border border-slate-200 px-4 py-3 text-lg font-bold text-slate-700">
            {t.back}
          </button>
          <button type="button" onClick={onContinue} disabled={!selected} className="min-h-14 rounded-xl bg-qpms-700 px-4 py-3 text-lg font-bold text-white shadow-sm disabled:bg-slate-400">
            {t.continue}
          </button>
        </div>
      </FeedbackCard>
    </PublicShell>
  );
}

function RespondentDetailsPage({
  language,
  details,
  onChange,
  onContinue,
  onBack,
  onLanguageChange,
  complaint = false,
  submitting = false,
  submitError = '',
}) {
  const t = TEXT[language];
  const nameError = details.name.length > 120 ? t.nameTooLong : '';
  const mobileDigits = details.mobile.replace(/\D+/g, '');
  const normalizedMobile = mobileDigits.length === 12 && mobileDigits.startsWith('91') ? mobileDigits.slice(2) : mobileDigits;
  const mobileError = normalizedMobile && !/^[6-9][0-9]{9}$/.test(normalizedMobile) ? t.invalidMobile : '';
  const commentError = details.comment.length > 2000 ? t.commentTooLong : '';
  const requiredError = complaint && !details.comment.trim() ? t.complaintRequired : '';
  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard>
        <div className="text-center">
          <QpmsLogo className="mx-auto h-14 w-14" />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-slate-950">{complaint ? t.complaintTitle : t.detailsTitle}</h1>
          <p className="mt-2 text-base leading-7 text-slate-600">{complaint ? t.complaintBody : t.detailsBody}</p>
        </div>
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">{t.nameLabel}</span>
            <input
              value={details.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder={t.namePlaceholder}
              maxLength={140}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            />
            {nameError ? <span className="mt-1 block text-xs font-bold text-rose-600">{nameError}</span> : null}
          </label>
          {complaint ? (
            <label className="block">
              <span className="text-sm font-bold text-slate-700">{t.mobileLabel}</span>
              <input
                value={details.mobile}
                onChange={(event) => onChange('mobile', event.target.value)}
                placeholder={t.mobilePlaceholder}
                inputMode="tel"
                className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
              />
              {mobileError ? <span className="mt-1 block text-xs font-bold text-rose-600">{mobileError}</span> : null}
            </label>
          ) : null}
          <label className="block">
            <span className="text-sm font-bold text-slate-700">{t.commentLabel}</span>
            <textarea
              value={details.comment}
              onChange={(event) => onChange('comment', event.target.value)}
              placeholder={complaint ? t.complaintPlaceholder : t.commentPlaceholder}
              maxLength={2050}
              rows={5}
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
            />
            <div className="mt-1 flex items-center justify-between text-xs font-bold">
              <span className={(commentError || requiredError) ? 'text-rose-600' : 'text-slate-400'}>{commentError || requiredError}</span>
              <span className={details.comment.length > 2000 ? 'text-rose-600' : 'text-slate-400'}>{details.comment.length} / 2000</span>
            </div>
          </label>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onBack} className="min-h-14 rounded-xl border border-slate-200 px-4 py-3 text-lg font-bold text-slate-700">
            {t.back}
          </button>
          <button type="button" onClick={onContinue} disabled={submitting || Boolean(nameError || mobileError || commentError || requiredError)} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-qpms-700 px-4 py-3 text-lg font-bold text-white shadow-sm disabled:bg-slate-400">
            {submitting ? <span className="button-spinner" /> : null}
            {submitting ? t.submitting : complaint ? t.submit : t.continue}
          </button>
        </div>
        {submitError ? <p className="mt-3 text-center text-sm font-bold text-rose-600">{submitError}</p> : null}
      </FeedbackCard>
    </PublicShell>
  );
}

function previewText(value, fallback, max = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

function RatingPage({
  language,
  selectedRating,
  onSelectRating,
  onLanguageChange,
  onSubmit,
  onEditDetails,
  details,
  onDetailsChange,
  submitAttempted,
  submitting,
  submitError,
}) {
  const t = TEXT[language];
  const name = previewText(details.name, t.nameNotProvided, 64);
  const comment = previewText(details.comment, '', 110);
  return (
    <PublicShell>
      <LanguageSwitch language={language} onChange={onLanguageChange} />
      <FeedbackCard>
        <div className="text-center">
          <QpmsLogo className="mx-auto h-14 w-14" />
          <h1 className="mt-5 text-2xl font-bold leading-tight text-slate-950">{t.ratingTitle}</h1>
          <p className="mt-2 text-base leading-7 text-slate-600">{t.ratingBody}</p>
        </div>
        {details.name || details.comment ? (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.nameLabel}</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{name}</p>
                {comment ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{comment}</p> : null}
              </div>
              <button type="button" onClick={onEditDetails} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-qpms-700">{t.edit}</button>
            </div>
          </div>
        ) : null}
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
        <label className="mt-5 block">
          <span className="text-sm font-bold text-slate-700">{t.commentLabel}</span>
          <textarea
            value={details.comment}
            onChange={(event) => onDetailsChange('comment', event.target.value)}
            placeholder={t.commentPlaceholder}
            maxLength={2050}
            rows={4}
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
          />
          <div className="mt-1 flex items-center justify-between text-xs font-bold">
            <span className={details.comment.length > 2000 ? 'text-rose-600' : 'text-slate-400'}>
              {details.comment.length > 2000 ? t.commentTooLong : ''}
            </span>
            <span className={details.comment.length > 2000 ? 'text-rose-600' : 'text-slate-400'}>{details.comment.length} / 2000</span>
          </div>
        </label>
        {submitAttempted && !selectedRating ? <p className="mt-3 text-center text-sm font-bold text-rose-600">{t.selectRating}</p> : null}
        {submitError ? <p className="mt-3 text-center text-sm font-bold text-rose-600">{submitError}</p> : null}
        {selectedRating ? (
          <button type="button" onClick={onSubmit} disabled={submitting} className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-qpms-700 px-4 py-3 text-lg font-bold text-white shadow-sm disabled:bg-slate-400">
            {submitting ? <span className="button-spinner" /> : <Send className="h-5 w-5" />}
            {submitting ? t.submitting : t.submit}
          </button>
        ) : null}
      </FeedbackCard>
    </PublicShell>
  );
}

function ThankYouPage({ language, onLanguageChange, onDone, complaint = null }) {
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
          <p className="mt-3 text-lg font-semibold leading-8 text-slate-700">{complaint ? t.complaintThankBody : t.thankBody}</p>
          {complaint?.ticketNumber ? (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-black text-emerald-700">{t.ticketNumber}</p>
              <p className="mt-1 text-2xl font-black text-emerald-950">{complaint.ticketNumber}</p>
            </div>
          ) : null}
          <p className="mt-2 text-base leading-7 text-slate-500">{complaint ? t.notifiedMessage : t.thankSubtext}</p>
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

function newSubmissionKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const segment = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${segment()}${segment()}-${segment()}-4${segment().slice(1)}-8${segment().slice(1)}-${segment()}${segment()}${segment()}`;
}

export default function PublicFeedbackQrPage() {
  useNoIndex();
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });
  const [language, setLanguage] = useState('');
  const [currentStep, setCurrentStep] = useState('language');
  const [selectedRating, setSelectedRating] = useState(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submissionKey, setSubmissionKey] = useState(() => newSubmissionKey());
  const [respondentDetails, setRespondentDetails] = useState({ name: '', mobile: '', comment: '' });
  const [cleanlinessStatus, setCleanlinessStatus] = useState('');
  const [complaintConfirmation, setComplaintConfirmation] = useState(null);

  const languageStorageKey = useMemo(() => `hospital-feedback-qr:${token || 'missing'}:language`, [token]);

  const loadQr = useCallback(async () => {
    setState({ status: 'loading', data: null, message: '' });
    setLanguage('');
    setSelectedRating(null);
    setSubmitAttempted(false);
    setSubmitting(false);
    setSubmitError('');
    setSubmissionKey(newSubmissionKey());
    setRespondentDetails({ name: '', mobile: '', comment: '' });
    setCleanlinessStatus('');
    setComplaintConfirmation(null);
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

  async function goToCleanliness() {
    if (await ensureSessionActive()) setCurrentStep('cleanliness');
  }

  async function continueFromCleanliness() {
    if (!cleanlinessStatus) return;
    if (!(await ensureSessionActive())) return;
    setSubmitError('');
    if (cleanlinessStatus === 'clean') setCurrentStep('rating');
    else setCurrentStep('details');
  }

  async function goToDetails() {
    if (await ensureSessionActive()) setCurrentStep('details');
  }

  function updateRespondentDetails(field, value) {
    setRespondentDetails((current) => ({ ...current, [field]: value }));
  }

  function normalizedDetails() {
    const name = respondentDetails.name.trim();
    const digits = respondentDetails.mobile.replace(/\D+/g, '');
    const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
    const comment = respondentDetails.comment.trim();
    return {
      respondent_name: name || null,
      respondent_mobile: mobile || null,
      comments: comment || null,
    };
  }

  async function submitDemoFeedback() {
    if (submitting) return;
    setSubmitAttempted(true);
    setSubmitError('');
    if (cleanlinessStatus === 'clean' && !selectedRating) return;
    if (cleanlinessStatus === 'clean' && respondentDetails.comment.length > 2000) {
      setSubmitError(TEXT[language || 'en'].commentTooLong);
      return;
    }
    if (!(await ensureSessionActive())) return;
    setSubmitting(true);
    try {
      const result = await submitPublicHospitalFeedback({
        session_token: state.data?.session?.token,
        submission_key: submissionKey,
        cleanliness_status: cleanlinessStatus,
        rating: cleanlinessStatus === 'clean' ? selectedRating : null,
        language,
        ...normalizedDetails(),
        answers: {},
      });
      setComplaintConfirmation(result?.complaint || null);
      setCurrentStep('thankYou');
    } catch (error) {
      setSubmitError(error.response?.data?.message || TEXT[language || 'en'].submitFailed);
    } finally {
      setSubmitting(false);
    }
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
    return <LocationPage language={language} location={location} onLanguageChange={updateLanguage} onContinue={goToCleanliness} />;
  }

  if (currentStep === 'cleanliness') {
    return (
      <CleanlinessPage
        language={language}
        selected={cleanlinessStatus}
        onSelect={(value) => { setCleanlinessStatus(value); setSubmitError(''); }}
        onBack={() => setCurrentStep('location')}
        onContinue={continueFromCleanliness}
        onLanguageChange={updateLanguage}
      />
    );
  }

  if (currentStep === 'details') {
    return (
      <RespondentDetailsPage
        language={language}
        details={respondentDetails}
        onChange={updateRespondentDetails}
        onContinue={submitDemoFeedback}
        onBack={() => setCurrentStep('cleanliness')}
        onLanguageChange={updateLanguage}
        complaint={cleanlinessStatus === 'not_clean'}
        submitting={submitting}
        submitError={submitError}
      />
    );
  }

  if (currentStep === 'rating') {
    return (
      <RatingPage
        language={language}
        selectedRating={selectedRating}
        onSelectRating={(value) => { setSelectedRating(value); setSubmitAttempted(false); setSubmitError(''); }}
        onLanguageChange={updateLanguage}
        onSubmit={submitDemoFeedback}
        onEditDetails={goToDetails}
        details={respondentDetails}
        onDetailsChange={updateRespondentDetails}
        submitAttempted={submitAttempted}
        submitting={submitting}
        submitError={submitError}
      />
    );
  }

  if (currentStep === 'thankYou') {
    return <ThankYouPage language={language} onLanguageChange={updateLanguage} onDone={() => setCurrentStep('complete')} complaint={complaintConfirmation} />;
  }

  return <CompletePage language={language} onLanguageChange={updateLanguage} />;
}
