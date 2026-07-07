// ================================================
// Cloudflare Pages Function: pagos.js
// Registra el pago de una mensualidad y actualiza fecha_ultimo_pago
// del alumno (con lo cual se recalcula su próximo vencimiento).
//
// GET  /pagos?alumno_id=...   → historial de pagos de un alumno
// POST /pagos                 → registra un pago nuevo
//      body: { alumno_id, tasa, monto_usd, fecha_pago? }
//      (fecha_pago es opcional, por defecto hoy)
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
        // ── GET: historial de pagos de un alumno ──
        if (request.method === 'GET') {
            const alumnoId = url.searchParams.get('alumno_id');
            if (!alumnoId) {
                return new Response(JSON.stringify({ error: 'Falta alumno_id' }), { status: 400, headers: CORS });
            }
            const data = await supabaseFetch(
                env,
                `pagos?alumno_id=eq.${alumnoId}&select=*&order=fecha_pago.desc`,
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        // ── POST: registrar un pago ──
        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const { alumno_id, tasa, monto_usd, fecha_pago } = body;

            if (!alumno_id || !tasa || !monto_usd) {
                return new Response(JSON.stringify({
                    error: 'Faltan campos: alumno_id, tasa, monto_usd',
                }), { status: 400, headers: CORS });
            }

            const tasaNum   = parseFloat(tasa);
            const montoUsd  = parseFloat(monto_usd);
            const montoBs   = tasaNum * montoUsd;
            const fecha     = fecha_pago || new Date().toISOString().slice(0, 10);

            const nuevoPago = await supabaseFetch(env, 'pagos', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    alumno_id, fecha_pago: fecha,
                    tasa: tasaNum, monto_usd: montoUsd, monto_bs: montoBs,
                }),
            });

            // Al registrar el pago, se actualiza la fecha base del alumno y
            // se limpian los avisos de vencimiento previos: como ya pagó,
            // el próximo ciclo de vencimiento es uno nuevo y debe poder
            // avisar de nuevo cuando le corresponda.
            await supabaseFetch(env, `alumnos?id=eq.${alumno_id}`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    fecha_ultimo_pago: fecha,
                    notif_5dias_para: null,
                    notif_vencido_para: null,
                }),
            });

            return new Response(JSON.stringify({ ok: true, data: nuevoPago?.[0] || null }), {
                status: 201, headers: CORS,
            });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('pagos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
