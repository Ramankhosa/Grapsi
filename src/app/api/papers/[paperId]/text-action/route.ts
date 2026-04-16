/**
 * API Route: Paper Text Actions
 * Handles AI-powered text transformations for paper writing
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, type JWTPayload } from '@/lib/auth';
import { 
  performTextAction, 
  getContentSuggestions,
  type TextActionType 
} from '@/lib/paper/text-action-service';
import { prisma } from '@/lib/prisma';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';

// ============================================================================
// Validation Helpers
// ============================================================================

const VALID_ACTIONS: TextActionType[] = ['rewrite', 'expand', 'condense', 'formal', 'simple', 'create_sections'];

function isValidAction(action: string): action is TextActionType {
  return VALID_ACTIONS.includes(action as TextActionType);
}

// ============================================================================
// POST - Perform Text Action
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = decoded.sub;
    const { paperId } = await params;
    
    // Parse request body
    const body = await request.json();
    const { 
      action, 
      selectedText, 
      context, 
      sectionKey, 
      customInstructions 
    } = body;

    // Validate action
    if (!action || !isValidAction(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate selected text
    if (!selectedText || typeof selectedText !== 'string') {
      return NextResponse.json(
        { error: 'selectedText is required' },
        { status: 400 }
      );
    }

    if (selectedText.length > 5000) {
      return NextResponse.json(
        { error: 'Selected text exceeds maximum length of 5000 characters' },
        { status: 400 }
      );
    }

    if (selectedText.trim().length < 10) {
      return NextResponse.json(
        { error: 'Selected text is too short. Please select at least 10 characters.' },
        { status: 400 }
      );
    }

    // Verify session ownership
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: paperId,
        userId
      }
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found or access denied' },
        { status: 404 }
      );
    }

    // Perform the text action
    const result = await performTextAction({
      sessionId: paperId,
      userId,
      action,
      selectedText,
      context: context || undefined,
      sectionKey: sectionKey || undefined,
      customInstructions: customInstructions || undefined
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Text action failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      originalText: result.originalText,
      transformedText: polishDraftMarkdown(result.transformedText),
      action: result.action,
      tokenUsage: result.tokenUsage
    });

  } catch (err) {
    console.error('Text action error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET - Get Content Suggestions
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = decoded.sub;
    const { paperId } = await params;
    const { searchParams } = new URL(request.url);
    
    const sectionKey = searchParams.get('sectionKey');
    const content = searchParams.get('content');

    if (!sectionKey || !content) {
      return NextResponse.json(
        { error: 'sectionKey and content are required query parameters' },
        { status: 400 }
      );
    }

    // Verify session ownership
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: paperId,
        userId
      }
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found or access denied' },
        { status: 404 }
      );
    }

    // Get suggestions
    const result = await getContentSuggestions(
      paperId,
      userId,
      sectionKey,
      content
    );

    return NextResponse.json(result);

  } catch (err) {
    console.error('Suggestions error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
