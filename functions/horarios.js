// ================================================
// Cloudflare Pages Function: horarios.js
// Horarios de clases de la academia.
//
// GET    /horarios          → lista todas las clases
// POST   /horarios          → crea una clase nueva
// PATCH  /horarios?id=...   → edita una clase
// DELETE /horarios?id=...   → elimina una clase
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

async function supabaseFetch(env, path, options = {}) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            'apikey':        env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
            ...(options.headers || {}),
        },
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase error ${resp.status}: ${err}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: CORS });
    }

    try {
        if (request.method === 'GET') {
            const data = await supabaseFetch(
                env, 'horarios?select=*&order=hora_inicio.asc',
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const { dia, hora_inicio, hora_fin, genero_baile, instructor, salon } = body;

            if (!dia || !hora_inicio || !hora_fin || !genero_baile) {
                return new Response(JSON.stringify({
                    error: 'Faltan campos obligatorios: dia, hora_inicio, hora_fin, genero_baile',
                }), { status: 400, headers: CORS });
            }

            const nuevo = await supabaseFetch(env, 'horarios', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    dia, hora_inicio, hora_fin,
                    genero_baile: genero_baile.trim(),
                    instructor: instructor?.trim() || null,
                    salon: salon?.trim() || null,
                }),
            });

            return new Response(JSON.stringify({ ok: true, data: nuevo?.[0] || null }), {
                status: 201, headers: CORS,
            });
        }

        if (request.method === 'PATCH') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            const body = await request.json().catch(() => ({}));
            const permitido = ['dia', 'hora_inicio', 'hora_fin', 'genero_baile', 'instructor', 'salon'];
            const cambios = {};
            for (const campo of permitido) {
                if (body[campo] !== undefined) cambios[campo] = body[campo];
            }
            if (Object.keys(cambios).length === 0) {
                return new Response(JSON.stringify({ error: 'Nada que actualizar' }), { status: 400, headers: CORS });
            }

            const actualizado = await supabaseFetch(env, `horarios?id=eq.${id}`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify(cambios),
            });

            return new Response(JSON.stringify({ ok: true, data: actualizado?.[0] || null }), {
                status: 200, headers: CORS,
            });
        }

        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `horarios?id=eq.${id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('horarios error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
