import { NextRequest, NextResponse } from 'next/server';
import { resolveQuestion } from '../sessionStore';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, questionId, selectedOptionId } = body;

    if (!sessionId || !questionId || !selectedOptionId) {
      return NextResponse.json(
        { error: 'Missing sessionId, questionId, or selectedOptionId' },
        { status: 400 },
      );
    }

    const resolved = resolveQuestion(sessionId, questionId, selectedOptionId);

    if (!resolved) {
      return NextResponse.json(
        { error: 'Question not found or already answered' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }
}
