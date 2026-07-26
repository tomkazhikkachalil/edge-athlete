import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';
import { getEquipmentSportOptions } from '@/lib/equipment-config';

// GET - Fetch equipment for a profile
export async function GET(request: NextRequest) {
  try {
    // The admin client bypasses RLS, so this route MUST enforce privacy
    // itself (the old "RLS will handle privacy" comment was false — a private
    // athlete's equipment was readable by anyone with their profileId).
    const viewer = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    if (viewer.id !== profileId) {
      const { canView } = await canViewProfile(profileId, viewer.id);
      if (!canView) {
        // Not permitted to view this profile — return empty, not a 403, so the
        // profile page renders cleanly for limited viewers.
        return NextResponse.json({ equipment: [] });
      }
    }

    const { data: equipment, error } = await supabase
      .from('athlete_equipment')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching equipment:', error);
      return NextResponse.json({ error: 'Failed to fetch equipment' }, { status: 500 });
    }

    return NextResponse.json({ equipment: equipment || [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Equipment GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch equipment' }, { status: 500 });
  }
}

// POST - Add new equipment
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const body = await request.json();

    const {
      profileId,
      category,
      brand,
      model,
      imageUrl,
      specs,
      status = 'active',
      notes,
      sportKey,
      acquiredOn,
      retiredOn,
    } = body;

    // Validate required fields
    if (!profileId || !category || !brand || !model) {
      return NextResponse.json(
        { error: 'Profile ID, category, brand, and model are required' },
        { status: 400 }
      );
    }

    // Verify user owns this profile
    if (profileId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // User-editable "in bag since" date; defaults to today. retired_on is
    // only meaningful when the item is created already-retired.
    const today = new Date().toISOString().slice(0, 10);
    let acquired = today;
    if (acquiredOn !== undefined && acquiredOn !== null && acquiredOn !== '') {
      if (!isValidDateString(acquiredOn) || !isNotFutureDate(acquiredOn)) {
        return NextResponse.json(
          { error: 'In-bag-since date must be a valid past date (YYYY-MM-DD)' },
          { status: 400 }
        );
      }
      acquired = acquiredOn;
    }
    let retired: string | null = null;
    if (retiredOn !== undefined && retiredOn !== null && retiredOn !== '') {
      if (status !== 'retired') {
        return NextResponse.json(
          { error: 'Retired date requires retired status' },
          { status: 400 }
        );
      }
      if (!isValidDateString(retiredOn) || !isNotFutureDate(retiredOn) || retiredOn < acquired) {
        return NextResponse.json(
          { error: 'Retired date must be a valid date on or after the in-bag-since date' },
          { status: 400 }
        );
      }
      retired = retiredOn;
    }

    // Sport must be one the picker offers ('general' + enabled registry
    // sports). Absent → golf (legacy clients); present-but-unknown → 400.
    let validSportKey = 'golf';
    if (sportKey !== undefined && sportKey !== null && sportKey !== '') {
      const allowed = getEquipmentSportOptions().some(o => o.value === sportKey);
      if (!allowed) {
        return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
      }
      validSportKey = sportKey;
    }

    // Insert equipment
    const { data: equipment, error } = await supabase
      .from('athlete_equipment')
      .insert({
        profile_id: profileId,
        sport_key: validSportKey,
        category,
        brand,
        model,
        image_url: imageUrl || null,
        specs: specs || null,
        status,
        notes: notes || null,
        added_at: new Date().toISOString(), // Server audit timestamp
        retired_at: status === 'retired' ? new Date().toISOString() : null,
        acquired_on: acquired,
        retired_on: status === 'retired' ? (retired ?? today) : null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating equipment:', error);
      return NextResponse.json({ error: 'Failed to add equipment' }, { status: 500 });
    }

    return NextResponse.json({ equipment }, { status: 201 });
  } catch (error) {
    console.error('Equipment POST error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to add equipment' }, { status: 500 });
  }
}
