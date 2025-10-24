import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const gameIds = url.searchParams.get('ids');

  if (!gameIds) {
    return new Response(JSON.stringify({ error: 'Missing game IDs' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const clientId = import.meta.env.IGDB_CLIENT_ID;
  const clientSecret = import.meta.env.IGDB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'IGDB credentials not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get OAuth token
    const tokenResponse = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST' }
    );

    if (!tokenResponse.ok) {
      throw new Error('Failed to get IGDB access token');
    }

    const { access_token } = await tokenResponse.json();

    // Fetch game covers
    const ids = gameIds.split(',').map(id => id.trim());
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'text/plain',
      },
      body: `fields cover.image_id; where id = (${ids.join(',')});`,
    });

    if (!response.ok) {
      throw new Error('Failed to fetch from IGDB API');
    }

    const data = await response.json();
    
    // Map game IDs to cover image URLs
    const covers = data.reduce((acc: Record<string, string>, game: any) => {
      if (game.cover?.image_id) {
        acc[game.id] = `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.webp`;
      }
      return acc;
    }, {});

    return new Response(JSON.stringify(covers), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
      }
    });
  } catch (error) {
    console.error('IGDB proxy error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch covers' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
