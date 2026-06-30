import { Camera, Save, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/auth-context.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { isSupabaseConfigured, supabase } from '../lib/supabase.js';
import { createProfileAvatarUpload, getMyProfile, updateMyProfile } from '../services/api.js';

const emptyProfile = {
  full_name: '',
  employee_code: '',
  email: '',
  mobile: '',
  role: '',
  department: '',
  designation: '',
  state: '',
  business: '',
  metadata: {},
};

function text(value) {
  return String(value || '');
}

function completionValue(profile) {
  const metadata = profile?.metadata && typeof profile.metadata === 'object' ? profile.metadata : {};
  const roleKey = roleKeyForProfile(profile?.role);
  const requiredFields = isExecutiveRole(roleKey)
    ? [
        profile?.full_name,
        profile?.employee_code,
        profile?.email,
        profile?.mobile,
        profile?.role,
      ]
    : [
        profile?.full_name,
        profile?.employee_code,
        profile?.email || profile?.mobile,
        profile?.role,
        profile?.state,
        profile?.business,
        profile?.designation,
      ];
  const completed = requiredFields.filter((value) => text(value).trim()).length;
  return Math.round((completed / requiredFields.length) * 100) || Number(metadata.profile_completed || 0);
}

function roleKeyForProfile(role) {
  return text(role).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isExecutiveRole(roleKey) {
  return ['ADMIN', 'MD', 'COO'].includes(roleKey);
}

function isOperationalRole(roleKey) {
  return [
    'BUSINESSHEAD',
    'BRANCHHEAD',
    'GM',
    'GENERALMANAGER',
    'OPERATIONSMANAGER',
    'KAM',
    'FO',
    'FIELDOFFICER',
  ].includes(roleKey);
}

function ProfileField({ label, value, onChange, readOnly = false, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase text-slate-500">{label}</span>
      <input
        type={type}
        value={value || ''}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className={`mt-1 h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none ${
          readOnly
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
            : 'border-slate-200 bg-white text-slate-800 focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100'
        }`}
      />
    </label>
  );
}

export default function Profile() {
  usePageTitle('My Profile');
  const { user, refreshUserProfile } = useAuth();
  const [profile, setProfile] = useState(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    getMyProfile()
      .then((result) => {
        if (!active) return;
        setProfile({ ...emptyProfile, ...(result.profile || {}) });
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message || 'Unable to load profile.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const metadata = useMemo(
    () => (profile.metadata && typeof profile.metadata === 'object' ? profile.metadata : {}),
    [profile.metadata],
  );
  const completion = completionValue(profile);
  const avatarUrl = metadata.profile_image_url;
  const roleKey = roleKeyForProfile(profile.role || user?.role);
  const showOperationalFields = isOperationalRole(roleKey) && !isExecutiveRole(roleKey);

  function updateField(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  function updateMetadata(field, value) {
    setProfile((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        [field]: value,
      },
    }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        full_name: text(profile.full_name).trim(),
        mobile: text(profile.mobile).trim(),
        metadata: {
          profile_image_url: text(metadata.profile_image_url).trim(),
        },
      };
      if (showOperationalFields) {
        payload.state = text(profile.state).trim();
        payload.business = text(profile.business).trim();
      }
      const result = await updateMyProfile(payload);
      setProfile({ ...emptyProfile, ...(result.profile || {}) });
      await refreshUserProfile?.();
      setMessage('Profile updated.');
    } catch (saveError) {
      setError(saveError.message || 'Profile update failed.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!isSupabaseConfigured || !supabase) {
      setError('Profile image upload is unavailable because Supabase is not configured.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Profile image must be a JPG, PNG, or WebP file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Profile image must be 2 MB or smaller.');
      return;
    }
    setError('');
    setMessage('');
    try {
      const upload = await createProfileAvatarUpload({
        fileName: file.name,
        contentType: file.type || 'image/png',
        fileSize: file.size,
      });
      const { error: uploadError } = await supabase.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.path, upload.token, file, {
          contentType: file.type || 'image/png',
          upsert: true,
        });
      if (uploadError) throw uploadError;
      updateMetadata('profile_image_url', upload.publicUrl);
      setMessage('Profile image uploaded. Save profile to keep it linked.');
    } catch (uploadError) {
      setError(
        uploadError.response?.data?.message ||
          uploadError.message ||
          'Profile image upload is not configured yet.',
      );
    }
  }

  if (loading) {
    return <div className="enterprise-card p-6 text-sm font-semibold text-slate-500">Loading profile...</div>;
  }

  return (
    <form onSubmit={saveProfile} className="space-y-5">
      <section className="enterprise-card overflow-hidden">
        <div className="flex flex-col gap-5 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-qpms-50 text-qpms-700 ring-1 ring-qpms-100">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-10 w-10" />
                )}
              </div>
              <label className="focus-ring absolute -bottom-2 -right-2 grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm">
                <Camera className="h-4 w-4" />
                <input type="file" accept="image/*" className="sr-only" onChange={uploadAvatar} />
              </label>
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-950">{profile.full_name || user?.name || 'My Profile'}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">{profile.role || user?.role} access</p>
            </div>
          </div>
          <div className="min-w-52">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500">
              <span>Profile Completion</span>
              <span>{completion}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${completion}%` }} />
            </div>
          </div>
        </div>

        <section className="p-5">
          <h2 className="text-sm font-black uppercase text-slate-700">Profile Details</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ProfileField label="Full Name" value={profile.full_name} onChange={(value) => updateField('full_name', value)} />
            <ProfileField label="Employee ID" value={profile.employee_code} readOnly />
            <ProfileField label="Email" value={profile.email} readOnly />
            <ProfileField label="Mobile Number" value={profile.mobile} onChange={(value) => updateField('mobile', value)} />
            <ProfileField label="Role" value={profile.role} readOnly />
            {profile.designation ? (
              <ProfileField label="Designation" value={profile.designation} readOnly />
            ) : null}
            {showOperationalFields ? (
              <>
                <ProfileField label="State" value={profile.state} onChange={(value) => updateField('state', value)} />
                <ProfileField label="Business" value={profile.business} onChange={(value) => updateField('business', value)} />
              </>
            ) : null}
          </div>
        </section>
      </section>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-60">
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </form>
  );
}
