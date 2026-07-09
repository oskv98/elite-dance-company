// ================================================
// Cloudflare Pages Function: check-horarios.js
// Se llama cada pocos minutos desde el Worker con Cron Trigger.
//
// Por cada clase programada PARA HOY revisa cuántos minutos faltan para
// que empiece y, si está en la ventana de 30 min o de 5 min (y aún no se
// avisó para esa clase en esa fecha), manda un push con el nombre de la
// clase y las alumnas inscritas.
//
// GET /check-horarios?secret=TU_CRON_SECRET
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   CRON_SECRET
// ================================================

import { buildPushHTTPRequest } from '@pushforge/builder';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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

async function enviarPush(env, sub, titulo, body, tag) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY);
    const { endpoint, headers, body: pushBody } = await buildPushHTTPRequest({
        privateJWK,
        subscription,
        message: {
            payload: { title: titulo, body, icon: './icon-192.png', tag },
            adminContact: 'mailto:soporte@elitedancecompany.app',
            options: { ttl: 900, urgency: 'high' },
        },
    });
    const resp = await fetch(endpoint, { method: 'POST', headers, body: pushBody });
    return resp.status;
}

// Devuelve { fecha: 'YYYY-MM-DD', dia: 'Lunes', hhmm: 'HH:MM' } en hora de Venezuela (UTC-4)
function ahoraVenezuela() {
    const ahoraUtc = new Date();
    const ve = new Date(ahoraUtc.getTime() - 4 * 3600 * 1000);
    const fecha = ve.toISOString().slice(0, 10);
    const dia = DIAS[ve.getUTCDay()];
    const hhmm = ve.toISOString().slice(11, 16);
    return { fecha, dia, hhmm };
}

function minutosFaltantes(hhmmActual, hhmmClase) {
    const [ha, ma] = hhmmActual.split(':').map(Number);
    const [hc, mc] = hhmmClase.split(':').map(Number);
    return (hc * 60 + mc) - (ha * 60 + ma);
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (url.searchParams.get('secret') !== env.CRON_SECRET) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const { fecha, dia, hhmm } = ahoraVenezuela();

        const clasesHoy = await supabaseFetch(
            env,
            `horarios?select=*,horario_alumnos(alumnos(nombre))&dia=eq.${encodeURIComponent(dia)}`,
            { method: 'GET' }
        );

        const avisos = []; // { horario, tipo }
        for (const clase of (clasesHoy || [])) {
            const faltan = minutosFaltantes(hhmm, clase.hora_inicio);
            if (faltan <= 30 && faltan >= 26) avisos.push({ clase, tipo: '30min' });
            else if (faltan <= 5 && faltan >= 1) avisos.push({ clase, tipo: '5min' });
        }

        if (avisos.length === 0) {
            return new Response(JSON.stringify({ ok: true, avisos: 0 }), { status: 200 });
        }

        // Filtrar los que ya se avisaron hoy (evita duplicados por corridas repetidas del cron)
        const yaEnviados = await supabaseFetch(
            env, `horario_notificaciones?select=horario_id,tipo&fecha=eq.${fecha}`, { method: 'GET' }
        );
        const yaSet = new Set((yaEnviados || []).map(x => `${x.horario_id}|${x.tipo}`));
        const pendientes = avisos.filter(a => !yaSet.has(`${a.clase.id}|${a.tipo}`));

        if (pendientes.length === 0) {
            return new Response(JSON.stringify({ ok: true, avisos: 0, yaAvisados: avisos.length }), { status: 200 });
        }

        const subs = await supabaseFetch(env, 'push_subscriptions?select=*', { method: 'GET' });
        const expirados = [];
        let notificados = 0;

        for (const { clase, tipo } of pendientes) {
            const alumnas = (clase.horario_alumnos || []).map(x => x.alumnos?.nombre).filter(Boolean);
            const listaAlumnas = alumnas.length ? ` (${alumnas.join(', ')})` : '';
            const titulo = tipo === '30min' ? '🩰 Clase en 30 minutos' : '🔥 ¡Clase en 5 minutos!';
            const cuerpo = `${clase.genero_baile} a las ${clase.hora_inicio}${clase.salon ? ' · ' + clase.salon : ''}${listaAlumnas}`;

            for (const sub of (subs || [])) {
                try {
                    const status = await enviarPush(env, sub, titulo, cuerpo, `clase-${clase.id}-${tipo}`);
                    if (status === 404 || status === 410) expirados.push(sub.endpoint);
                    else notificados++;
                } catch (errPush) {
                    console.warn('Fallo enviando push de clase a', sub.endpoint, errPush);
                }
            }

            // Marcar como avisado para no repetir
            await supabaseFetch(env, 'horario_notificaciones', {
                method: 'POST',
                headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ horario_id: clase.id, fecha, tipo }),
            }).catch(() => {});
        }

        for (const endpoint of [...new Set(expirados)]) {
            await supabaseFetch(env, `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
                method: 'DELETE', headers: { 'Prefer': 'return=minimal' },
            }).catch(() => {});
        }

        return new Response(JSON.stringify({ ok: true, avisos: pendientes.length, notificados }), { status: 200 });

    } catch (err) {
        console.error('check-horarios error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
