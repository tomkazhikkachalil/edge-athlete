import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { VITAL_METRICS_MAP } from '@/lib/vitals-config';
import {
  convertHeight,
  convertWeight,
  isNewestEntry,
  isValidRecordedDate,
  WEIGHT_UNITS,
  HEIGHT_CM_MIN,
  HEIGHT_CM_MAX,
  WEIGHT_LBS_MIN,
  WEIGHT_LBS_MAX,
  type WeightUnit,
} from '@/lib/body-measurement';

/**
 * POST /api/vitals/body-measurement — the Vitals-tab quick update for height
 * and weight. ONE request does both writes so the timeline and Current Vitals
 * can never disagree:
 *
 *   1. Append immutable athlete_vitals row(s) in canonical units (height in
 *      inches, weight in lbs — what the charts plot).
 *   2. Sync the profiles snapshot, but only when the entry is the NEWEST
 *      dated measurement for that metric — a backdated fill enriches the
 *      timeline without clobbering the current value.
 *
 * If the profile update fails after the insert succeeded, the inserted rows
 * are deleted and the whole request fails — no hidden partial state.
 *
 * DOB is deliberately not accepted here: it is edited only in Edit Profile
 * (PUT /api/profile, which carries the dob_locked/supervised gate).
 */

interface MeasurementBody {
  recorded_at?: unknown;
  height?: { height_cm?: unknown } | null;
  weight?: { display?: unknown; unit?: unknown } | null;
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as MeasurementBody | null;
    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const recordedAt = body.recorded_at;
    if (typeof recordedAt !== 'string' || !isValidRecordedDate(recordedAt)) {
      return NextResponse.json({ error: 'Invalid recorded date' }, { status: 400 });
    }

    const heightCm = body.height?.height_cm;
    const hasHeight = heightCm !== undefined && heightCm !== null;
    if (hasHeight) {
      if (
        typeof heightCm !== 'number' ||
        !Number.isFinite(heightCm) ||
        heightCm < HEIGHT_CM_MIN ||
        heightCm > HEIGHT_CM_MAX
      ) {
        return NextResponse.json({ error: 'Invalid height' }, { status: 400 });
      }
    }

    const weightDisplay = body.weight?.display;
    const weightUnit = body.weight?.unit;
    const hasWeight = weightDisplay !== undefined && weightDisplay !== null;
    if (hasWeight) {
      if (
        typeof weightDisplay !== 'number' ||
        !Number.isFinite(weightDisplay) ||
        weightDisplay <= 0 ||
        !WEIGHT_UNITS.includes(weightUnit as WeightUnit)
      ) {
        return NextResponse.json({ error: 'Invalid weight' }, { status: 400 });
      }
      const { valueLbs } = convertWeight(weightDisplay, weightUnit as WeightUnit);
      if (valueLbs < WEIGHT_LBS_MIN || valueLbs > WEIGHT_LBS_MAX) {
        return NextResponse.json(
          { error: `Weight must be between ${WEIGHT_LBS_MIN} and ${WEIGHT_LBS_MAX} lbs` },
          { status: 400 }
        );
      }
    }

    if (!hasHeight && !hasWeight) {
      return NextResponse.json(
        { error: 'At least one measurement is required' },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    // Newest-dated check per metric, BEFORE inserting (the insert itself
    // would otherwise always be the max).
    const newestFor = async (metricKey: 'height' | 'weight'): Promise<boolean> => {
      const { data, error } = await admin
        .from('athlete_vitals')
        .select('recorded_at')
        .eq('profile_id', user.id)
        .eq('metric_key', metricKey)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`max recorded_at lookup failed: ${error.message}`);
      return isNewestEntry(recordedAt, data?.recorded_at ?? null);
    };

    const rows: Record<string, unknown>[] = [];
    const profileUpdate: Record<string, unknown> = {};
    const profileUpdated = { height: false, weight: false };

    if (hasHeight) {
      const isNewest = await newestFor('height');
      const conv = convertHeight(heightCm as number);
      rows.push({
        profile_id: user.id,
        metric_key: 'height',
        metric_category: 'body',
        metric_label: VITAL_METRICS_MAP['height'].label,
        value: conv.valueIn,
        value_display: conv.display,
        unit: 'in',
        source: 'manual',
        recorded_at: recordedAt,
      });
      if (isNewest) {
        profileUpdate.height_cm = Math.round(heightCm as number);
        profileUpdated.height = true;
      }
    }

    if (hasWeight) {
      const isNewest = await newestFor('weight');
      const conv = convertWeight(weightDisplay as number, weightUnit as WeightUnit);
      rows.push({
        profile_id: user.id,
        metric_key: 'weight',
        metric_category: 'body',
        metric_label: VITAL_METRICS_MAP['weight'].label,
        value: conv.valueLbs,
        value_display: conv.displayText,
        unit: 'lbs',
        source: 'manual',
        recorded_at: recordedAt,
      });
      if (isNewest) {
        profileUpdate.weight_display = weightDisplay;
        profileUpdate.weight_unit = weightUnit;
        profileUpdate.weight_kg = conv.valueKg;
        profileUpdated.weight = true;
      }
    }

    const { data: inserted, error: insertError } = await admin
      .from('athlete_vitals')
      .insert(rows)
      .select();

    if (insertError || !inserted) {
      console.error('Body measurement insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save measurement' }, { status: 500 });
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error: updateError } = await admin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', user.id);

      if (updateError) {
        // Compensate: without this, the timeline and Current Vitals disagree
        // with no in-app way to correct it (athlete_vitals is append-only).
        console.error('Body measurement profile sync error:', updateError);
        await admin
          .from('athlete_vitals')
          .delete()
          .in('id', inserted.map(row => row.id));
        return NextResponse.json(
          { error: 'Nothing was saved — please try again' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ entries: inserted, profileUpdated });
  } catch (error) {
    console.error('Body measurement POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
