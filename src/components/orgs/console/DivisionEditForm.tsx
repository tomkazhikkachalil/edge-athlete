'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';

// ── Edit a division in the console (teams & divisions program, PR 9) ────────
// The name, age band, stream, tier and an expected team count. The sport and
// the season stay put (moving either would re-home every entry). One Save
// sends only what changed (PATCH …/structure/divisions — manage_structure at
// the division's scope); closing with unsaved edits asks first.

export interface DivisionEditable {
  id: string;
  name: string;
  age_band: string | null;
  gender_stream: string | null;
  tier: string | null;
  capacity_estimate?: number | null;
}

interface Props {
  side: OrgKind;
  orgId: string;
  division: DivisionEditable;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export default function DivisionEditForm({ side, orgId, division, onSaved, onError, onClose }: Props) {
  const initial = {
    name: division.name,
    ageBand: division.age_band ?? '',
    genderStream: division.gender_stream ?? '',
    tier: division.tier ?? '',
    capacity: division.capacity_estimate ? String(division.capacity_estimate) : '',
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = (Object.keys(initial) as (keyof typeof initial)[]).filter(k => form[k].trim() !== initial[k].trim());
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(() => changed.length > 0, onClose);

  const save = async () => {
    if (changed.length === 0 || saving) return;
    if (!form.name.trim()) return onError('A division needs a name');
    const capacity = form.capacity.trim();
    if (capacity && !/^\d{1,5}$/.test(capacity)) return onError('Expected teams is a whole number');
    const body: Record<string, unknown> = { id: division.id };
    if (changed.includes('name')) body.name = form.name.trim();
    if (changed.includes('ageBand')) body.ageBand = form.ageBand.trim() || null;
    if (changed.includes('genderStream')) body.genderStream = form.genderStream.trim() || null;
    if (changed.includes('tier')) body.tier = form.tier.trim() || null;
    if (changed.includes('capacity')) body.capacityEstimate = capacity ? Number(capacity) : null;
    setSaving(true);
    try {
      const res = await fetch(`/api/${ORG_ROUTE_FAMILY[side]}/${orgId}/structure/divisions`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onError(out.error || 'Could not save the division');
      onSaved('Division saved');
      onClose();
    } catch {
      onError('Could not save the division');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full min-h-[44px] px-3 border border-border-strong rounded-md text-sm';
  const input = (key: keyof typeof initial, label: string, max: number, extra: Record<string, string> = {}) => (
    <div>
      <label htmlFor={`division-${key}-${division.id}`} className="block text-xs font-medium text-secondary mb-1">
        {label}
      </label>
      <input id={`division-${key}-${division.id}`} value={form[key]} maxLength={max} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={field} {...extra} />
    </div>
  );

  return (
    <div className="mt-2 border-t border-border-subtle pt-3 space-y-3" data-division-edit={division.id}>
      <div className="grid gap-3 sm:grid-cols-2">
        {input('name', 'Name', 80)}
        {input('ageBand', 'Age band (optional)', 30)}
        {input('genderStream', 'Stream (optional)', 30)}
        {input('tier', 'Tier (optional)', 30)}
        {input('capacity', 'Expected teams (optional)', 5, { inputMode: 'numeric' })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving || changed.length === 0} onClick={() => void save()} className="min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50">
          {saving ? 'Saving…' : 'Save division'}
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
