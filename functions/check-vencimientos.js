// ================================================
// Cloudflare Pages Function: check-vencimientos.js
// Se llama UNA VEZ AL DÍA desde el Worker con Cron Trigger.
//
// Por cada alumno activo calcula su próximo vencimiento de mensualidad
// (fecha_ultimo_pago, o fecha_ingreso si nunca ha pagado, + 1 mes) y:
//   - Si faltan 5 días o menos (y aún no se avisó para ESE vencimiento)
//     → push "por vencer".
//   - Si ya se cumplió o pasó la fecha (y aún no se avisó para ESE
//     vencimiento) → push "vencido" (más urgente).
//
// Cada alumno solo dispara un aviso UNA VEZ por vencimiento gracias a
// notif_5dias_para / notif_vencido_para. Al registrar un pago nuevo
// (pagos.js) esos campos se limpian, así que el siguiente ciclo puede
// avisar de nuevo con normalidad.
//
// GET /check-vencimientos?secret=TU_CRON_SECRET
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   CRON_SECRET
// ================================================

import { buildPushHTTPRequest } from '@pushforge/builder';

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
    const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY);

    const { endpoint, headers, body: pushBody } = await buildPushHTTPRequest({
        privateJWK,
        subscription,
        message: {
            payload: { title: titulo, body, icon: './icon-192.png', tag },
            adminContact: 'mailto:soporte@elitedancecompany.app',
            options: { ttl: 3600, urgency: tag === 'vencido' ? 'high' : 'normal' },
        },
    });

    const resp = await fetch(endpoint, { method: 'POST', headers, body: pushBody });
    return resp.status; // 404/410 = suscripción muerta
}

// Suma 1 mes a una fecha 'YYYY-MM-DD', manejando fin de mes correctamente
function sumarUnMes(fechaStr) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const fecha = new Date(Date.UTC(y, m - 1, d));
    const diaOriginal = fecha.getUTCDate();
    fecha.setUTCMonth(fecha.getUTCMonth() + 1);
    // Si el mes destino tiene menos días (ej. 31 ene → 31 feb no existe),
    // JS lo desborda al mes siguiente; lo corregimos al último día del mes destino.
    if (fecha.getUTCDate() !== diaOriginal) {
        fecha.setUTCDate(0); // último día del mes anterior al que desbordó
    }
    return fecha.toISOString().slice(0, 10);
}

function diasEntre(desdeStr, hastaStr) {
    const a = new Date(desdeStr + 'T00:00:00Z');
    const b = new Date(hastaStr + 'T00:00:00Z');
    return Math.round((b - a) / (24 * 3600 * 1000));
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (url.searchParams.get('secret') !== env.CRON_SECRET) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const hoy = new Date().toISOString().slice(0, 10);

        const alumnos = await supabaseFetch(env, 'alumnos?select=*&activo=eq.true', { method: 'GET' });

        const porVencer = [];
        const vencidos   = [];

        for (const alumno of (alumnos || [])) {
            const base = alumno.fecha_ultimo_pago || alumno.fecha_ingreso;
            if (!base) continue;
            const proximoVencimiento = sumarUnMes(base);
            const diasFaltantes = diasEntre(hoy, proximoVencimiento); // negativo si ya venció

            if (diasFaltantes <= 5 && diasFaltantes > 0 && alumno.notif_5dias_para !== proximoVencimiento) {
                porVencer.push({ ...alumno, proximoVencimiento, diasFaltantes });
            } else if (diasFaltantes <= 0 && alumno.notif_vencido_para !== proximoVencimiento) {
                vencidos.push({ ...alumno, proximoVencimiento, diasFaltantes });
            }
        }

        // Marcar como avisados (para no repetir el mismo aviso en el próximo cron)
        for (const a of porVencer) {
            await supabaseFetch(env, `alumnos?id=eq.${a.id}`, {
                method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ notif_5dias_para: a.proximoVencimiento }),
            });
        }
        for (const a of vencidos) {
            await supabaseFetch(env, `alumnos?id=eq.${a.id}`, {
                method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ notif_vencido_para: a.proximoVencimiento }),
            });
        }

        // Enviar push (agregado) si hay algo que avisar
        let notificados = 0;
        if (porVencer.length > 0 || vencidos.length > 0) {
            const subs = await supabaseFetch(env, 'push_subscriptions?select=*', { method: 'GET' });
            const expirados = [];

            for (const sub of (subs || [])) {
                try {
                    if (porVencer.length > 0) {
                        const nombres = porVencer.map(a => a.nombre).join(', ');
                        const status = await enviarPush(
                            env, sub,
                            '💜 Mensualidades por vencer',
                            porVencer.length === 1
                                ? `${nombres} está a 5 días de vencer su mensualidad.`
                                : `${porVencer.length} alumnas/os están a 5 días de vencer su mensualidad: ${nombres}.`,
                            'por-vencer'
                        );
                        if (status === 404 || status === 410) expirados.push(sub.endpoint);
                        else notificados++;
                    }
                    if (vencidos.length > 0) {
                        const nombres = vencidos.map(a => a.nombre).join(', ');
                        const status = await enviarPush(
                            env, sub,
                            '🚨 Mensualidad vencida',
                            vencidos.length === 1
                                ? `${nombres} ya cumplió la fecha límite de pago.`
                                : `${vencidos.length} alumnas/os ya cumplieron la fecha límite de pago: ${nombres}.`,
                            'vencido'
                        );
                        if (status === 404 || status === 410) expirados.push(sub.endpoint);
                        else notificados++;
                    }
                } catch (errPush) {
                    console.warn('Fallo enviando push a', sub.endpoint, errPush);
                }
            }

            for (const endpoint of [...new Set(expirados)]) {
                await supabaseFetch(env, `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
                    method: 'DELETE', headers: { 'Prefer': 'return=minimal' },
                }).catch(() => {});
            }
        }

        return new Response(JSON.stringify({
            ok: true,
            porVencer: porVencer.length,
            vencidos: vencidos.length,
            notificados,
        }), { status: 200 });

    } catch (err) {
        console.error('check-vencimientos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
