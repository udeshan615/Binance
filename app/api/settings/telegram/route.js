import { NextResponse } from 'next/server';
import { getState, setState } from '../../../../lib/database/appState.js';
import { sendTestMessage } from '../../../../lib/telegram/telegram.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stored = (await getState('telegram_config', null)) || {};
    const envToken = !!process.env.TELEGRAM_BOT_TOKEN;
    const envChat = !!process.env.TELEGRAM_CHAT_ID;
    return NextResponse.json({
      configured: !!(
        (stored.bot_token || envToken) &&
        (stored.chat_id || envChat)
      ),
      has_token: !!(stored.bot_token || envToken),
      has_chat_id: !!(stored.chat_id || envChat),
      // never return full token — only masked
      token_preview: stored.bot_token
        ? `${String(stored.bot_token).slice(0, 6)}…`
        : envToken
          ? '(from env)'
          : null,
      chat_id: stored.chat_id || (envChat ? '(from env)' : null),
      source: stored.bot_token || stored.chat_id ? 'database' : envToken ? 'env' : 'none',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const bot_token = (body.bot_token || '').trim();
    const chat_id = String(body.chat_id || '').trim();
    const test = !!body.test;

    if (!bot_token || !chat_id) {
      return NextResponse.json(
        { error: 'bot_token and chat_id required' },
        { status: 400 }
      );
    }

    await setState('telegram_config', { bot_token, chat_id });

    let testResult = null;
    if (test) {
      testResult = await sendTestMessage();
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      test: testResult,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
