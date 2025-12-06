import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Fetch equipment for a profile
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Fetch equipment (RLS will handle privacy)
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
    console.error('Equipment GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch equipment' }, { status: 500 });
  }
}

// POST - Add new equipment
export async function POST(request: NextRequest) {
  try {
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

    // Insert equipment
    const { data: equipment, error } = await supabase
      .from('athlete_equipment')
      .insert({
        profile_id: profileId,
        sport_key: 'golf', // Will be passed from frontend soon
        category,
        brand,
        model,
        image_url: imageUrl || null,
        specs: specs || null,
        status,
        notes: notes || null,
        added_at: new Date().toISOString(), // Timestamp when added
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
