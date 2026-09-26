import { NextResponse } from 'next/server';
import { processNotificationEvents } from '@/lib/event-notification-service';

export async function GET(request: Request) {
  try {
    // Optional secret check if CRON_SECRET is configured
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const result = await processNotificationEvents();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Lỗi khi chạy cron notify:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

