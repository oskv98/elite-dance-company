// ================================================
// Cloudflare Pages Function: horario-alumnos.js
// Asigna o quita alumnas de una clase del horario.
//
// POST   /horario-alumnos   body: { horario_id, alumno_id }  → asigna
// DELETE /horario-alumnos?horario_id=...&alumno_id=...        → quita
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
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
        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const { horario_id, alumno_id } = body;
            if (!horario_id || !alumno_id) {
                return new Response(JSON.stringify({ error: 'Faltan horario_id o alumno_id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, 'horario_alumnos?on_conflict=horario_id,alumno_id', {
                method: 'POST',
                headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ horario_id, alumno_id }),
            });
            return new Response(JSON.stringify({ ok: true }), { status: 201, headers: CORS });
        }

        if (request.method === 'DELETE') {
            const horario_id = url.searchParams.get('horario_id');
            const alumno_id = url.searchParams.get('alumno_id');
            if (!horario_id || !alumno_id) {
                return new Response(JSON.stringify({ error: 'Faltan horario_id o alumno_id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `horario_alumnos?horario_id=eq.${horario_id}&alumno_id=eq.${alumno_id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('horario-alumnos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
