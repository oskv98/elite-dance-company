// ================================================
// Cloudflare Pages Function: alumnos.js
// CRUD de alumnos inscritos en Elite Dance Company.
//
// GET    /alumnos                 → lista todos los alumnos activos
// GET    /alumnos?incluirInactivos=1 → incluye también los dados de baja
// POST   /alumnos                 → crea un alumno nuevo
// PATCH  /alumnos?id=...          → edita un alumno (o lo da de baja con activo:false)
// DELETE /alumnos?id=...          → elimina un alumno definitivamente
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
        // ── GET: listar alumnos ──
        if (request.method === 'GET') {
            const incluirInactivos = url.searchParams.get('incluirInactivos') === '1';
            const filtro = incluirInactivos ? '' : '&activo=eq.true';
            const data = await supabaseFetch(
                env,
                `alumnos?select=*${filtro}&order=nombre.asc`,
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        // ── POST: crear alumno ──
        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const {
                nombre, genero_baile, representante_nombre, representante_telefono,
                fecha_ingreso, monto_mensual_usd,
            } = body;

            if (!nombre || !genero_baile || !monto_mensual_usd) {
                return new Response(JSON.stringify({
                    error: 'Faltan campos obligatorios: nombre, genero_baile, monto_mensual_usd',
                }), { status: 400, headers: CORS });
            }

            const nuevo = await supabaseFetch(env, 'alumnos', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    nombre: nombre.trim(),
                    genero_baile: genero_baile.trim(),
                    representante_nombre: representante_nombre?.trim() || null,
                    representante_telefono: representante_telefono?.replace(/\D/g, '') || null,
                    fecha_ingreso: fecha_ingreso || new Date().toISOString().slice(0, 10),
                    monto_mensual_usd: parseFloat(monto_mensual_usd),
                }),
            });

            return new Response(JSON.stringify({ ok: true, data: nuevo?.[0] || null }), {
                status: 201, headers: CORS,
            });
        }

        // ── PATCH: editar alumno ──
        if (request.method === 'PATCH') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            const body = await request.json().catch(() => ({}));
            const permitido = [
                'nombre', 'genero_baile', 'representante_nombre', 'representante_telefono',
                'fecha_ingreso', 'monto_mensual_usd', 'fecha_ultimo_pago', 'activo',
            ];
            const cambios = {};
            for (const campo of permitido) {
                if (body[campo] !== undefined) cambios[campo] = body[campo];
            }
            if (cambios.representante_telefono) {
                cambios.representante_telefono = cambios.representante_telefono.replace(/\D/g, '');
            }
            if (Object.keys(cambios).length === 0) {
                return new Response(JSON.stringify({ error: 'Nada que actualizar' }), { status: 400, headers: CORS });
            }

            const actualizado = await supabaseFetch(env, `alumnos?id=eq.${id}`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify(cambios),
            });

            return new Response(JSON.stringify({ ok: true, data: actualizado?.[0] || null }), {
                status: 200, headers: CORS,
            });
        }

        // ── DELETE: eliminar alumno definitivamente ──
        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `alumnos?id=eq.${id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('alumnos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
