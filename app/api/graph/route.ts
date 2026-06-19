// ─────────────────────────────────────────────────────────────────────────────
// Run once in the Supabase SQL editor to enable memory-to-memory graph edges:
//
//   CREATE OR REPLACE FUNCTION graph_memory_edges(
//     match_user_id uuid,
//     match_threshold float DEFAULT 0.72
//   )
//   RETURNS TABLE(id_a uuid, id_b uuid, similarity float)
//   LANGUAGE sql STABLE AS $$
//     SELECT a.id, b.id, (1 - (a.embedding <=> b.embedding))::float AS similarity
//     FROM memory_vectors a
//     JOIN memory_vectors b ON a.id < b.id
//     WHERE a.user_id = match_user_id
//       AND b.user_id = match_user_id
//       AND (1 - (a.embedding <=> b.embedding)) > match_threshold
//     ORDER BY similarity DESC
//     LIMIT 500;
//   $$;
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';
import { batchEmbedTexts, cosineSimilarity } from '@/lib/graphEmbeddings';

export type GraphNode =
  | { id: string; type: 'project'; label: string; summary: string | null; updatedAt: number }
  | { id: string; type: 'entity'; label: string; summary: string | null; entityType: string }
  | { id: string; type: 'memory'; label: string; source: string; sessionAt: string };

export type GraphEdge = { source: string; target: string; similarity: number };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; cachedAt: string };

// Redis singleton — same pattern as generate/route.ts
let _redisClient: import('redis').RedisClientType | null = null;
async function getRedis(): Promise<import('redis').RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    if (_redisClient?.isOpen) return _redisClient;
    _redisClient = null;
    const { createClient } = await import('redis');
    const client = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    }) as import('redis').RedisClientType;
    client.on('error', () => {
      if (_redisClient === client) _redisClient = null;
    });
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connect timeout')), 2000)
      ),
    ]);
    _redisClient = client;
    return _redisClient;
  } catch {
    _redisClient = null;
    return null;
  }
}

const CROSS_THRESHOLD = 0.75;
const PE_THRESHOLD = 0.65;
const MAX_EDGES_PER_NODE = 5;

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const refresh = new URL(req.url).searchParams.get('refresh') === '1';
    const cacheKey = `graph:v1:${userId}`;

    if (!refresh) {
      const redis = await getRedis();
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return NextResponse.json(JSON.parse(cached) as GraphData);
        } catch {
          /* cache miss — compute fresh */
        }
      }
    }

    // Fetch all three data sources in parallel
    const [projectsRes, entitiesRes, memoriesRes] = await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('id, name, memory, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('entities')
        .select('id, name, type, summary')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(200),
      // Embeddings fetched server-side only for similarity — not sent to client
      supabaseAdmin
        .from('memory_vectors')
        .select('id, content, source, session_at, embedding')
        .eq('user_id', userId)
        .order('session_at', { ascending: false })
        .limit(50),
    ]);

    const projects = (projectsRes.data ?? []) as Array<{
      id: string;
      name: string;
      memory: string | null;
      updated_at: string;
    }>;
    const entities = (entitiesRes.data ?? []) as Array<{
      id: string;
      name: string;
      type: string;
      summary: string | null;
    }>;
    const memories = (memoriesRes.data ?? []) as Array<{
      id: string;
      content: string;
      source: string;
      session_at: string;
      embedding: number[] | null;
    }>;

    // Build client-safe nodes (no embeddings)
    const nodes: GraphNode[] = [
      ...projects.map(p => ({
        id: `p:${p.id}`,
        type: 'project' as const,
        label: p.name,
        summary: p.memory ? p.memory.slice(0, 120) : null,
        updatedAt: new Date(p.updated_at).getTime(),
      })),
      ...entities.map(e => ({
        id: `e:${e.id}`,
        type: 'entity' as const,
        label: e.name,
        summary: e.summary,
        entityType: e.type,
      })),
      ...memories.map(m => ({
        id: `m:${m.id}`,
        type: 'memory' as const,
        label: m.content.slice(0, 60),
        source: m.source,
        sessionAt: m.session_at,
      })),
    ];

    const edges: GraphEdge[] = [];

    // Memory-to-memory edges via pgvector (graceful if SQL function not yet deployed)
    try {
      const { data: memEdges } = await supabaseAdmin.rpc('graph_memory_edges', {
        match_user_id: userId,
        match_threshold: 0.72,
      });
      if (memEdges) {
        for (const e of memEdges as Array<{ id_a: string; id_b: string; similarity: number }>) {
          edges.push({ source: `m:${e.id_a}`, target: `m:${e.id_b}`, similarity: e.similarity });
        }
      }
    } catch {
      /* RPC not deployed yet — memory-memory edges skipped */
    }

    // Batch embed project and entity texts
    const projectTexts = projects.map(
      p => `${p.name}${p.memory ? '. ' + p.memory.slice(0, 200) : ''}`
    );
    const entityTexts = entities.map(e => `${e.name}${e.summary ? '. ' + e.summary : ''}`);

    const [projectEmbeddings, entityEmbeddings] = await Promise.all([
      batchEmbedTexts(projectTexts),
      batchEmbedTexts(entityTexts),
    ]);

    const memoriesWithEmbeddings = memories.filter(m => Array.isArray(m.embedding));

    // Project → memory edges
    for (let pi = 0; pi < projects.length; pi++) {
      const pEmbed = projectEmbeddings[pi];
      if (!pEmbed) continue;
      memoriesWithEmbeddings
        .map(m => ({ id: m.id, sim: cosineSimilarity(pEmbed, m.embedding!) }))
        .filter(s => s.sim > CROSS_THRESHOLD)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, MAX_EDGES_PER_NODE)
        .forEach(s =>
          edges.push({ source: `p:${projects[pi].id}`, target: `m:${s.id}`, similarity: s.sim })
        );
    }

    // Entity → memory edges
    for (let ei = 0; ei < entities.length; ei++) {
      const eEmbed = entityEmbeddings[ei];
      if (!eEmbed) continue;
      memoriesWithEmbeddings
        .map(m => ({ id: m.id, sim: cosineSimilarity(eEmbed, m.embedding!) }))
        .filter(s => s.sim > CROSS_THRESHOLD)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, MAX_EDGES_PER_NODE)
        .forEach(s =>
          edges.push({ source: `e:${entities[ei].id}`, target: `m:${s.id}`, similarity: s.sim })
        );
    }

    // Project → entity edges (in-process cosine)
    for (let pi = 0; pi < projects.length; pi++) {
      const pEmbed = projectEmbeddings[pi];
      if (!pEmbed) continue;
      entities
        .map((e, ei) => ({
          id: e.id,
          sim: entityEmbeddings[ei] ? cosineSimilarity(pEmbed, entityEmbeddings[ei]!) : 0,
        }))
        .filter(s => s.sim > PE_THRESHOLD)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, MAX_EDGES_PER_NODE)
        .forEach(s =>
          edges.push({ source: `p:${projects[pi].id}`, target: `e:${s.id}`, similarity: s.sim })
        );
    }

    const result: GraphData = { nodes, edges, cachedAt: new Date().toISOString() };

    try {
      const redis = await getRedis();
      if (redis) await redis.setEx(cacheKey, 600, JSON.stringify(result));
    } catch {
      /* cache write failure is non-fatal */
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[graph]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
