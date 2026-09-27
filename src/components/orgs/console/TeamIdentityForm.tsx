'use client';

import { useRef, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { FEATURE_FLAGS } from '@/lib/features';
import { getSportDefinition } from '@/lib/sports/SportRegistry';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';
import { teamLogoUrl } from '@/lib/teams/logo-url';

// ── A team's identity in the console (teams & divisions program, PR 6) ──────
// Rename, the shown name, the sport, two colours (they dress the team's page;
// with none it wears the club's), and the logo. One Save sends only what
// changed through the team PATCH (manage_teams at the team's scope); the
// logo uploads on pick through its own route. Closing with unsaved edits
// asks first (useDirtyClose — the house rule).
//
// 375px: one column; the colour pickers sit beside their hex fields.

export interface TeamIdentity {
  id: string;
  name: string;
  display_name: string | null;
  sport_key?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  logo_path?: string | null;
}

interface Props {
  side: OrgKind;
  orgId: string;
  team: TeamIdentity;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export default function TeamIdentityForm({ side, orgId, team, onSaved, onError, onClose }: Props) {
  const plural = ORG_ROUTE_FAMILY[side];
  const initial = {
    name: team.name,
    displayName: team.display_name ?? '',
    sportKey: team.sport_key ?? '',
    primaryColor: team.primary_color ?? '',
    secondaryColor: team.secondary_color ?? '',
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoPath, setLogoPath] = useState(team.logo_path ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changed = (Object.keys(initial) as (keyof typeof initial)[]).filter(k => form[k].trim() !== initial[k].trim());
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(() => changed.length > 0, onClose);
  const badColor = (v: string) => v.trim() !== '' && !HEX.test(v.trim());

  const save = async () => {
    if (changed.length === 0 || saving) return;
    if (!form.name.trim()) return onError('A team needs a name');
    if (badColor(form.primaryColor) || badColor(form.secondaryColor)) return onError('A colour is a hex value like #7c3aed');
    const body: Record<string, unknown> = { id: team.id };
    if (changed.includes('name')) body.name = form.name.trim();
    if (changed.includes('displayName')) body.displayName = form.displayName.trim() || null;
    if (changed.includes('sportKey')) body.sportKey = form.sportKey || null;
    if (changed.includes('primaryColor')) body.primaryColor = form.primaryColor.trim() || null;
    if (changed.includes('secondaryColor')) body.secondaryColor = form.secondaryColor.trim() || null;
    setSaving(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/structure/teams`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onError(out.error || 'Could not save the team');
      onSaved('Team saved');
      onClose(); // after a save, never the discard confirm
    } catch {
      onError('Could not save the team');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      const data = new FormData();
      data.append('logo', file);
      const res = await fetch(`/api/${plural}/${orgId}/teams/${team.id}/logo`, { method: 'POST', body: data });
      const out = (await res.json().catch(() => ({}))) as { error?: string; logoPath?: string | null };
      if (!res.ok) return onError(out.error || 'Could not upload the logo');
      setLogoPath(out.logoPath ?? null);
      onSaved('Logo updated');
    } catch {
      onError('Could not upload the logo');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/teams/${team.id}/logo`, { method: 'DELETE' });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onError(out.error || 'Could not remove the logo');
      setLogoPath(null);
      onSaved('Logo removed');
    } catch {
      onError('Could not remove the logo');
    } finally {
      setLogoBusy(false);
    }
  };

  const logoUrl = teamLogoUrl(team.id, logoPath);
  const field = 'w-full min-h-[44px] px-3 border border-border-strong rounded-md text-sm';
  const colorRow = (key: 'primaryColor' | 'secondaryColor', label: string) => (
    <div>
      <label htmlFor={`${key}-${team.id}`} className="block text-sm font-medium text-secondary mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(form[key]) ? form[key].toLowerCase() : '#000000'}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className="h-11 w-11 shrink-0 rounded-md border border-border-strong"
        />
        <input
          id={`${key}-${team.id}`}
          type="text"
          value={form[key]}
          placeholder="#7c3aed"
          maxLength={7}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          className={`${field} min-w-0`}
        />
        {form[key] && (
          <button type="button" onClick={() => setForm(f => ({ ...f, [key]: '' }))} className="min-h-[44px] px-3 text-sm text-secondary">
            Clear
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full mt-2 border-t border-border-subtle pt-3 space-y-3" data-team-identity={team.id}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`team-name-${team.id}`} className="block text-sm font-medium text-secondary mb-1">
            Name
          </label>
          <input id={`team-name-${team.id}`} value={form.name} maxLength={80} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={field} />
        </div>
        <div>
          <label htmlFor={`team-display-${team.id}`} className="block text-sm font-medium text-secondary mb-1">
            Name shown on pages (optional)
          </label>
          <input id={`team-display-${team.id}`} value={form.displayName} maxLength={80} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} className={field} />
        </div>
        <div>
          <label htmlFor={`team-sport-${team.id}`} className="block text-sm font-medium text-secondary mb-1">
            Sport
          </label>
          <select id={`team-sport-${team.id}`} value={form.sportKey} onChange={e => setForm(f => ({ ...f, sportKey: e.target.value }))} className={field}>
            <option value="">Not set</option>
            {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
              <option key={key} value={key}>
                {getSportDefinition(key).display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          {colorRow('primaryColor', 'Main colour')}
          {colorRow('secondaryColor', 'Second colour')}
        </div>
      </div>
      <p className="text-xs text-muted">With no colours set, the team page wears your club’s.</p>

      <div className="flex flex-wrap items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a tokenless streamer URL busted by ?v (the org-logo precedent)
          <img src={logoUrl} alt={`${team.name} logo`} className="h-12 w-12 rounded-md border border-border object-contain bg-surface" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">No logo</span>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label={`Upload a logo for ${team.name}`} onChange={e => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
        <button type="button" disabled={logoBusy} onClick={() => fileRef.current?.click()} className="min-h-[44px] px-3 text-sm rounded-lg border border-border-strong text-secondary disabled:opacity-50">
          {logoBusy ? 'Working…' : logoUrl ? 'Change logo' : 'Upload logo'}
        </button>
        {logoUrl && (
          <button type="button" disabled={logoBusy} onClick={() => void removeLogo()} className="min-h-[44px] px-3 text-sm text-secondary disabled:opacity-50">
            Remove logo
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving || changed.length === 0} onClick={() => void save()} className="min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50">
          {saving ? 'Saving…' : 'Save team'}
        </button>
        <button type="button" onClick={requestClose} className="min-h-[44px] px-4 rounded-lg border border-border-strong text-sm text-secondary">
          Cancel
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}
