/**
 * Expand Node API Route
 *
 * POST - Expand a dimension node and return only the new nodes/edges added
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    
    // Parse body with error handling
    let body: any;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('[Expand API] Failed to parse request body:', parseError);
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    const { action, nodeId, userInput } = body;

    console.log('[Expand API] Received request:', { sessionId, action, nodeId, userInput: userInput?.slice(0, 50), body });

    // Get the current session to check ownership
    const session = await IdeationService.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // Handle 'initialize' action - creates the dimension family nodes
    if (action === 'initialize') {
      console.log('[Expand API] Initializing dimensions for session:', sessionId);
      const nodes = await IdeationService.initializeDimensions(sessionId);
      
      // Return the initialized graph
      const transformedNodes = nodes.map(node => ({
        id: node.nodeId,
        type: node.type,
        position: { x: node.positionX || 0, y: node.positionY || 0 },
        data: {
          dbId: node.id,
          title: node.title,
          description: node.description,
          family: node.family,
          tags: node.tags,
          state: node.state,
          selectable: node.selectable,
          depth: node.depth,
          parentId: node.parentNodeId,
        },
      }));

      return NextResponse.json({
        success: true,
        graph: { nodes: transformedNodes, edges: [] },
        message: `Initialized ${nodes.length} dimension nodes`,
      });
    }

    // Handle 'expand' action - expands a specific node
    if (action !== 'expand') {
      console.error('[Expand API] Invalid action:', action);
      return NextResponse.json({ error: `Invalid action: ${action}. Use 'initialize' or 'expand'` }, { status: 400 });
    }

    if (!nodeId) {
      console.error('[Expand API] Missing nodeId');
      return NextResponse.json({ error: 'Missing nodeId' }, { status: 400 });
    }

    // Expand the node and get the new graph data
    const graphData = await IdeationService.expandDimensionNode({
      sessionId,
      nodeId,
      requestHeaders,
      userInput: userInput?.trim() || undefined,  // Pass user's specific direction
    });

    // Transform the returned nodes and edges for React Flow format
    const nodes = graphData.nodes.map(node => ({
      id: node.id,
      type: node.type,
      position: { x: node.positionX || 0, y: node.positionY || 0 },
      data: {
        dbId: node.id,
        title: node.title,
        description: node.descriptionShort || node.description,
        family: node.family,
        tags: node.tags,
        state: node.state,
        selectable: node.selectable,
        depth: node.depth,
        parentId: node.parentId,
        payload: node.payloadJson,
        type: node.type, // Include type for DimensionNode logic
      },
    }));

    const edges = graphData.edges.map(edge => ({
      id: `${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: '',
      animated: false,
      data: { relation: edge.relation },
    }));

    return NextResponse.json({
      success: true,
      graph: { nodes, edges },
      message: `Expanded ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`,
    });
  } catch (error: any) {
    console.error('Failed to expand node:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to expand node' },
      { status: 500 }
    );
  }
}