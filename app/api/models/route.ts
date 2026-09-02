import { NextResponse } from 'next/server';
import { getAvailableModels } from '@/models/registry';

export async function GET() {
  const models = getAvailableModels().filter(m => m.available);
  return NextResponse.json({ models });
}
