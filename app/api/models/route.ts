import { NextRequest, NextResponse } from 'next/server';
import { getAvailableModels } from '@/models/registry';

export async function GET(request: NextRequest) {
  const allowExternal = request.nextUrl.searchParams.get('external') === 'true';
  const models = getAvailableModels(allowExternal).filter(m => m.available);
  return NextResponse.json({ models });
}
